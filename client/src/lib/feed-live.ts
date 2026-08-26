import type { NostrCustomFeed } from "@/hooks/use-nostr-feeds";

/**
 * Live-content helpers for the Saved feeds surface. All pure set math over the
 * already-cached data from LiveStatusContext (livePubkeys + live-stream
 * hashtags) — no new subscriptions, safe to recompute on every render.
 */

type FeedLike = Pick<NostrCustomFeed, "authorPubkeys" | "hashtags">;

/**
 * True when a saved feed currently surfaces a live author. The reliable core is
 * an author-pubkey intersection with the live set; for author-less (topic)
 * feeds we optionally fall back to a best-effort match of the feed's hashtags
 * against the tags of currently-live streams.
 */
export function feedHasLive(
  feed: FeedLike,
  livePubkeys: Set<string>,
  liveHashtags?: Set<string>,
): boolean {
  if (livePubkeys.size > 0 && feed.authorPubkeys?.length) {
    for (const pk of feed.authorPubkeys) {
      if (livePubkeys.has(pk)) return true;
    }
  }
  if (liveHashtags && liveHashtags.size > 0 && feed.hashtags?.length) {
    for (const tag of feed.hashtags) {
      if (liveHashtags.has(tag.toLowerCase())) return true;
    }
  }
  return false;
}

/**
 * The deduped set of live pubkeys that appear as an author in any of the user's
 * saved feeds — the "relevant to the user" live set that gates the Live-now
 * entry and provides its count.
 */
export function relevantLivePubkeys(
  feeds: FeedLike[],
  livePubkeys: Set<string>,
): Set<string> {
  const result = new Set<string>();
  if (livePubkeys.size === 0) return result;
  for (const feed of feeds) {
    for (const pk of feed.authorPubkeys ?? []) {
      if (livePubkeys.has(pk)) result.add(pk);
    }
  }
  return result;
}

/** How many relevant live authors there are — the Live-now entry's count. */
export function liveNowCount(feeds: FeedLike[], livePubkeys: Set<string>): number {
  return relevantLivePubkeys(feeds, livePubkeys).size;
}

/**
 * Whether the conditional "Live now" entry should render: only when at least
 * one live author is relevant to the user's saved feeds. Vanishes (returns
 * false) when nothing relevant is live — zero clutter.
 */
export function shouldShowLiveNow(feeds: FeedLike[], livePubkeys: Set<string>): boolean {
  return liveNowCount(feeds, livePubkeys) > 0;
}
