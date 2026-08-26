import type { Event } from "nostr-tools";

/**
 * Pure sort/filter helpers for poll feeds (kind 1068, NIP-88), kept free of
 * relay/pool imports so they unit-test in the node vitest environment.
 *
 * Value vocabulary is shared with the For You trending-polls surface (Home's
 * pollSort, POLL_SORTS in pages/home/helpers.ts): "trending" uses the same
 * hot-score formula and "expiring" is that surface's "Expiring" — the Saved
 * Polls sheet labels it "Ending soon". "latest" is Saved-only.
 */

export type PollSortMode = "trending" | "latest" | "expiring";
export type PollShowMode = "open" | "all";

/** NIP-88 close time: the poll's `expiration` tag (unix seconds), if any. */
export function getPollExpiration(event: Event): number | null {
  const tag = event.tags.find((t) => t[0] === "expiration" && t[1]);
  if (!tag) return null;
  const ts = parseInt(tag[1], 10);
  return isNaN(ts) ? null : ts;
}

/** Open = no end time, or an end time that hasn't passed yet. */
export function isPollOpen(event: Event, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const exp = getPollExpiration(event);
  return exp === null || exp >= nowSec;
}

/** "open" hides polls whose end time has passed; "all" keeps everything. */
export function filterPollsByShow<T extends Event>(
  polls: T[],
  show: PollShowMode,
  nowSec: number = Math.floor(Date.now() / 1000),
): T[] {
  if (show === "all") return polls;
  return polls.filter((p) => isPollOpen(p, nowSec));
}

/**
 * Hot score: engagement (vote count) weighted by recency — the exact formula
 * the For You polls surface computes for its Trending sort. Keep in sync.
 */
export function pollHotScore(event: Event, votes: number, nowSec: number): number {
  const hours = Math.max((nowSec - event.created_at) / 3600, 0.5);
  return (votes + 1) / Math.pow(hours + 2, 1.5);
}

/**
 * Returns a NEW sorted array (input untouched).
 *
 *  - "trending": hot score desc (votes from responseCounts), ties by recency.
 *  - "latest":   created_at desc.
 *  - "expiring" (Ending soon): open polls by soonest close time first; open
 *    polls WITHOUT an end time sort after those (by recency); already-closed
 *    polls sort last (most recently ended first) — they only appear when the
 *    caller's Show filter is "all".
 */
export function sortPolls<T extends Event>(
  polls: T[],
  sort: PollSortMode,
  responseCounts: Map<string, number>,
  nowSec: number = Math.floor(Date.now() / 1000),
): T[] {
  const arr = polls.slice();

  if (sort === "latest") {
    arr.sort((a, b) => b.created_at - a.created_at);
    return arr;
  }

  if (sort === "trending") {
    arr.sort((a, b) => {
      const sa = pollHotScore(a, responseCounts.get(a.id) || 0, nowSec);
      const sb = pollHotScore(b, responseCounts.get(b.id) || 0, nowSec);
      if (sa !== sb) return sb - sa;
      return b.created_at - a.created_at;
    });
    return arr;
  }

  // "expiring": bucket 0 = open with an end time, 1 = open without, 2 = closed.
  const bucket = (e: Event): number => {
    const exp = getPollExpiration(e);
    if (exp === null) return 1;
    return exp >= nowSec ? 0 : 2;
  };
  arr.sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    if (ba === 1) return b.created_at - a.created_at;
    const expA = getPollExpiration(a)!;
    const expB = getPollExpiration(b)!;
    // Open: soonest close first. Closed: most recently ended first.
    const byExp = ba === 0 ? expA - expB : expB - expA;
    if (byExp !== 0) return byExp;
    return b.created_at - a.created_at;
  });
  return arr;
}
