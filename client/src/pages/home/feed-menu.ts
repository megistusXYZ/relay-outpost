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
import type { ArchivesRange } from "./helpers";

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
  | "top-by"       // Trending: Overall / Likes / Zaps / Replies / Reposts
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
  if (tab === "trending") return ["top-by", "from"];
  if (env.feedMode === "custom_all") {
    if (env.feedStyle === "polls") return ["poll-order", "poll-show"];
    return ["media-order"];
  }
  return env.feedOrderRanks ? ["feed-order", "feed-from", "feed-show"] : ["feed-order", "feed-show"];
}

/* ----------------------------------------------------------------------------
 * Trending: "Top by" and "From"
 *
 * Underneath there are two sources. "Overall" is a blended ranking that only
 * exists for the last hour or four hours; the four counts (likes, zaps,
 * replies, reposts) are charts that exist from today back to all time. The old
 * menu laid all seven time ranges in one row, so picking "1 hour" silently
 * dropped the metric and picking a metric silently changed the range. Here
 * each choice of "Top by" shows the ranges it really has.
 * ------------------------------------------------------------------------- */

export type TopBy = "overall" | "arc_reactions" | "arc_zaps" | "arc_replies" | "arc_reposts";
export type TrendingFrom = "1h" | "4h" | ArchivesRange;

export const TOP_BY_OPTIONS: ReadonlyArray<{ value: TopBy; label: string }> = [
  { value: "overall", label: "Overall" },
  { value: "arc_reactions", label: "Likes" },
  { value: "arc_zaps", label: "Thanks" },
  { value: "arc_replies", label: "Replies" },
  { value: "arc_reposts", label: "Reposts" },
];

const OVERALL_FROM: ReadonlyArray<{ value: TrendingFrom; label: string }> = [
  { value: "1h", label: "Last hour" },
  { value: "4h", label: "Last 4 hours" },
];
const CHART_FROM: ReadonlyArray<{ value: TrendingFrom; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Week" },
  { value: "30d", label: "Month" },
  { value: "1y", label: "Year" },
  { value: "all", label: "All time" },
];

/** Where Trending opens when nobody chose (owner, 2026-10-03): Overall, last hour. */
export const DEFAULT_TRENDING_SELECTOR = "trending_1h";

/** A stored selector that no longer has a home on Trending (its own Polls
 *  list: polls live under Feeds now) falls back to the default chart. */
export function trendingSelectorOrDefault(selector: string): string {
  if (selector === "trending_1h" || selector === "trending_4h") return selector;
  if (TOP_BY_OPTIONS.some((o) => o.value === selector && o.value !== "overall")) return selector;
  return DEFAULT_TRENDING_SELECTOR;
}

/**
 * Charts saved before Trending's menu changed, read as the closest chart that
 * exists now. "Rising", "Hot" and "Top Signal" were engagement rankings;
 * "Most zapped" is the Thanks chart; 12 and 24 hours are nearest to 4 hours.
 */
export function migrateTrendingChart(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === "mostzapped_24h" || v === "mostzapped_yesterday" || v === "mostzapped_week" || v === "mostzapped_4h") return "arc_zaps";
  if (v === "hot" || v === "rising" || v === "weekly_top") return "arc_reactions";
  if (v === "trending_12h" || v === "trending_24h") return "trending_4h";
  return v;
}

/** The chart Trending opens on: this session's own pick, else the saved setting, else Overall · last hour. */
export function startingTrendingSelector(session: string | null | undefined, saved: string | null | undefined): string {
  const s = migrateTrendingChart(session);
  if (s) return trendingSelectorOrDefault(s);
  const p = migrateTrendingChart(saved);
  if (p) return trendingSelectorOrDefault(p);
  return DEFAULT_TRENDING_SELECTOR;
}

/** What Settings offers for "Trending opens on": exactly Trending's charts. */
export const TRENDING_CHART_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "trending_1h", label: "Overall · last hour" },
  { value: "trending_4h", label: "Overall · last 4 hours" },
  { value: "arc_reactions", label: "Most liked" },
  { value: "arc_zaps", label: "Most thanked" },
  { value: "arc_replies", label: "Most replied" },
  { value: "arc_reposts", label: "Most reposted" },
];

export function trendingFilter(selector: string, range: ArchivesRange): {
  topBy: TopBy;
  from: TrendingFrom;
  fromOptions: ReadonlyArray<{ value: TrendingFrom; label: string }>;
} {
  const sel = trendingSelectorOrDefault(selector);
  if (sel === "trending_1h") return { topBy: "overall", from: "1h", fromOptions: OVERALL_FROM };
  if (sel === "trending_4h") return { topBy: "overall", from: "4h", fromOptions: OVERALL_FROM };
  return { topBy: sel as TopBy, from: range, fromOptions: CHART_FROM };
}

/** What a pick in "Top by" sets. The range is kept: a chart has every range. */
export function pickTopBy(topBy: TopBy, current: string): { selector: string } {
  if (topBy !== "overall") return { selector: topBy };
  // Overall keeps the window it was on, and starts on the longer one.
  return { selector: current === "trending_1h" ? "trending_1h" : "trending_4h" };
}

/** What a pick in "From" sets. */
export function pickFrom(from: TrendingFrom): { selector?: string; range?: ArchivesRange } {
  if (from === "1h") return { selector: "trending_1h" };
  if (from === "4h") return { selector: "trending_4h" };
  return { range: from };
}
