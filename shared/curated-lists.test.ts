/**
 * The curated lists the app suggests (starter communities, suggested news
 * feeds) live in one file, shared/curated-lists.ts. The server serves it at
 * /api/curated, so a fix reaches everyone at deploy, even an installed app
 * still on an older build; the app keeps the same file built in as its
 * fallback. Whatever arrives is checked entry by entry: a malformed entry is
 * dropped, never shown.
 */
import { describe, it, expect } from "vitest";
import { CURATED_LISTS, parseCuratedLists, isStarterCommunity, isCuratedFeed } from "./curated-lists";

describe("the shipped curated lists", () => {
  it("every entry passes the same check the app applies (nothing silently dropped)", () => {
    expect(CURATED_LISTS.starterCommunities.length).toBeGreaterThan(0);
    expect(CURATED_LISTS.suggestedFeeds.length).toBeGreaterThan(0);
    expect(CURATED_LISTS.starterCommunities.filter((c) => !isStarterCommunity(c))).toEqual([]);
    expect(CURATED_LISTS.suggestedFeeds.filter((f) => !isCuratedFeed(f))).toEqual([]);
  });

  it("no address appears twice in a list", () => {
    const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dupes(CURATED_LISTS.starterCommunities.map((c) => c.url))).toEqual([]);
    expect(dupes(CURATED_LISTS.suggestedFeeds.map((f) => f.url))).toEqual([]);
  });
});

describe("parseCuratedLists", () => {
  it("keeps good entries and drops malformed ones", () => {
    const got = parseCuratedLists({
      starterCommunities: [
        { url: "wss://good.example", name: "Good", tagline: "A good room" },
        { url: "https://not-a-relay.example", name: "Bad", tagline: "x" },
        { url: "wss://no-name.example", name: "", tagline: "x" },
        "junk",
      ],
      suggestedFeeds: [
        { name: "Feed", url: "https://feed.example/rss", category: "World" },
        { name: "No url", category: "World" },
        { name: "Script", url: "javascript:alert(1)", category: "World" },
      ],
    });
    expect(got?.starterCommunities?.map((c) => c.url)).toEqual(["wss://good.example"]);
    expect(got?.suggestedFeeds?.map((f) => f.url)).toEqual(["https://feed.example/rss"]);
  });

  it("not an object, or no lists in it: null", () => {
    expect(parseCuratedLists(null)).toBeNull();
    expect(parseCuratedLists("<html>")).toBeNull();
    expect(parseCuratedLists({})).toEqual({});
  });
});
