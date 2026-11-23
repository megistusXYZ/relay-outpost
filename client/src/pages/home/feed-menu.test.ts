/**
 * The Home feed's controls (owner-approved redesign, 2026-10-02): tabs switch,
 * one filter shows the current feed's options, Feeds is a list.
 */
import { describe, it, expect } from "vitest";
import {
  FEED_TABS, tabForFeedMode, tabTap, feedsTabLabel, feedName, filterGroups,
  trendingFilter, pickFrom, trendingSelectorOrDefault,
  DEFAULT_TRENDING_SELECTOR, startingTrendingSelector, TRENDING_CHART_CHOICES, trendingSpanSeconds,
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

  // Trending is your circle since 2026-11-23: with nobody followed there is no circle to rank,
  // so like Following it asks a visitor to sign in.
  it("signed out: Following, Trending and Feeds ask you to sign in; For you just works", () => {
    expect(tabTap("following", on("raw_signal", false))).toEqual({ do: "sign-in" });
    expect(tabTap("feeds", on("raw_signal", false))).toEqual({ do: "sign-in" });
    expect(tabTap("trending", on("raw_signal", false))).toEqual({ do: "sign-in" });
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

  it("Trending: one row, from when. It was fourteen buttons and a paragraph, then two rows", () => {
    expect(filterGroups({ ...env, feedMode: "deep_scan" })).toEqual(["from"]);
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

/**
 * Trending had five rankings: Overall, and four count charts (likes, thanks,
 * replies, reposts) over ranges from today to all time. The count charts came
 * from an outside archive that stopped its service (owner, 2026-11-21). What
 * is left is the one ranking that still has a source, over its two windows.
 */
describe("Trending in your circle: today, or this week (owner, 2026-11-23)", () => {
  it("the filter offers the two spans and nothing else", () => {
    const f = trendingFilter("circle_24h");
    expect(f.from).toBe("24h");
    expect(f.fromOptions.map((o) => o.label)).toEqual(["Today", "This week"]);
    expect(trendingFilter("circle_7d").from).toBe("7d");
    expect(Object.keys(f).sort()).toEqual(["from", "fromOptions"]);
  });

  it("picking a span sets it, and each span knows how far back it reaches", () => {
    expect(pickFrom("24h")).toEqual({ selector: "circle_24h" });
    expect(pickFrom("7d")).toEqual({ selector: "circle_7d" });
    expect(trendingSpanSeconds("circle_24h")).toBe(86_400);
    expect(trendingSpanSeconds("circle_7d")).toBe(7 * 86_400);
  });

  it("every span offered is one Trending can show", () => {
    for (const r of trendingFilter("circle_24h").fromOptions) {
      expect(trendingFilter(pickFrom(r.value).selector).from, r.label).toBe(r.value);
    }
  });

  it("a phone still set to a chart that is gone shows the default, not an empty page", () => {
    for (const gone of ["trending_1h", "trending_4h", "arc_reactions", "arc_zaps", "polls", "something-old"]) {
      expect(trendingSelectorOrDefault(gone), gone).toBe("circle_24h");
      expect(trendingFilter(gone).from, gone).toBe("24h");
      expect(trendingSpanSeconds(gone), gone).toBe(86_400);
    }
    expect(trendingSelectorOrDefault("circle_7d")).toBe("circle_7d");
  });
});

describe("where Trending opens: today, unless someone chose the week", () => {
  it("opens on today when nothing was chosen", () => {
    expect(DEFAULT_TRENDING_SELECTOR).toBe("circle_24h");
    expect(startingTrendingSelector(null, null)).toBe("circle_24h");
    expect(trendingFilter(startingTrendingSelector(null, null)).from).toBe("24h");
  });

  it("keeps a choice someone made, the session's own pick first", () => {
    expect(startingTrendingSelector(null, "circle_7d")).toBe("circle_7d");
    expect(startingTrendingSelector("circle_24h", "circle_7d")).toBe("circle_24h");
  });

  it("a saved chart from the outside ranking, or older, opens today", () => {
    for (const v of ["trending_1h", "trending_4h", "trending_12h", "trending_24h", "arc_reactions", "rising", "hot", "weekly_top", "mostzapped_week"]) {
      expect(startingTrendingSelector(null, v), v).toBe("circle_24h");
      expect(startingTrendingSelector(v, "circle_7d"), v).toBe("circle_24h");
    }
  });

  it("Settings offers exactly the spans Trending has, today first", () => {
    expect(TRENDING_CHART_CHOICES.map((c) => c.value)).toEqual(["circle_24h", "circle_7d"]);
    for (const c of TRENDING_CHART_CHOICES) expect(trendingSelectorOrDefault(c.value)).toBe(c.value);
    expect(TRENDING_CHART_CHOICES.map((c) => c.label)).toEqual(["Today", "This week"]);
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
    // The Feeds pill toggles: a second tap closes what the first opened
    // (2026-10-14; the popover ignores a tap on its own pill).
    expect(handler.match(/setFeedsOpen\(\(o\) => !o\)/g)).toHaveLength(1);
    expect(handler).not.toMatch(/setFeedsOpen\(true\)/);
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
