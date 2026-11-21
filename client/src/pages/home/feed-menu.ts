/**
 * The Home feed's controls, as rules (owner-approved redesign, 2026-10-02).
 *
 * What was there: three tabs that each OPENED A MENU on every tap; "Trending"
 * hidden inside For you's Sort, where choosing it revealed fourteen more
 * buttons; and a "Saved" tab that was photos, videos, polls, hashtags, custom
 * feeds and three create/import actions at once.
 *
 * What it is now, the way every other feed app works:
 *
 *  - four tabs — For you · Following · Trending · Feeds. A tap SWITCHES. Only
 *    Feeds opens something, because Feeds is a list to pick from;
 *  - one filter button, showing the options of the feed on screen and nothing
 *    else. It stays open while you pick;
 *  - the same thing has one name everywhere ("Order", "Show", "From").
 *
 * This file is the whole decision — which tab is lit, what a tap does, which
 * options a feed has — pure, so it is one table (feed-menu.test.ts). The
 * components only draw it.
 */

export type FeedTabKey = "foryou" | "following" | "trending" | "feeds";
export type FeedStyle = "all" | "photos" | "video" | "polls";

export const FEED_TABS: ReadonlyArray<{ key: FeedTabKey; label: string; hint: string; requiresAuth: boolean }> = [
  { key: "foryou", label: "For you", hint: "Popular posts from across the network", requiresAuth: false },
  { key: "following", label: "Following", hint: "Posts from the people you follow", requiresAuth: true },
  { key: "trending", label: "Trending", hint: "What the whole network is reacting to", requiresAuth: false },
  { key: "feeds", label: "Feeds", hint: "Photos, videos, polls and your own feeds", requiresAuth: true },
];

/** The tab that is lit for a feed mode. */
export function tabForFeedMode(feedMode: string): FeedTabKey {
  if (feedMode === "open_comms") return "following";
  if (feedMode === "deep_scan") return "trending";
  if (feedMode.startsWith("custom_")) return "feeds";
  return "foryou";
}

export type TabTap =
  /** Signed out, and the tab needs an account. */
  | { do: "sign-in" }
  /** Go to that feed. Nothing opens. */
  | { do: "switch"; to: "foryou" | "following" | "trending" }
  /** Already there: back to the top, with whatever is new. */
  | { do: "top" }
  /** Feeds is a list: show it. Picking from it is what switches. */
  | { do: "open-feeds" };

export function tabTap(tab: FeedTabKey, env: { feedMode: string; signedIn: boolean }): TabTap {
  const def = FEED_TABS.find((t) => t.key === tab)!;
  if (def.requiresAuth && !env.signedIn) return { do: "sign-in" };
  if (tab === "feeds") return { do: "open-feeds" };
  return tabForFeedMode(env.feedMode) === tab ? { do: "top" } : { do: "switch", to: tab };
}

/** What the Feeds tab says: the feed on screen while one is, "Feeds" otherwise. */
export function feedsTabLabel(
  feedMode: string,
  feedStyle: FeedStyle,
  customFeeds: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (!feedMode.startsWith("custom_")) return "Feeds";
  if (feedMode === "custom_all") {
    if (feedStyle === "video") return "Videos";
    if (feedStyle === "polls") return "Polls";
    // "all" too: with no style picked the built-in feed on screen IS photos
    // (a tab restored from last time), and the tab must name what is shown.
    return "Photos";
  }
  const id = feedMode.slice("custom_".length);
  return customFeeds.find((f) => f.id === id)?.name.trim() || "Feeds";
}

/** The feed on screen, by name — the filter's title ("Filter Trending"). */
export function feedName(
  feedMode: string,
  feedStyle: FeedStyle,
  customFeeds: ReadonlyArray<{ id: string; name: string }>,
): string {
  const tab = tabForFeedMode(feedMode);
  if (tab !== "feeds") return FEED_TABS.find((t) => t.key === tab)!.label;
  return feedsTabLabel(feedMode, feedStyle, customFeeds);
}

