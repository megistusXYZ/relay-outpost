// "Last posted" activity fetch: each follow's latest-post timestamp, batched and
// cached so a 200+ follow list doesn't hammer relays or block the page.
//
// OUTBOX-CORRECT (the fix): a follow who posts only to their OWN relays must not
// look dead. Every author is queried on THEIR advertised NIP-65 write/outbox
// relays (kind-10002), falling back to the observer/default relays only when an
// author advertises none. We first warm the follows' relay lists, then group
// authors by their write-relay set so shared relays are queried together.
//
// FEED-PRESENCE (the fix): "active" means visible in a feed — kind 1 (notes AND
// replies), kind 6 (reposts) and kind 30023 (long-form). A kind-7 reaction is
// NOT activity (a like isn't a voice). We keep the newest matching created_at.
//
// Strategy (two phase, both bounded):
//   Phase A — query authors in relay-grouped batches with a generous limit;
//             record the newest matching created_at per author.
//   Phase B — any author unseen in phase A (silent, or crowded out of the recent
//             window) gets a cheap per-author `limit: 1` query on their own
//             outbox at bounded concurrency.
// Results merge into a localStorage cache (TTL a few days) keyed per observer AND
// a process-wide in-memory cache shared with getLastActivity(), so reopening the
// page — or visiting a profile — is instant and costs no extra relay round trip.

import { pool, DEFAULT_RELAYS } from "@/lib/nostr";
import { getReadRelays, getWriteRelays, fetchRelayLists, hasCachedRelayList } from "@/lib/outbox";
import { KIND_TEXT_NOTE, KIND_REPOST } from "@/lib/nostr-helpers";
import { KIND_LONG_FORM } from "@/lib/nip23";

const LS_KEY = "ro_follow_last_post";
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_FOLLOWS = 500; // graceful cap for very large lists
const PHASE_A_GROUP = 20;
const PHASE_B_CONCURRENCY = 6;
const PHASE_A_MAXWAIT = 4500;
const PHASE_B_MAXWAIT = 3500;
const RELAYS_PER_AUTHOR = 4;
// Bounded window to let warmed NIP-65 relay lists arrive before we group. The
// page shows cached data instantly and updates when the scan completes, so this
// only delays first-run resolution, never the initial paint.
const RELAY_LIST_SETTLE = 2200;
const SINGLE_RELAY_LIST_SETTLE = 1200;

// Feed-presence activity kinds. Kind 1 = notes AND replies; 6 = reposts;
// 30023 = long-form. Deliberately NOT kind 7 (reactions): a like isn't a voice.
const ACTIVITY_KINDS = [KIND_TEXT_NOTE, KIND_REPOST, KIND_LONG_FORM];

interface CacheShape {
  ts: number;
  d: Record<string, number>; // pubkey → latest post unix seconds
}

// Process-wide cache shared by the batch fetch and getLastActivity(). Arriving
// at a profile from the health page (or vice-versa) hits this = no extra fetch.
const activityMemCache = new Map<string, number>();

function scopedKey(observer: string): string {
  return `${LS_KEY}:${observer.slice(0, 8)}`;
}

/** Read the cached last-post map (fresh entries only). */
export function loadActivityCache(observer: string): Map<string, number> {
  try {
    const raw = localStorage.getItem(scopedKey(observer));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || typeof parsed.ts !== "number" || Date.now() - parsed.ts > CACHE_TTL) {
      return new Map();
    }
    if (parsed.d && typeof parsed.d === "object") {
      const map = new Map(Object.entries(parsed.d));
      for (const [k, v] of map) if (!activityMemCache.has(k)) activityMemCache.set(k, v);
      return map;
    }
  } catch {}
  return new Map();
}

function saveActivityCache(observer: string, map: Map<string, number>): void {
  try {
    const d: Record<string, number> = {};
    for (const [k, v] of map) d[k] = v;
    localStorage.setItem(scopedKey(observer), JSON.stringify({ ts: Date.now(), d } satisfies CacheShape));
  } catch {}
}

/** Merge one resolved entry into the observer-scoped LS cache (read-modify-write). */
function mergeIntoCache(observer: string, pubkey: string, ts: number): void {
  const map = loadActivityCache(observer);
  map.set(pubkey, ts);
  saveActivityCache(observer, map);
}

/** Observer's own relays — the fallback when an author advertises no outbox. */
function observerFallbackRelays(observer: string | undefined): string[] {
  const base = observer
    ? [...getReadRelays(observer, []), ...getWriteRelays(observer, [])]
    : [];
  return Array.from(new Set([...base, ...DEFAULT_RELAYS])).filter(Boolean).slice(0, 8);
}

/** An author's own NIP-65 write/outbox relays, falling back when none advertised. */
function relaysForAuthor(pubkey: string, fallback: string[]): string[] {
  const own = getWriteRelays(pubkey, []).slice(0, RELAYS_PER_AUTHOR).filter(Boolean);
  return own.length > 0 ? own : fallback;
}

