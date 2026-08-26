import { nip19 } from "nostr-tools";
import { Radio, Radar, Antenna, MessageSquare } from "lucide-react";

export type FeedMode = "raw_signal" | "open_comms" | "deep_scan" | string;

/** Home-feed content lens: posts only, replies only, or everything. */
export type ContentFilter = "posts" | "replies" | "all";

/**
 * Reply detection, mirroring getReplyParentId (lib/primal-cache.ts): an event is
 * a reply if it carries any threading "e" tag — a NIP-10 MARKED "reply"/"root"
 * tag OR a deprecated POSITIONAL (unmarked) "e" tag. Only an "e" tag explicitly
 * marked "mention" does not, on its own, make an event a reply (it's a quote /
 * inline reference, not a thread parent). A repost is NOT a reply — callers must
 * short-circuit on repost-wrapped events before consulting this. q-tag quotes and
 * p-tag mentions are ignored (only "e" tags count). Drives the Posts / Replies /
 * All home-feed filter.
 */
export function isReplyEvent(tags: string[][]): boolean {
  return tags.some((t) => t[0] === "e" && t[3] !== "mention");
}

/**
 * The feed a user lands on when they have no explicit default-feed-mode preference.
 *
 * An explicit saved choice — "open_comms"/Following, a "custom_…" feed, anything —
 * is ALWAYS honored, whatever else is true. Only the blank is filled here.
 *
 * With public Nostr on (every account that predates the flag, and anyone who turns
 * it back on) the answer is discovery-first: "For You" (deep_scan) is always
 * populated from trending, where "Following" for a one-follow account is nearly
 * empty.
 *
 * With public Nostr OFF — the default for accounts created after decision 4 —
 * the answer inverts. Landing someone in "popular posts from across the network"
 * is precisely the thing that flag exists to not do: the collapsed IA promises
 * your people and your communities, and the front door should agree with it. The
 * "For You" lane is NOT removed, only un-defaulted; it stays one tap away, which
 * is what keeps this from stranding an account that follows one person.
 */
export function resolveDefaultFeedMode(
  saved: string | null | undefined,
  opts?: { publicNostr?: boolean },
): FeedMode {
  if (saved && ["deep_scan", "raw_signal", "open_comms"].includes(saved)) return saved;
  if (saved && saved.startsWith("custom_")) return saved;
  // Default (opts absent) is the pre-flag behaviour, so every existing caller and
  // every existing account keeps exactly what it had.
  if (opts?.publicNostr === false) return "open_comms";
  return "deep_scan";
}

export type TrendingSelectorSource = "primal" | "archives" | "relay";
export type ArchivesMetric = "reactions" | "zaps" | "replies" | "reposts";

export const TRENDING_SELECTORS = [
  { value: "trending_1h", label: "1 hour", group: "time", source: "primal" as TrendingSelectorSource },
  { value: "trending_4h", label: "4 hours", group: "time", source: "primal" as TrendingSelectorSource },
  { value: "polls", label: "Polls", group: "polls", source: "relay" as TrendingSelectorSource, desc: "Active polls from the network" },
  { value: "arc_reactions", label: "Most Reacted", group: "archives", source: "archives" as TrendingSelectorSource, desc: "Top liked & emoji reacted", metric: "reactions" as ArchivesMetric },
  { value: "arc_zaps", label: "Most Zapped", group: "archives", source: "archives" as TrendingSelectorSource, desc: "Highest zap volume", metric: "zaps" as ArchivesMetric },
  { value: "arc_replies", label: "Most Replied", group: "archives", source: "archives" as TrendingSelectorSource, desc: "Most discussion", metric: "replies" as ArchivesMetric },
  { value: "arc_reposts", label: "Most Reposted", group: "archives", source: "archives" as TrendingSelectorSource, desc: "Most amplified", metric: "reposts" as ArchivesMetric },
] as const;

export const ARCHIVES_RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "1y", label: "1 year" },
  { value: "all", label: "All time" },
] as const;

export type ArchivesRange = typeof ARCHIVES_RANGES[number]["value"];

/**
 * The options sheet's single "Time range" row for Trending. The first two are
 * NOT archives ranges — "1 hour"/"4 hours" are the Primal quick-window
 * SELECTORS (trending_1h/trending_4h, a different data source with its own
 * blended ranking), folded in front of the Archives ranges so "how far back?"
 * reads as one control. Home maps them back onto the right piece of state
 * (selector vs archivesRange) in handleTrendingTime.
 */
export const TRENDING_TIME_OPTIONS = [
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  ...ARCHIVES_RANGES,
] as const;

export type TrendingTimeValue = typeof TRENDING_TIME_OPTIONS[number]["value"];

export const POLL_SORTS = [
  { value: "trending", label: "Trending" },
  { value: "expiring", label: "Expiring" },
] as const;

