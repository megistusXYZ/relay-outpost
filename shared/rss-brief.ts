/**
 * A feed's headlines without every article's full text.
 *
 * /api/rss answers with each item's whole article (`fullContent`, up to 50,000
 * characters apiece) because the News reader opens stories in place. A page
 * that only shows headlines pays for all of it anyway: on Discover the eight
 * front-page outlets came to ~360 KB on the wire, ~300 KB of it article text
 * nobody on that page can read, and on a slow phone the news picture waited
 * behind it (live, 2026-11-21). `?brief=1` asks for the same feed without it.
 *
 * Both sides share ONE cache entry per feed (the same react-query key), so a
 * brief answer carries a mark. A reader that needs the articles treats a
 * marked entry as stale and asks again; it still paints the headlines it
 * already has while it does.
 */

/** How long a cached full feed stands in for a new request. */
export const FEED_FRESH_MS = 10 * 60_000;

type FeedLike = { items?: Array<{ fullContent?: string }> };

/** The same feed with the article text dropped from every item. Never mutates. */
export function briefFeed<T extends FeedLike>(feed: T): Omit<T, "items"> & { items: NonNullable<T["items"]>; brief: true } {
  const items = (feed.items ?? []).map((item) => ({ ...item, fullContent: "" })) as NonNullable<T["items"]>;
  return { ...feed, items, brief: true };
}

/** Only the mark counts: an article can be genuinely empty in a full feed. */
export function isBriefFeed(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { brief?: unknown }).brief === true;
}

/**
 * staleTime for a reader that needs the articles: a brief entry is never
 * fresh (ask again, now), anything else is good for the usual window.
 */
export function feedFreshFor(data: unknown): number {
  return isBriefFeed(data) ? 0 : FEED_FRESH_MS;
}
