/**
 * The Home feed's pin key. While the reader is not at the top, the rendered
 * list is frozen (Home.tsx `displayedEvents`), and it may break ONLY on a view
 * change the reader makes — tab, sort, filter, reach, trust choices — never on
 * data arrival.
 *
 * That is why this takes the reader's CHOSEN `reachDepth`, not the effective
 * one. `wotReady` flips when trust scores finish loading, seconds after a fresh
 * load; a key that followed it dropped and re-filtered the list under a reader
 * who had started scrolling — measured as the post being read landing 3000px
 * away, with no scroll write anywhere. Readiness still gates the FILTERING;
 * only the pin ignores it.
 */
export interface FeedViewChoices {
  feedMode: string;
  customFeedId: string;
  feedSortMode: string;
  topTimeWindow: string;
  contentFilter: string;
  feedStyle: string;
  trendingSelector: string;
  pollSort: string;
  discoverSort: string;
  reachDepth: string;
  wotEnabled: boolean;
  /** Taken so callers pass their whole view state — deliberately NOT in the key. */
  wotReady: boolean;
  rankingEnabled: boolean;
  excludedTiers: Iterable<string>;
}

export function feedPinKey(v: FeedViewChoices): string {
  return [
    v.feedMode,
    v.customFeedId,
    v.feedSortMode,
    v.topTimeWindow,
    v.contentFilter,
    v.feedStyle,
    v.trendingSelector,
    v.pollSort,
    v.discoverSort,
    v.reachDepth,
    v.rankingEnabled ? "1" : "0",
    v.wotEnabled ? "1" : "0",
    Array.from(v.excludedTiers).sort().join(","),
  ].join("|");
}
