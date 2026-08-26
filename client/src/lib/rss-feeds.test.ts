import { describe, it, expect } from "vitest";
import {
  NEWS_FRONT_PAGE_URLS,
  NEWS_STARTER_FEEDS,
  PODCAST_FEED_URLS,
  PRESET_FEED_URLS,
  ALL_PRESET_FEEDS,
} from "./rss-feeds";
import { categoryToBucket, type NewsBucket } from "./news-categories";

describe("NEWS_FRONT_PAGE_URLS (News-perf Phase 2 front page)", () => {
  it("stays small — a curated first paint, not the whole library", () => {
    expect(NEWS_FRONT_PAGE_URLS.size).toBeGreaterThanOrEqual(6);
    expect(NEWS_FRONT_PAGE_URLS.size).toBeLessThanOrEqual(20);
  });

  it("seeds EVERY topic bucket that the starter news set can surface", () => {
    // The tab bar only renders a bucket that already has ≥1 article, so the
    // front page must include a feed for each bucket the starters cover — else
    // that tab never appears to be tapped.
    const bucketsFromStarters = new Set<NewsBucket>();
    for (const f of NEWS_STARTER_FEEDS) {
      const b = categoryToBucket(f.category);
      if (b) bucketsFromStarters.add(b);
    }
    const bucketsOnFrontPage = new Set<NewsBucket>();
    for (const url of NEWS_FRONT_PAGE_URLS) {
      const feed = ALL_PRESET_FEEDS.find((f) => f.url === url);
      const b = feed ? categoryToBucket(feed.category) : null;
      if (b) bucketsOnFrontPage.add(b);
    }
    for (const b of bucketsFromStarters) {
      expect(bucketsOnFrontPage.has(b)).toBe(true);
    }
  });

  it("includes at least one flagship podcast so the shelf populates on first paint", () => {
    const hasPodcast = [...NEWS_FRONT_PAGE_URLS].some((url) => PODCAST_FEED_URLS.has(url));
    expect(hasPodcast).toBe(true);
  });

  it("references only real preset feeds (no stale URLs)", () => {
    for (const url of NEWS_FRONT_PAGE_URLS) {
      expect(PRESET_FEED_URLS.has(url)).toBe(true);
    }
  });
});
