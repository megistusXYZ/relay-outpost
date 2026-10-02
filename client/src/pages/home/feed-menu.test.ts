/**
 * The Home feed's controls (owner-approved redesign, 2026-10-02): tabs switch,
 * one filter shows the current feed's options, Feeds is a list.
 */
import { describe, it, expect } from "vitest";
import {
  FEED_TABS, tabForFeedMode, tabTap, feedsTabLabel, feedName, filterGroups,
  trendingFilter, pickTopBy, pickFrom, trendingSelectorOrDefault, TOP_BY_OPTIONS,
} from "./feed-menu";

const feeds = [
  { id: "abc123", name: "#naturestr" },
  { id: "def456", name: "Bitcoin Builders & Friends" },
];

describe("the tabs", () => {
  it("are For you, Following, Trending and Feeds, in that order", () => {
    expect(FEED_TABS.map((t) => t.label)).toEqual(["For you", "Following", "Trending", "Feeds"]);
  });

  it("Trending is its own tab, not a sort inside For you", () => {
    expect(tabForFeedMode("raw_signal")).toBe("foryou");
    expect(tabForFeedMode("deep_scan")).toBe("trending");
    expect(tabForFeedMode("open_comms")).toBe("following");
  });

  it("photos, videos, polls and every feed of your own light Feeds", () => {
    expect(tabForFeedMode("custom_all")).toBe("feeds");
    expect(tabForFeedMode("custom_abc123")).toBe("feeds");
  });
});

describe("tapping a tab", () => {
  const on = (feedMode: string, signedIn = true) => ({ feedMode, signedIn });

  it("switches to that feed — it does not open a menu", () => {
    expect(tabTap("following", on("raw_signal"))).toEqual({ do: "switch", to: "following" });
    expect(tabTap("trending", on("raw_signal"))).toEqual({ do: "switch", to: "trending" });
    expect(tabTap("foryou", on("deep_scan"))).toEqual({ do: "switch", to: "foryou" });
    expect(tabTap("foryou", on("custom_abc123"))).toEqual({ do: "switch", to: "foryou" });
  });

  it("the tab you're already on goes back to the top", () => {
    expect(tabTap("foryou", on("raw_signal"))).toEqual({ do: "top" });
    expect(tabTap("trending", on("deep_scan"))).toEqual({ do: "top" });
    expect(tabTap("following", on("open_comms"))).toEqual({ do: "top" });
  });

  it("Feeds opens its list, whether or not one of its feeds is on screen", () => {
    expect(tabTap("feeds", on("raw_signal"))).toEqual({ do: "open-feeds" });
    expect(tabTap("feeds", on("custom_all"))).toEqual({ do: "open-feeds" });
  });

  it("signed out: Following and Feeds ask you to sign in; For you and Trending just work", () => {
    expect(tabTap("following", on("raw_signal", false))).toEqual({ do: "sign-in" });
    expect(tabTap("feeds", on("raw_signal", false))).toEqual({ do: "sign-in" });
    expect(tabTap("trending", on("raw_signal", false))).toEqual({ do: "switch", to: "trending" });
    expect(tabTap("foryou", on("deep_scan", false))).toEqual({ do: "switch", to: "foryou" });
  });
});

describe("what the Feeds tab says", () => {
  it("'Feeds' while another tab is on screen", () => {
    for (const mode of ["raw_signal", "open_comms", "deep_scan"]) expect(feedsTabLabel(mode, "all", feeds)).toBe("Feeds");
  });

  it("the feed on screen while one is — in plain words", () => {
    expect(feedsTabLabel("custom_all", "photos", feeds)).toBe("Photos");
    expect(feedsTabLabel("custom_all", "video", feeds)).toBe("Videos");
    expect(feedsTabLabel("custom_all", "polls", feeds)).toBe("Polls");
    expect(feedsTabLabel("custom_abc123", "all", feeds)).toBe("#naturestr");
  });

  it("a feed that was deleted, or has no name, is just 'Feeds'", () => {
    expect(feedsTabLabel("custom_gone", "all", feeds)).toBe("Feeds");
    expect(feedsTabLabel("custom_x", "all", [{ id: "x", name: "   " }])).toBe("Feeds");
  });

  it("the built-in feed with no style picked is photos on screen, so it says Photos (it said 'Saved')", () => {
    expect(feedsTabLabel("custom_all", "all", feeds)).toBe("Photos");
    expect(feedName("custom_all", "all", feeds)).toBe("Photos");
  });

  it("the filter is titled with the feed it filters", () => {
    expect(feedName("raw_signal", "all", feeds)).toBe("For you");
    expect(feedName("deep_scan", "all", feeds)).toBe("Trending");
    expect(feedName("open_comms", "all", feeds)).toBe("Following");
    expect(feedName("custom_all", "video", feeds)).toBe("Videos");
    expect(feedName("custom_def456", "all", feeds)).toBe("Bitcoin Builders & Friends");
  });
});

