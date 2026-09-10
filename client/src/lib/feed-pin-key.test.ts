/**
 * The Home feed's pin key (lib/feed-pin-key.ts): while the reader is not at
 * the top, the rendered list is frozen, and it may only break on a USER view
 * change — never on data arrival.
 *
 * Found 2026-09-10 while proving the back-navigation fix: the key used
 * `effectiveReachDepth` (`wotEnabled && wotReady ? reachDepth : "off"`), and
 * `wotReady` flips when trust scores finish loading — seconds after a fresh
 * load. A reader who started scrolling right away had the pinned list dropped
 * and re-filtered under them: measured once as the post being read landing
 * 3000px away, with no scroll write anywhere.
 */
import { describe, expect, it } from "vitest";
import { feedPinKey, type FeedViewChoices } from "./feed-pin-key";

const view: FeedViewChoices = {
  feedMode: "open_comms",
  customFeedId: "",
  feedSortMode: "latest",
  topTimeWindow: "24h",
  contentFilter: "all",
  feedStyle: "all",
  trendingSelector: "rising",
  pollSort: "new",
  discoverSort: "hot",
  reachDepth: "2hops",
  wotEnabled: true,
  wotReady: false,
  rankingEnabled: true,
  excludedTiers: ["low"],
};

describe("feedPinKey — the pin breaks on the reader's choices, never on data arrival", () => {
  it("trust scores becoming ready does not change the key", () => {
    expect(feedPinKey({ ...view, wotReady: true })).toBe(feedPinKey(view));
  });

  it("a reach-depth choice the reader makes does change it", () => {
    expect(feedPinKey({ ...view, reachDepth: "1hop" })).not.toBe(feedPinKey(view));
  });

  it("the excluded-tier set is compared as a set, not by insertion order", () => {
    const a = feedPinKey({ ...view, excludedTiers: ["low", "unknown"] });
    const b = feedPinKey({ ...view, excludedTiers: ["unknown", "low"] });
    expect(a).toBe(b);
  });
});
