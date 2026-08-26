/**
 * Background mention scanner (Tier-2 detection) — the I/O half of
 * concord-mentions.ts.
 *
 * The metadata-only unread watcher (concord-unread) can say "something new is
 * in #random", but only a decrypt can say "and it @mentions YOU". This module
 * closes that gap with a strictly bounded background pass over joined
 * communities:
 *
 *   COST BOUNDS (battery/perf):
 *   - only channels whose metadata wrap clock is newer than their read mark
 *     are considered (nothing to scan ⇒ zero relay traffic, zero decrypts);
 *   - one one-shot, since-bounded REQ per community with work to do;
 *   - at most ~MAX_WRAPS_PER_COMMUNITY newest wraps decrypt per community per
 *     pass, never older than LOOKBACK_S (~7 days) or the channel's read mark;
 *   - wraps already in the decrypt-once stream ledger are SKIPPED (the cached
 *     message pass below covers them) — nothing ever decrypts twice;
 *   - decrypts run through the shared decryptionQueue (bounded concurrency,
 *     id-coalesced), and the whole pass is debounced + visibility-gated:
 *     event-driven via the watcher's CHANGED event, never a hot loop.
 *
 * What a decoded message wrap gets: cached via cacheMessage (the exact shape
 * ConcordChat caches) and THEN marked in the stream ledger, so when the user
 * opens the channel the message is already there and the live subscription
 * skips it. Reaction/delete/edit wraps are left UNMARKED and untouched — the
 * live pipeline owns their ordering rules (pendingDeletes etc.); they are rare
 * and cheap, and correctness beats saving one symmetric decrypt.
 *
 * A second, decrypt-free pass scans the already-decrypted IDB message cache
 * for unread mentions (messages the live chat decoded while you were looking
 * elsewhere). Both passes feed recordMention; muted channels/communities are
 * skipped entirely (mute = don't even spend the crypto).
 *
 * Calm rules: this module produces COUNTS only. No sounds, no toasts, no OS
 * notifications, ever. Everything is local-device (no NIP-78 sync — possible
 * follow-up).
 */
import type { Event } from "nostr-tools";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { decryptionQueue } from "@/lib/decryption-queue";
import {
  getCommunities, getCachedMessages, cacheMessage,
  isStreamProcessed, markStreamProcessed,
  type StoredCommunity, type CachedMessage,
} from "./concord-keys";
import { channelReadPlanes, decodeStreamEvent, routeRumor } from "./concord-stream";
import { registerPlaneAuth } from "./concord-plane-auth";
import type { GroupKey } from "./concord-crypto";
import { effectiveTime } from "./concord-events";
import { mediaFromTags } from "./concord-media";
import { getChannelWrapTimes, CHANGED_EVENT } from "./concord-unread";
import { readChannelLastRead } from "./concord-channel-unread";
import { isCommunityMuted, isMuted, MUTE_CHANGED_EVENT } from "./concord-mute";
import { recordMention, rumorMentionsMe } from "./concord-mentions";
import { isConcordEnabled } from "./concord-prefs";

const KIND_STREAM_WRAP = 1059;
/** Newest wraps decrypted per community per pass. */
const MAX_WRAPS_PER_COMMUNITY = 30;
/** Never scan further back than this, regardless of read marks. */
const LOOKBACK_S = 7 * 24 * 3600;
/** Debounce between a trigger and the actual pass. */
const SCAN_DEBOUNCE_MS = 2500;
/** Give a slow relay this long to EOSE before closing the one-shot REQ. */
const EOSE_TIMEOUT_MS = 8000;

let owner: string | null = null;
let armed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
let rerunAfter = false;

/**
 * Start (or re-own) the scanner for `pubkey`. Idempotent — safe to call from
 * every nav surface that already calls ensureConcordUnreadWatcher.
 */
export function ensureConcordMentionScanner(pubkey: string | null | undefined): void {
  if (!pubkey || !isConcordEnabled() || typeof window === "undefined") return;
  owner = pubkey;
  if (armed) return;
  armed = true;
  // Event-driven: new wraps (watcher clock moved) and mute flips re-schedule;
  // a hidden tab defers everything until it's visible again.
  window.addEventListener(CHANGED_EVENT, schedule);
  window.addEventListener(MUTE_CHANGED_EVENT, schedule);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule();
  });
  schedule();
}

function schedule(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // re-armed on visible
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void run(); }, SCAN_DEBOUNCE_MS);
}

async function run(): Promise<void> {
  if (scanning) { rerunAfter = true; return; }
  scanning = true;
  try {
    await scan();
  } catch { /* best-effort */ } finally {
    scanning = false;
    if (rerunAfter) { rerunAfter = false; schedule(); }
  }
}

async function scan(): Promise<void> {
  const pk = owner;
  if (!pk) return;
  const communities = await getCommunities(pk).catch(() => [] as StoredCommunity[]);
  for (const c of communities) {
    if (isCommunityMuted(c.community_id)) continue; // mute ⇒ no crypto spent
    await scanCommunity(pk, c).catch(() => { /* per-community best-effort */ });
  }
}