describe("the filter shows the current feed's options and nothing else", () => {
  const env = { feedStyle: "all" as const, strictness: true, feedOrderRanks: false };

  it("For you: order, what to show, how strict", () => {
    expect(filterGroups({ ...env, feedMode: "raw_signal" })).toEqual(["order", "show", "strictness"]);
  });

  it("…without the strictness row when trust filtering isn't on", () => {
    expect(filterGroups({ ...env, feedMode: "raw_signal", strictness: false })).toEqual(["order", "show"]);
  });

  it("Following: order and what to show (the people are already chosen)", () => {
    expect(filterGroups({ ...env, feedMode: "open_comms" })).toEqual(["order", "show"]);
  });

  it("Trending: two rows — top by, and from when. It was fourteen buttons and a paragraph", () => {
    expect(filterGroups({ ...env, feedMode: "deep_scan" })).toEqual(["top-by", "from"]);
  });

  it("Photos and Videos: one row", () => {
    expect(filterGroups({ ...env, feedMode: "custom_all", feedStyle: "photos" })).toEqual(["media-order"]);
    expect(filterGroups({ ...env, feedMode: "custom_all", feedStyle: "video" })).toEqual(["media-order"]);
  });

  it("Polls: order, and open or all", () => {
    expect(filterGroups({ ...env, feedMode: "custom_all", feedStyle: "polls" })).toEqual(["poll-order", "poll-show"]);
  });

  it("a feed of your own: its order and what to show; a time range only when the order ranks", () => {
    expect(filterGroups({ ...env, feedMode: "custom_abc123" })).toEqual(["feed-order", "feed-show"]);
    expect(filterGroups({ ...env, feedMode: "custom_abc123", feedOrderRanks: true })).toEqual(["feed-order", "feed-from", "feed-show"]);
  });

  it("no feed is left without options, and none shows another feed's", () => {
    for (const feedMode of ["raw_signal", "open_comms", "deep_scan", "custom_all", "custom_abc123"]) {
      for (const feedStyle of ["all", "photos", "video", "polls"] as const) {
        const groups = filterGroups({ feedMode, feedStyle, strictness: true, feedOrderRanks: true });
        expect(groups.length, `${feedMode}/${feedStyle}`).toBeGreaterThan(0);
        expect(new Set(groups).size).toBe(groups.length);
      }
    }
  });
});

describe("Trending — 'Top by' and 'From' only offer what exists", () => {
  it("the plain names: Overall, Likes, Zaps, Replies, Reposts", () => {
    expect(TOP_BY_OPTIONS.map((o) => o.label)).toEqual(["Overall", "Likes", "Zaps", "Replies", "Reposts"]);
  });

  it("a chart (likes, zaps, replies, reposts) runs from today back to all time", () => {
    const f = trendingFilter("arc_zaps", "7d");
    expect(f.topBy).toBe("arc_zaps");
    expect(f.from).toBe("7d");
    expect(f.fromOptions.map((o) => o.label)).toEqual(["Today", "Week", "Month", "Year", "All time"]);
  });

  it("Overall only exists for the last hour or four hours — so those are its only ranges", () => {
    const f = trendingFilter("trending_1h", "30d");
    expect(f.topBy).toBe("overall");
    expect(f.from).toBe("1h");
    expect(f.fromOptions.map((o) => o.label)).toEqual(["Last hour", "Last 4 hours"]);
  });

  it("picking a chart keeps the range; picking Overall keeps its window, starting on four hours", () => {
    expect(pickTopBy("arc_replies", "trending_1h")).toEqual({ selector: "arc_replies" });
    expect(pickTopBy("overall", "arc_zaps")).toEqual({ selector: "trending_4h" });
    expect(pickTopBy("overall", "trending_1h")).toEqual({ selector: "trending_1h" });
  });

  it("picking a range sets the one thing it means", () => {
    expect(pickFrom("1h")).toEqual({ selector: "trending_1h" });
    expect(pickFrom("4h")).toEqual({ selector: "trending_4h" });
    expect(pickFrom("30d")).toEqual({ range: "30d" });
  });

  it("every range offered for a choice is one that choice can show", () => {
    for (const o of TOP_BY_OPTIONS) {
      const sel = pickTopBy(o.value, "arc_replies").selector;
      for (const r of trendingFilter(sel, "today").fromOptions) {
        const next = pickFrom(r.value);
        const after = trendingFilter(next.selector ?? sel, next.range ?? "today");
        expect(after.topBy, `${o.label} → ${r.label}`).toBe(o.value);
        expect(after.from).toBe(r.value);
      }
    }
  });

  it("Trending's own Polls list is gone (polls are under Feeds): a phone still set to it shows the default chart", () => {
    expect(trendingSelectorOrDefault("polls")).toBe("arc_replies");
    expect(trendingFilter("polls", "today").topBy).toBe("arc_replies");
    expect(trendingSelectorOrDefault("something-old")).toBe("arc_replies");
    expect(trendingSelectorOrDefault("trending_4h")).toBe("trending_4h");
  });
});

