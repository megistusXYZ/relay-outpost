/**
 * The News starter (2026-09): 8 broad outlets and no podcasts, the owner's call
 * after the News page felt "forced with our agenda and presets". A mix of
 * headline wires and outlets whose feeds carry the full article. The outlets
 * that left the starter stay available in Browse. Libraries shaped under the
 * old starter are carried over by lib/news-library.ts (news-library.test.ts).
 */
import { describe, it, expect } from "vitest";
import { ALL_NEWS_FEEDS, DEFAULT_FEEDS, EXTRA_DEFAULT_FEEDS, PODCAST_FEED_URLS, STARTER_URLS_V2 } from "./rss-feeds";

describe("the News starter", () => {
  it("is exactly the 8 chosen outlets, with no podcasts", () => {
    expect(new Set(DEFAULT_FEEDS.map((f) => f.url))).toEqual(new Set(STARTER_URLS_V2));
    expect(STARTER_URLS_V2.size).toBe(8);
    expect(DEFAULT_FEEDS.some((f) => PODCAST_FEED_URLS.has(f.url))).toBe(false);
  });

  it("references only real preset news feeds (no stale URLs)", () => {
    const presets = new Set(ALL_NEWS_FEEDS.map((f) => f.url));
    for (const url of STARTER_URLS_V2) expect(presets.has(url)).toBe(true);
  });

  it("keeps the outlets that left the starter one tap away in Browse", () => {
    const browse = new Set(EXTRA_DEFAULT_FEEDS.map((f) => f.url));
    for (const url of [
      "https://feeds.feedburner.com/zerohedge/feed",
      "https://www.thefp.com/feed",
      "https://theintercept.com/feed/?rss",
      "https://bitcoinmagazine.com/feed",
    ]) {
      expect(browse.has(url)).toBe(true);
    }
  });
});
