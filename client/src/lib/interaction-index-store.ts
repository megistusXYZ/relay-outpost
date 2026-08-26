import type { Event } from "nostr-tools";
import { eventStore, pool } from "@/lib/nostr";
import { KIND_REPOST, KIND_REACTION } from "./nostr-helpers";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import {
  createInteractionIndex,
  addToIndex,
  deriveInteraction,
  type InteractionIndex,
  type DerivedInteraction,
} from "./interaction-index";

/**
 * Process-wide read-model over the local event store's reactions / reposts /
 * (viewer) replies. Replaces the old pattern where every post component opened
 * its own `eventStore.insert$` subscription and re-scanned the whole store on
 * each insert (O(posts × inserts)). One subscription folds each event into the
 * shared index and notifies only the affected posts.
 *
 * It's a singleton (not React state) so it's correct wherever a post renders —
 * feed, thread, outposts, notifications, profile — independent of any provider.
 * The `InteractionIndexProvider` just owns lifecycle + viewer identity; the
 * hooks also self-heal (start + set viewer) so an unwrapped post still works.
 */
class InteractionIndexStore {
  private index: InteractionIndex = createInteractionIndex();
  private viewer: string | null = null;
  private started = false;
  private sub: { unsubscribe(): void } | null = null;

  // Per-target subscribers (useSyncExternalStore) + cached derived snapshots so
  // getSnapshot returns a stable reference until the target actually changes.
  private listeners = new Map<string, Set<() => void>>();
  private snapshots = new Map<string, DerivedInteraction>();

  // Affected target ids collected between coalesced flushes.
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Begin the single insert$ subscription and seed from what's already cached. */
  ensureStarted() {
    if (this.started) return;
    this.started = true;
    this.seed();
    this.sub = eventStore.insert$.subscribe((e: Event) => this.ingest(e));
  }

  /** Point the index at the logged-in viewer; rebuilds viewer-dependent state. */
  setViewer(pubkey: string | null) {
    const next = pubkey ?? null;
    if (next === this.viewer) return;
    this.viewer = next;
    // Viewer identity changes every post's "my reaction / repost / reply", so
    // rebuild from scratch and invalidate all snapshots.
    if (this.started) {
      this.index = createInteractionIndex();
      this.seed();
      this.snapshots.clear();
      // "Have I reacted to this?" is a different question for a different
      // person, so every prior answer is void — including the record of having
      // asked. Without this, switching accounts inherits the last viewer's
      // hearts and never re-asks.
      this.asked.clear();
      this.wanted.clear();
      this.notifyAll();
    }
  }

  private seed() {
    for (const e of eventStore.getByFilters({ kinds: [KIND_REACTION] })) addToIndex(this.index, e, this.viewer);
    for (const e of eventStore.getByFilters({ kinds: [KIND_REPOST] })) addToIndex(this.index, e, this.viewer);
    if (this.viewer) {
      for (const e of eventStore.getByFilters({ kinds: [1], authors: [this.viewer] })) addToIndex(this.index, e, this.viewer);
    }
  }

  private ingest(e: Event) {
    const affected = addToIndex(this.index, e, this.viewer);
    if (affected.length === 0) return;
    for (const id of affected) this.pending.add(id);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), 50);
    }
  }

  private flush() {
    this.flushTimer = null;
    const ids = this.pending;
    this.pending = new Set();
    for (const id of ids) {
      this.snapshots.delete(id); // recompute lazily on next getSnapshot
      const ls = this.listeners.get(id);
      if (ls) for (const cb of ls) cb();
    }
  }

  private notifyAll() {
    for (const ls of this.listeners.values()) for (const cb of ls) cb();
  }

  /**
   * Ask the network which of these posts the VIEWER has already reacted to.
   *
   * The index is a read-model over the local event store, and nothing was
   * putting the viewer's own past reactions INTO that store. A heart lit up
   * only while the kind-7 happened to be cached — true the instant you tapped
   * it, false as soon as the post was fetched fresh. Scroll away, filter, come
   * back, and your own engagement had vanished from a post you had definitely
   * engaged with. The reaction was never lost; it was never asked for.
   *
   * Hooked to `subscribe` because that is called by every post that renders, so
   * the question is asked about exactly what is on screen and nothing else — no
   * separate viewport tracking, no component changes.
   *
   * Fetches kinds 6 AND 7 in one round trip: reposts were silently the same bug
   * and share the filter, so asking separately would be two subscriptions for
   * one answer.
   */
  private wanted = new Set<string>();
  private asked = new Set<string>();
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;

  private requestBackfill(targetId: string) {
    if (!this.viewer || !targetId) return;
    if (this.asked.has(targetId)) return;
    this.wanted.add(targetId);
    if (this.backfillTimer !== null) return;
    // Coalesced: a feed mounts dozens of posts in the same tick, and one filter
    // carrying all of their ids is the difference between 1 REQ and 40.
    this.backfillTimer = setTimeout(() => this.runBackfill(), 250);
  }

  private runBackfill() {
    this.backfillTimer = null;
    const viewer = this.viewer;
    const ids = [...this.wanted];
    this.wanted.clear();
    if (!viewer || ids.length === 0) return;
    for (const id of ids) this.asked.add(id);

    const relays = getActiveDefaultRelays();
    if (relays.length === 0) return;
    // Chunked: relays commonly cap filter array sizes, and one oversized REQ
    // that gets rejected would silently lose the whole batch.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const sub = pool.subscribeMany(
          relays,
          { kinds: [KIND_REACTION, KIND_REPOST], authors: [viewer], "#e": chunk },
          {
            // Inserting is the whole job — `insert$` feeds ingest(), which folds
            // it into the index and notifies just the affected posts.
            onevent: (e: Event) => { try { eventStore.add(e); } catch { /* dup */ } },
            oneose: () => { try { sub.close(); } catch { /* already closed */ } },
          },
        );
        // EOSE is not guaranteed on every relay; close on a timer regardless so
        // a quiet relay cannot hold a subscription open for the whole session.
        setTimeout(() => { try { sub.close(); } catch { /* already closed */ } }, 8000);
      } catch { /* a relay set we cannot reach is not worth throwing over */ }
    }
  }

  subscribe = (targetId: string, cb: () => void): (() => void) => {
    this.ensureStarted();
    this.requestBackfill(targetId);
    let set = this.listeners.get(targetId);
    if (!set) { set = new Set(); this.listeners.set(targetId, set); }
    set.add(cb);
    return () => {
      const s = this.listeners.get(targetId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) { this.listeners.delete(targetId); this.snapshots.delete(targetId); }
    };
  };

  getSnapshot = (targetId: string): DerivedInteraction => {
    let snap = this.snapshots.get(targetId);
    if (!snap) {
      snap = deriveInteraction(this.index, targetId, this.viewer);
      this.snapshots.set(targetId, snap);
    }
    return snap;
  };
}

export const interactionIndexStore = new InteractionIndexStore();