describe("the page draws these rules — and nothing opens on a tab tap but the Feeds list", () => {
  it("Home decides every tab tap through tabTap, and only the filter button opens the filter", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const home = readFileSync(path.resolve(import.meta.dirname, "../Home.tsx"), "utf8");
    const tabs = home.slice(home.indexOf('testId="container-feed-toggle"'), home.indexOf('data-testid="button-feed-filter"'));
    expect(tabs).toMatch(/tabs=\{FEED_TABS\.map\(/);
    expect(tabs).toMatch(/const tap = tabTap\(/);
    // The tab handler may CLOSE the filter (when the Feeds list opens); it never opens it.
    const handler = tabs.slice(tabs.indexOf("onChange={(key) =>"), tabs.indexOf("<button"));
    expect(handler).not.toMatch(/setFilterOpen\(true\)/);
    expect(handler.match(/setFeedsOpen\(true\)/g)).toHaveLength(1);
    // One filter button, one filter, fed by filterGroups.
    expect(home.match(/data-testid="button-feed-filter"/g)).toHaveLength(1);
    expect(home).toMatch(/groups=\{filterGroups\(\{/);
  });

  it("the filter stays open while you pick: no option handler closes it", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const filter = readFileSync(path.resolve(import.meta.dirname, "FeedFilter.tsx"), "utf8");
    // Two closes only: the link out to Trust & Safety, and Done.
    expect(filter.match(/onOpenChange\(false\)/g)).toHaveLength(2);
  });

  it("Trending's own polls list is gone from the page too: no fetch, no sort, no state for it", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const home = readFileSync(path.resolve(import.meta.dirname, "../Home.tsx"), "utf8");
    expect(home).not.toMatch(/fetchPollsFeed|pollResponseCounts|relay-outpost-poll-sort|selector === "polls"/);
    const helpers = readFileSync(path.resolve(import.meta.dirname, "helpers.ts"), "utf8");
    expect(helpers).not.toMatch(/group: "polls"|TRENDING_TIME_OPTIONS|export const POLL_SORTS/);
  });

  // One name for one thing (owner, 2026-10-02): the feed listed under Feeds as
  // "Photos" was "Images" in the browser tab, in Search's media hub, on
  // Discover's shelf, in Bookmarks and in the profile media section.
  it("the photos feed is called Photos wherever it appears, never Images", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, rel), "utf8");
    expect(read("../ImagesFeed.tsx")).toMatch(/useDocumentTitle\("Photos"\);/);
    for (const rel of ["../ImagesFeed.tsx", "../Search.tsx", "../Discover.tsx", "../Bookmarks.tsx", "../../components/MediaSection.tsx", "./feed-controls.tsx"]) {
      // A label, a title or a line of copy that says Images (code names like
      // ImagesFeed, keys like "images" and comments don't count).
      const shown = read(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*|import )/.test(l))
        .filter((l) => /label[=:] ?"Images"|: "Images"\}|>[^<>{}]*\bImages\b[^<>{}]*<|(title|description|label): [`"][^`"]*\bImages?\b/.test(l));
      expect(shown, rel).toEqual([]);
    }
  });

  it("the old menus are gone", async () => {
    const { existsSync } = await import("fs");
    const path = await import("path");
    expect(existsSync(path.resolve(import.meta.dirname, "FeedOptionsSheet.tsx"))).toBe(false);
    expect(existsSync(path.resolve(import.meta.dirname, "SavedOptionsSheet.tsx"))).toBe(false);
  });
});