/**
 * The option groups a feed has, in the order they are shown. A feed gets only
 * what applies to it — no dead buttons, and no paragraph explaining why a
 * control is missing.
 */
export type FilterGroup =
  | "order"        // Popular / Latest
  | "show"         // Posts / Replies / Both
  | "strictness"   // Open / Balanced / Strict
  | "from"         // Trending: how far back
  | "media-order"  // Photos, Videos: Trending / Latest
  | "poll-order"   // Polls: Trending / Latest / Ending soon
  | "poll-show"    // Polls: Open / All
  | "feed-order"   // a feed of your own: its seven orders
  | "feed-from"    // …and how far back, for the orders that rank
  | "feed-show";   // …All / Photos / Video

export function filterGroups(env: {
  feedMode: string;
  feedStyle: FeedStyle;
  /** Trust filtering is on and ready for this person. */
  strictness: boolean;
  /** A feed of your own is ordered by something that ranks over a time window. */
  feedOrderRanks: boolean;
}): FilterGroup[] {
  const tab = tabForFeedMode(env.feedMode);
  if (tab === "foryou") return env.strictness ? ["order", "show", "strictness"] : ["order", "show"];
  if (tab === "following") return ["order", "show"];
  if (tab === "trending") return ["from"];
  if (env.feedMode === "custom_all") {
    if (env.feedStyle === "polls") return ["poll-order", "poll-show"];
    return ["media-order"];
  }
  return env.feedOrderRanks ? ["feed-order", "feed-from", "feed-show"] : ["feed-order", "feed-show"];
}

/* ----------------------------------------------------------------------------
 * Trending: "From"
 *
 * Trending has one ranking, a blended one that exists for the last hour or the
 * last four. It used to have four count charts beside it (likes, thanks,
 * replies, reposts, from today back to all time), under a "Top by" row; their
 * outside source closed on 2026-11-21 and they went with it.
 * ------------------------------------------------------------------------- */

export type TrendingFrom = "1h" | "4h";

const OVERALL_FROM: ReadonlyArray<{ value: TrendingFrom; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "4h", label: "Last 4 hours" },
];

/** Where Trending opens when nobody chose (owner, 2026-10-03): Overall, last hour. */
export const DEFAULT_TRENDING_SELECTOR = "trending_1h";

/** A stored selector that no longer has a home on Trending (its own Polls
 *  list, which lives under Feeds now; the four count charts, whose outside
 *  source closed on 2026-11-21) falls back to the default. */
export function trendingSelectorOrDefault(selector: string): string {
  if (selector === "trending_1h" || selector === "trending_4h") return selector;
  return DEFAULT_TRENDING_SELECTOR;
}

/**
 * Windows saved before Trending's menu changed, read as the closest that
 * exists now: 12 and 24 hours are nearest to 4 hours. Anything else that is
 * gone opens the default.
 */
export function migrateTrendingChart(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "trending_12h" || v === "trending_24h") return "trending_4h";
  return v;
}

/** The window Trending opens on: this session's own pick, else the saved setting, else the last hour. */
export function startingTrendingSelector(session: string | null | undefined, saved: string | null | undefined): string {
  const s = migrateTrendingChart(session);
  if (s) return trendingSelectorOrDefault(s);
  const p = migrateTrendingChart(saved);
  if (p) return trendingSelectorOrDefault(p);
  return DEFAULT_TRENDING_SELECTOR;
}

/** What Settings offers for "Trending opens on": exactly Trending's windows. */
export const TRENDING_CHART_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "trending_1h", label: "Last hour" },
  { value: "trending_4h", label: "Last 4 hours" },
];

export function trendingFilter(selector: string): {
  from: TrendingFrom;
  fromOptions: ReadonlyArray<{ value: TrendingFrom; label: string }>;
} {
  return { from: trendingSelectorOrDefault(selector) === "trending_4h" ? "4h" : "1h", fromOptions: OVERALL_FROM };
}

/** What a pick in "From" sets. */
export function pickFrom(from: TrendingFrom): { selector: string } {
  return { selector: from === "4h" ? "trending_4h" : "trending_1h" };
}
