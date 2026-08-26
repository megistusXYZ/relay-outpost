/**
 * Yield-aware page sizing — the "feel endless" half of the filtered-scroll
 * fix. #661 made the sentinel refill after filtered loads (the scroll no
 * longer DIES); this makes each refill worth a screenful (the scroll no
 * longer STUTTERS). With the trust filter keeping ~1 of 30, a fixed page
 * meant one visible post per relay round-trip — the loader was permanently a
 * couple of posts away. When a page's visible yield collapses, the next page
 * triples, up to a cap; when yield recovers, the size halves back toward
 * base, so an unfiltered feed never pays for a filtered one's history.
 */
export const BASE_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 300;

/** Visible posts a single round-trip should aim to produce. */
const TARGET_VISIBLE_PER_PAGE = 10;

export interface PageYieldInput {
  prevLimit: number;
  /** Raw events the relay returned for the last page (pre-dedup, pre-filter). */
  rawCount: number;
  /** Events that survived dedup + the active filters — what the user gained. */
  visibleAdded: number;
}

export function nextPageLimit({ prevLimit, rawCount, visibleAdded }: PageYieldInput): number {
  const prev = Math.max(BASE_PAGE_LIMIT, Math.min(MAX_PAGE_LIMIT, prevLimit || BASE_PAGE_LIMIT));
  // A short raw page is the relay running dry, not the filter biting — growing
  // the ask cannot conjure history that does not exist.
  if (rawCount < prev) return prev;
  if (visibleAdded >= TARGET_VISIBLE_PER_PAGE) {
    // Healthy yield: decay toward base so the bigger pages do not outlive the
    // filtered stretch that justified them.
    return Math.max(BASE_PAGE_LIMIT, Math.floor(prev / 2));
  }
  // Starved: grow aggressively — a stutter costs the user seconds per missing
  // post; an oversized ask costs the relay a bigger single query.
  return Math.min(MAX_PAGE_LIMIT, prev * 3);
}