async function scanCommunity(pk: string, c: StoredCommunity): Promise<void> {
  const wrapClock = getChannelWrapTimes(c.community_id);
  const planeIndex = new Map<string, { plane: GroupKey; epoch: number; channelId: string }>();
  let oldestSinceMs = Infinity;
  const floorMs = Date.now() - LOOKBACK_S * 1000;

  for (const ch of c.channels) {
    if (isMuted(c.community_id, ch.id)) continue;
    const lastRead = readChannelLastRead(c.community_id, ch.id);
    if ((wrapClock.get(ch.id) ?? 0) <= lastRead) continue; // nothing newer than the mark
    // Decrypt-free pass first: mentions already decoded by the live chat but
    // not yet read (the ledger will refuse anything the mark has passed).
    await scanCachedMentions(pk, c.community_id, ch.id, lastRead);
    oldestSinceMs = Math.min(oldestSinceMs, Math.max(lastRead, floorMs));
    try {
      for (const { plane, epoch } of channelReadPlanes(c, ch)) {
        planeIndex.set(plane.pk, { plane, epoch, channelId: ch.id });
      }
    } catch { /* channel without derivable planes — skip */ }
  }
  if (planeIndex.size === 0 || !Number.isFinite(oldestSinceMs)) return;

  // Armada-flavored relays NIP-42-gate wrap reads by their filter authors.
  registerPlaneAuth(c.relays, [...planeIndex.values()].map((p) => p.plane));
  const since = Math.floor(oldestSinceMs / 1000);
  const wraps = await collectWraps(c.relays, [...planeIndex.keys()], since);

  // Newest first, hard cap per community per pass.
  wraps.sort((a, b) => b.created_at - a.created_at);
  const batch = wraps.slice(0, MAX_WRAPS_PER_COMMUNITY);

  for (const wrap of batch) {
    const held = planeIndex.get(wrap.pubkey);
    if (!held) continue;
    if (wrap.created_at * 1000 <= readChannelLastRead(c.community_id, held.channelId)) continue;
    if (await isStreamProcessed(pk, wrap.id)) continue; // decrypt-once: live chat already has it
    await decryptionQueue
      .enqueue(wrap.id, async () => processWrap(pk, c, held, wrap))
      .catch(() => { /* one bad wrap must not stop the pass */ });
  }
}

/** Decode one not-yet-processed wrap; cache + ledger-mark full messages. */
async function processWrap(
  pk: string,
  c: StoredCommunity,
  held: { plane: GroupKey; epoch: number; channelId: string },
  wrap: Event,
): Promise<void> {
  const rumor = decodeStreamEvent(held.plane, wrap);
  if (!rumor) {
    // Deterministically undecodable — mark so neither we nor the live sub
    // burn crypto on it again.
    await markStreamProcessed(pk, wrap.id);
    return;
  }
  const routed = routeRumor(rumor, held.channelId, held.epoch);
  if (routed.type === "message" || routed.type === "reply") {
    // Mirror ConcordChat's ChatMsg build exactly, so the cache row is
    // indistinguishable from a live-decoded one.
    const media = mediaFromTags(rumor.tags);
    const parentId = rumor.tags.find((t) => t[0] === "e")?.[1];
    const parentPk = rumor.tags.find((t) => t[0] === "p")?.[1];
    const mentions = rumor.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
    const msg: CachedMessage = {
      id: rumor.id,
      pubkey: rumor.pubkey,
      content: rumor.content,
      t: effectiveTime(rumor),
      media: media.length ? media : undefined,
      replyTo: parentId && parentPk ? { id: parentId, pubkey: parentPk } : undefined,
      mentions: mentions.length ? mentions : undefined,
    };
    await cacheMessage(pk, c.community_id, held.channelId, msg);
    await markStreamProcessed(pk, wrap.id); // cache first, mark second
    if (rumorMentionsMe(rumor.tags, pk, rumor.pubkey)) {
      recordMention(c.community_id, held.channelId, rumor.id, msg.t);
    }
    return;
  }
  if (routed.type === "ignored") {
    // Wrong channel/epoch binding — the live sub would drop it too.
    await markStreamProcessed(pk, wrap.id);
    return;
  }
  // reaction / delete / edit / control / join_leave: deliberately UNMARKED —
  // the live pipeline owns their ordering (pendingDeletes, tombstones). They
  // decode again on channel open; that is the correctness-over-thrift trade.
}

/** Mentions among already-decrypted cached messages newer than the read mark. */
async function scanCachedMentions(
  pk: string,
  communityId: string,
  channelId: string,
  lastRead: number,
): Promise<void> {
  const msgs = await getCachedMessages(pk, communityId, channelId).catch(() => [] as CachedMessage[]);
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.t <= lastRead) break; // ascending order — nothing older can qualify
    if (m.deleted || m.pubkey === pk) continue;
    if (m.mentions?.includes(pk)) recordMention(communityId, channelId, m.id, m.t);
  }
}

/** One-shot bounded wrap fetch: resolve on EOSE (or a timeout for dead relays). */
function collectWraps(relays: string[], authors: string[], since: number): Promise<Event[]> {
  return new Promise((resolve) => {
    const out: Event[] = [];
    let done = false;
    let sub: { close: () => void } | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { sub?.close(); } catch {}
      resolve(out);
    };
    const guard = setTimeout(finish, EOSE_TIMEOUT_MS);
    sub = persistentPoolSubscribe(
      relays,
      { kinds: [KIND_STREAM_WRAP], authors, since, limit: MAX_WRAPS_PER_COMMUNITY * 4 },
      {
        onevent: (e: Event) => { if (!done) out.push(e); },
        oneose: () => { clearTimeout(guard); setTimeout(finish, 0); },
      },
    );
    if (done) { try { sub.close(); } catch {} } // timeout fired before assignment
  });
}
