// Canonical News topic taxonomy — the source of truth for the News page's
// topic-tab bar. Each saved feed carries a free-form `category` string (see
// lib/rss-feeds.ts: "World", "Markets", "Technology", …). This module folds
// that long, editorial list down to a SMALL, fixed set of reader-facing topic
// buckets so the tab bar stays short and legible.
//
// "Top" is implicit (the whole diversified feed) and is deliberately NOT a
// bucket here — the tab bar renders "Top" plus whichever of these buckets
// currently has at least one article. A feed category that maps to no bucket
// (Entertainment & Culture, Longform, Podcasts, ad-hoc custom categories, …)
// resolves to null and its articles appear ONLY under "Top".
//
// Everything here is pure and framework-free (unit-tested in
// news-categories.test.ts): the caller builds the url→category map from the
// loaded feeds and passes it in, so this module never touches storage/network.

/** The canonical topic buckets, in the order their tabs render (after "Top"). */
export type NewsBucket = "News" | "Business" | "Tech" | "Sports" | "Health" | "Science";

/** Buckets in display order. The tab bar renders "Top" then this list, filtered
 *  to those with ≥1 article in the current merged set. */
export const NEWS_BUCKETS: readonly NewsBucket[] = [
  "News",
  "Business",
  "Tech",
  "Sports",
  "Health",
  "Science",
] as const;

/** Tab labels. 1:1 with the bucket key today, but kept separate so display copy
 *  can diverge from the internal key without touching call sites. */
export const NEWS_BUCKET_LABELS: Record<NewsBucket, string> = {
  News: "News",
  Business: "Business",
  Tech: "Tech",
  Sports: "Sports",
  Health: "Health",
  Science: "Science",
};

// Static map from every category string used in lib/rss-feeds.ts (ALL_DEFAULT_FEEDS
// + SUGGESTED_FEEDS), plus the singular "Podcast" the News page assigns to ad-hoc
// podcast adds, onto its canonical bucket. Categories intentionally left OUT —
// "Entertainment & Culture", "Longform", "Podcasts", "Podcast", "Custom", the ten
// dedicated podcast-library categories ("Interviews & Ideas", "Comedy",
// "Bitcoin & Crypto", "Business & Investing", "Science & Tech", "Health & Longevity",
// "Mind & Wellness", "News & Commentary", "True Crime & Curiosity",
// "Culture & Creativity") and any user-defined string — resolve to null (Top-only), so
// podcast episodes stay out of the news topic tabs. (The podcast library's "Sports" and
// "Nostr" categories DO map, below, since they reuse existing news categories.) Keep
// this in sync when a new feed category is introduced in rss-feeds.ts.
const CATEGORY_TO_BUCKET: Readonly<Record<string, NewsBucket>> = {
  // News — hard news: world, US & breaking, politics, local reporting.
  "World": "News",
  "US & Breaking": "News",
  "Politics": "News",
  "Local": "News",
  // Business — finance, markets, and the money side of crypto.
  "Business & Finance": "Business",
  "Markets": "Business",
  "Bitcoin": "Business",
  // Tech — technology, the Nostr protocol, and privacy/security.
  "Technology": "Tech",
  "Nostr": "Tech",
  "Privacy": "Tech",
  // Single-topic buckets.
  "Sports": "Sports",
  "Health": "Health",
  "Science": "Science",
};

/** Resolve a feed's category string to its canonical bucket, or null (Top-only)
 *  for unmapped / empty categories. */
export function categoryToBucket(category: string | undefined | null): NewsBucket | null {
  if (!category) return null;
  return CATEGORY_TO_BUCKET[category] ?? null;
}

/** The article shape this module needs: just its originating source url. Merged
 *  News items ({ source: { url } }) satisfy it directly. */
export interface Categorizable {
  source?: { url?: string };
}

/**
 * Canonical topic bucket for a merged News item: resolve its source url → that
 * feed's category (via the caller-supplied url→category map) → bucket. Returns
 * null when the source is unknown or its category maps to no bucket (those items
 * surface only under "Top"). Pure — the map is passed in, built once by the
 * caller from the loaded feeds.
 */
export function articleCategory(
  item: Categorizable,
  feedCategoryByUrl: ReadonlyMap<string, string>,
): NewsBucket | null {
  const url = item.source?.url;
  if (!url) return null;
  return categoryToBucket(feedCategoryByUrl.get(url));
}