function settle(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

/** Group authors by their (sorted) write-relay set so shared relays batch together. */
function groupByRelays(
  authors: string[],
  fallback: string[],
): { relays: string[]; authors: string[] }[] {
  const groups = new Map<string, { relays: string[]; authors: string[] }>();
  for (const pk of authors) {
    const relays = relaysForAuthor(pk, fallback);
    const key = [...relays].sort().join(",");
    let g = groups.get(key);
    if (!g) { g = { relays, authors: [] }; groups.set(key, g); }
    g.authors.push(pk);
  }
  return Array.from(groups.values());
}

export interface FetchActivityOpts {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Resolve each follow's latest-post timestamp, using (and refreshing) the cache.
 * Returns a map of pubkey → latest feed-presence created_at (unix seconds).
 * Absent = unknown / no posts found. Non-blocking: callers render progressively
 * via onProgress. Caps at MAX_FOLLOWS so a huge list degrades gracefully.
 */
export async function fetchLastPostTimestamps(
  observer: string,
  follows: string[],
  opts: FetchActivityOpts = {},
): Promise<Map<string, number>> {
  const { onProgress, signal } = opts;
  const cached = loadActivityCache(observer);
  const result = new Map<string, number>(cached);

  const targets = follows.filter((pk) => pk && pk !== observer).slice(0, MAX_FOLLOWS);
  const missing = targets.filter((pk) => !cached.has(pk));
  const total = missing.length;
  if (total === 0) {
    onProgress?.(0, 0);
    return result;
  }

  // Warm each follow's NIP-65 write relays so we query THEIR outbox, not ours.
  // Only fetch for authors we don't already have a cached relay list for.
  const needRelayLists = missing.filter((pk) => !hasCachedRelayList(pk));
  if (needRelayLists.length > 0) {
    fetchRelayLists(needRelayLists);
    await settle(RELAY_LIST_SETTLE, signal);
  }
  if (signal?.aborted) return result;

  const fallback = observerFallbackRelays(observer);
  const seen = new Set<string>();
  let done = 0;
  const bump = (n: number) => { done += n; onProgress?.(Math.min(done, total), total); };
  onProgress?.(0, total);

  const record = (pk: string, createdAt: number) => {
    const prev = result.get(pk);
    if (prev === undefined || createdAt > prev) result.set(pk, createdAt);
    const memPrev = activityMemCache.get(pk);
    if (memPrev === undefined || createdAt > memPrev) activityMemCache.set(pk, createdAt);
  };

  // ── Phase A: relay-grouped batched queries (each author on their own outbox) ──
  const relayGroups = groupByRelays(missing, fallback);
  for (const group of relayGroups) {
    for (let i = 0; i < group.authors.length; i += PHASE_A_GROUP) {
      if (signal?.aborted) return result;
      const chunk = group.authors.slice(i, i + PHASE_A_GROUP);
      try {
        const events = await pool.querySync(
          group.relays,
          { kinds: ACTIVITY_KINDS, authors: chunk, limit: chunk.length * 4 },
          { maxWait: PHASE_A_MAXWAIT } as any,
        );
        for (const ev of events) {
          seen.add(ev.pubkey);
          record(ev.pubkey, ev.created_at);
        }
      } catch {}
      bump(chunk.filter((pk) => seen.has(pk)).length);
    }
  }

  // ── Phase B: per-author limit:1 for anyone still unseen, on their own outbox ──
  const unseen = missing.filter((pk) => !seen.has(pk));
  await runPool(unseen, PHASE_B_CONCURRENCY, async (pk) => {
    if (signal?.aborted) return;
    try {
      const events = await pool.querySync(
        relaysForAuthor(pk, fallback),
        { kinds: ACTIVITY_KINDS, authors: [pk], limit: 1 },
        { maxWait: PHASE_B_MAXWAIT } as any,
      );
      if (events.length) {
        let newest = 0;
        for (const ev of events) if (ev.created_at > newest) newest = ev.created_at;
        if (newest > 0) record(pk, newest);
      }
    } catch {}
    bump(1);
  });

  saveActivityCache(observer, result);
  onProgress?.(total, total);
  return result;
}

/**
 * Shared, outbox-aware "last posted" getter for a SINGLE pubkey — the same
 * corrected fetch as the batch, sharing one in-memory cache. Returns the newest
 * feed-presence created_at (unix seconds), or undefined when unknown. The
 * profile header and the health page both read through this so they can never
 * disagree; a value the batch already resolved is returned with no relay cost.
 */
export async function getLastActivity(
  pubkey: string,
  observer?: string,
  opts: { signal?: AbortSignal } = {},
): Promise<number | undefined> {
  if (!pubkey) return undefined;
  const mem = activityMemCache.get(pubkey);
  if (mem !== undefined) return mem;
  if (observer) {
    const ls = loadActivityCache(observer); // also seeds the mem cache
    const hit = ls.get(pubkey);
    if (hit !== undefined) return hit;
  }

  const { signal } = opts;
  const fallback = observerFallbackRelays(observer);

  if (!hasCachedRelayList(pubkey)) {
    fetchRelayLists([pubkey]);
    await settle(SINGLE_RELAY_LIST_SETTLE, signal);
  }
  if (signal?.aborted) return activityMemCache.get(pubkey);

  try {
    const events = await pool.querySync(
      relaysForAuthor(pubkey, fallback),
      { kinds: ACTIVITY_KINDS, authors: [pubkey], limit: 1 },
      { maxWait: PHASE_B_MAXWAIT } as any,
    );
    let newest = 0;
    for (const ev of events) if (ev.created_at > newest) newest = ev.created_at;
    if (newest > 0) {
      activityMemCache.set(pubkey, newest);
      if (observer) mergeIntoCache(observer, pubkey, newest);
      return newest;
    }
  } catch {}
  return undefined;
}
