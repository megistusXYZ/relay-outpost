import type { Event } from "nostr-tools";

/**
 * Fold media events into the feed's event list.
 *
 * This exists because of a library boundary, not a design choice. The feed
 * reads through `eventStore.timeline({ kinds: [...] })`, and applesauce's
 * timeline does NOT emit kinds 20/21/22 even when the query names them —
 * `getByFilters` with the same kinds finds them, the timeline never yields
 * them. Measured end to end: 28 media events arrived from relays, 28
 * round-tripped back out of the store by id, 24 were queryable by kind, and
 * ZERO reached the feed filter.
 *
 * The likely reason is NIP-01's kind ranges: "regular" is defined as
 * 1000–9999, and NIP-68/71 put pictures and video in the under-1000 band that
 * predates them. A store classifying by range can reasonably keep those events
 * while excluding them from a timeline.
 *
 * So media is fetched separately and merged here rather than waiting on the
 * timeline to change its mind. When applesauce does emit these kinds, this
 * becomes a no-op — the dedupe already handles the same event arriving from
 * both sides.
 */

/**
 * How much media may ride along with a ranked list, as a fraction of that
 * list's own length. 0.5 means at most one picture per two ranked posts, so
 * media settles at roughly a third of what you see.
 *
 * An ABSOLUTE cap was tried first and was wrong: trending starts small, so a
 * cap of 120 never bound and the first live run rendered 22 media against 9
 * ranked posts — media outnumbering the ranking 2:1. The budget has to scale
 * with the list it is joining, or "supplement" quietly becomes "replace".
 */
export const SUPPLEMENT_RATIO = 0.5;

/**
 * The newest N media events a ranked list of this size can carry.
 *
 * Sorted before slicing, deliberately: taking store order would hand back
 * whichever events happened to be indexed first, which is not the newest and
 * is not anything a reader would recognise as an ordering.
 */
export function limitSupplementShare(base: Event[], media: Event[], ratio = SUPPLEMENT_RATIO): Event[] {
  const budget = Math.floor((base?.length ?? 0) * ratio);
  if (budget <= 0 || !media || media.length === 0) return [];
  return [...media].sort((a, b) => b.created_at - a.created_at).slice(0, budget);
}

/** Newest first, deduped by id, base wins on collision. */
export function mergeSupplementIntoFeed(base: Event[], media: Event[], cap?: number): Event[] {
  if (!media || media.length === 0) return base ?? [];
  const safeBase = base ?? [];
  const seen = new Set<string>();
  for (const e of safeBase) if (e?.id) seen.add(e.id);

  const additions: Event[] = [];
  for (const e of media) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    additions.push(e);
  }
  if (additions.length === 0) return safeBase;

  // Chronological, because that is the only ordering media HAS. Primal ranks
  // the text feed; these events never passed through that ranking, so any
  // other placement would be inventing a score we did not compute.
  const out = safeBase.concat(additions).sort((a, b) => b.created_at - a.created_at);
  return typeof cap === "number" && cap > 0 ? out.slice(0, cap) : out;
}

/**
 * Spread media evenly through a ranked list instead of sorting by time.
 *
 * Sorting newest-first is right for a chronological feed and WRONG here, and
 * the live run showed exactly why: media events are all recent, so a
 * time-ordered merge stacked every one of them at the top and the first
 * screens came out 57% pictures. The ratio budget was being honoured over the
 * whole list while the part anyone actually sees was flooded.
 *
 * Even placement keeps the ranked order intact — post 1 is still the top post —
 * and drops a picture in every few slots, which is what "one feed, mixed
 * media" is supposed to feel like.
 */
export function interleaveSupplement(base: Event[], media: Event[]): Event[] {
  const safeBase = base ?? [];
  const safeMedia = (media ?? []).filter((e) => e?.id);
  if (safeMedia.length === 0) return safeBase;
  if (safeBase.length === 0) return safeMedia;

  const seen = new Set(safeBase.map((e) => e.id));
  const additions = safeMedia.filter((e) => !seen.has(e.id));
  if (additions.length === 0) return safeBase;

  // One media slot every `step` ranked posts, rounded so the last insert still
  // lands inside the list rather than trailing off the end.
  const step = Math.max(1, Math.floor(safeBase.length / additions.length));
  const out: Event[] = [];
  let mi = 0;
  for (let i = 0; i < safeBase.length; i++) {
    out.push(safeBase[i]);
    if (mi < additions.length && (i + 1) % step === 0) out.push(additions[mi++]);
  }
  // Anything left over (media outnumbering the slots) goes on the end rather
  // than being silently dropped — the budget already bounded how many there are.
  while (mi < additions.length) out.push(additions[mi++]);
  return out;
}

/**
 * Split one supplement budget between media and relay text.
 *
 * ONE budget, not two. Media already sits at roughly a third of the feed and
 * that was judged right; adding a second independent budget for relay text
 * would push the unranked share past half and quietly turn a ranked feed into
 * a chronological one. So the supplement slots are shared — what changes is
 * that they are no longer all Primal-adjacent media.
 *
 * Media takes the larger share because surfacing it is what this initiative is
 * for; relay text fills whatever is left, which is the part that makes the feed
 * stop being one provider's feed.
 */
export const MEDIA_SHARE_OF_SUPPLEMENT = 0.6;

export function splitSupplement(
  base: Event[],
  media: Event[],
  relayText: Event[],
  ratio = SUPPLEMENT_RATIO,
): Event[] {
  const budget = Math.floor((base?.length ?? 0) * ratio);
  if (budget <= 0) return [];
  const newest = (list: Event[], n: number) =>
    n <= 0 || !list?.length ? [] : [...list].filter((e) => e?.id).sort((a, b) => b.created_at - a.created_at).slice(0, n);

  const mediaPick = newest(media, Math.ceil(budget * MEDIA_SHARE_OF_SUPPLEMENT));
  // Relay text takes whatever media did not use, so a quiet media hour widens
  // the independent share rather than shrinking the supplement.
  const textPick = newest(relayText, budget - mediaPick.length);
  // Interleaved by recency, NOT concatenated. Returning media-then-text puts
  // every relay post after every picture, so the independent supply lands past
  // the fold and reads as absent — which is exactly what the first live run
  // showed: 12 relay posts picked, zero visible. The budget picks WHAT rides
  // along; this decides where, and both need to be mixed.
  return [...mediaPick, ...textPick].sort((a, b) => b.created_at - a.created_at);
}

/**
 * No two consecutive posts from the same author.
 *
 * Trending never deduped authors — `crossAuthorDedupe` is wired for the global
 * feed only — so a burst from one person in a good hour takes three or four
 * slots in a row and the feed reads like their timeline. Ranking is per-event
 * and has no opinion about who you already just read.
 *
 * Extras are not dropped, only deferred: a person who posted five good things
 * still gets five slots, spread out. Anything that cannot be spaced (the tail
 * of a very lopsided list) lands at the end rather than being thrown away.
 */
export function spreadAuthors<T extends { pubkey: string }>(events: T[]): T[] {
  if (!events || events.length < 3) return events ?? [];
  const out: T[] = [];
  const deferred: T[] = [];
  const queue = [...events];

  while (queue.length > 0) {
    const last = out[out.length - 1]?.pubkey;
    // First item that isn't by whoever we just placed.
    const idx = queue.findIndex((e) => e.pubkey !== last);
    if (idx === -1) {
      // Everything remaining is by the same author as the previous slot —
      // nothing left to interleave with, so they go on the end in order.
      deferred.push(...queue);
      break;
    }
    out.push(queue.splice(idx, 1)[0]);
  }
  return [...out, ...deferred];
}