export type PollSort = typeof POLL_SORTS[number]["value"];

/**
 * Saved "Polls" macro feed sort (SavedOptionsSheet → PollsFeed) — superset of
 * the For You surface's POLL_SORTS: "expiring" is the same mode (labelled
 * "Ending soon" here) and "trending" the same hot-score; "latest" is
 * Saved-only. Values feed lib/poll-sort's sortPolls directly.
 */
export const SAVED_POLL_SORTS = [
  { value: "trending", label: "Trending" },
  { value: "latest", label: "Latest" },
  { value: "expiring", label: "Ending soon" },
] as const;

export type SavedPollSort = typeof SAVED_POLL_SORTS[number]["value"];

/** Saved Polls "Show" lens: hide ended polls (default) or show everything. */
export const SAVED_POLL_SHOW_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
] as const;

export type SavedPollShow = typeof SAVED_POLL_SHOW_OPTIONS[number]["value"];

export function isArchivesSelector(selector: string): boolean {
  return selector.startsWith("arc_");
}

export function getArchivesMetric(selector: string): ArchivesMetric | null {
  const sel = TRENDING_SELECTORS.find(s => s.value === selector);
  if (sel && "metric" in sel) return sel.metric;
  return null;
}

export type FeedSortMode = "latest" | "oldest" | "hottest" | "top" | "zap_ranked" | "most_discussed" | "recently_active";
export type TopTimeWindow = "1h" | "6h" | "24h" | "7d";

export const FEED_SORT_OPTIONS: { value: FeedSortMode; label: string; desc?: string; group: "chronological" | "engagement" | "zaps" }[] = [
  { value: "latest", label: "Latest", desc: "Newest posts first", group: "chronological" },
  { value: "recently_active", label: "Recently Active", desc: "Latest replies first", group: "chronological" },
  { value: "oldest", label: "Oldest", desc: "Oldest posts first", group: "chronological" },
  { value: "hottest", label: "Hot", desc: "Popular + fresh right now", group: "engagement" },
  { value: "top", label: "Top Signal", desc: "Most total engagement", group: "engagement" },
  { value: "most_discussed", label: "Most Discussed", desc: "Most replies", group: "engagement" },
  { value: "zap_ranked", label: "Most Zapped", group: "zaps" },
];

export const TIME_WINDOW_SORT_MODES: FeedSortMode[] = ["hottest", "top", "most_discussed", "zap_ranked"];

export const TOP_TIME_WINDOWS: { value: TopTimeWindow; label: string; seconds: number }[] = [
  { value: "1h", label: "1 hour", seconds: 3600 },
  { value: "6h", label: "6 hours", seconds: 21600 },
  { value: "24h", label: "24 hours", seconds: 86400 },
  { value: "7d", label: "7 days", seconds: 604800 },
];

export function getFeedSortKey(feedId: string): string {
  return `relay-outpost-feed-sort-${feedId}`;
}

export function getTopWindowKey(feedId: string): string {
  return `relay-outpost-feed-topwindow-${feedId}`;
}

let _savedCutoffTimestamp: number | null = null;
export const PAGE_SIZE = 30;
export const TRENDING_CACHE_TTL = 3 * 60 * 1000;

export const BUILT_IN_TABS: Array<{ id: FeedMode; label: string; icon: typeof Radio; requiresAuth: boolean }> = [
  { id: "deep_scan", label: "Trending", icon: Radar, requiresAuth: false },
  { id: "raw_signal", label: "For You", icon: Antenna, requiresAuth: false },
  { id: "open_comms", label: "Following", icon: MessageSquare, requiresAuth: true },
];

/**
 * Saved-pill label — the pill is a value-displaying selector: while the saved
 * lane is the active tab it shows the ACTIVE feed's name ("Images", "Polls",
 * "#naturestr") so the user's current location isn't hidden behind a generic
 * "Saved". Reverts to "Saved" whenever another lane is active, on the empty
 * state, or when the selected custom feed no longer exists (deleted while
 * active). Visual truncation is CSS-side (fixed max-width + ellipsis in the
 * tab), so this stays a pure name derivation.
 */
export function getSavedTabLabel(
  feedMode: string,
  feedStyle: "all" | "photos" | "video" | "polls",
  customFeeds: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (!feedMode.startsWith("custom_")) return "Saved";
  if (feedMode === "custom_all") {
    // Macro media feed — which one is on screen is carried by feedStyle.
    if (feedStyle === "photos") return "Images";
    if (feedStyle === "video") return "Videos";
    if (feedStyle === "polls") return "Polls";
    return "Saved";
  }
  const id = feedMode.slice("custom_".length);
  const name = customFeeds.find((f) => f.id === id)?.name.trim();
  return name || "Saved";
}

export function decodePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {}
  return null;
}

