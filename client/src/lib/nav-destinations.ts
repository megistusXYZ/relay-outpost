/**
 * The canonical "Stories" navigation node list — the single source of truth for
 * BOTH the mobile OrbitMenu launcher grid and the desktop Stories rail. Keeping
 * the list here (instead of inline in each surface) is what stops the two
 * Stories surfaces from drifting: they render the same destinations, in the same
 * order, with the same routes and the same live/unread glow rules.
 *
 * `buildNavDestinations` is PURE (no React, no DOM) so the ordering + gating
 * invariants are unit-tested (see nav-destinations.test.ts). Icons are mapped by
 * id in `NAV_ICONS` — component references only, no JSX — so this module stays a
 * plain `.ts` and each surface renders `<Icon />` itself.
 */
import type { ComponentType } from "react";
import { Rss, GalleryVerticalEnd, Plus } from "lucide-react";
import { ChatIcon } from "@/components/icons/ChatIcon";
import { CloudIcon } from "@/components/icons/CloudIcon";
import { AlarmIcon } from "@/components/icons/AlarmIcon";
import { FingerprintIcon } from "@/components/icons/FingerprintIcon";
import { NewsIcon } from "@/components/icons/NewsIcon";
import { CalendarAddIcon } from "@/components/icons/CalendarAddIcon";
import { OutpostIcon } from "@/components/icons/OutpostIcon";

export type NavDestinationId =
  | "feed"
  | "chats"
  | "news"
  | "alerts"
  | "media"
  | "calendar"
  | "communities"
  | "create"
  // The collapsed IA (see lib/ia-prefs.ts). "chats" is shared with the list
  // above — it survives the collapse unchanged, which is the point: the
  // conversation list was always the centre, it just stops being one of eight.
  | "activity"
  | "discover"
  | "you";

/** Live unread counts the node list reads to decide count badges + glow. */
export interface NavCounts {
  /** DM unread + active Concord communities (the combined Chats badge). */
  chatsUnread: number;
  /** Priority News (RSS) unread. */
  newsUnread: number;
  /** Notification-page unread. */
  alertsUnread: number;
  /**
   * Decisions waiting on this operator — join requests + reports, across every
   * space they run. Separate from `alertsUnread` because it is a different KIND
   * of number: a like can wait, a stranger at the door cannot.
   */
  needsYou: number;
}

export interface NavDestination {
  id: NavDestinationId;
  title: string;
  /** Route to navigate to. Absent for `create` (an action node). */
  path?: string;
  /** `true` on the Create node — surfaces wire it to openCreateStudio(). */
  isAction?: boolean;
  /** Live count badge (undefined = no badge). */
  count?: number;
  /** Story ring: true = glowing "something new" ring, false = quiet. */
  live?: boolean;
}

/** Icon component keyed by destination id — shared so icons never drift. */
export const NAV_ICONS: Record<NavDestinationId, ComponentType<{ className?: string }>> = {
  feed: Rss,
  chats: ChatIcon,
  news: NewsIcon,
  alerts: AlarmIcon,
  media: GalleryVerticalEnd,
  calendar: CalendarAddIcon,
  communities: OutpostIcon,
  create: Plus,
  activity: AlarmIcon,
  discover: CloudIcon,
  you: FingerprintIcon,
};

export const NAV_TITLES: Record<NavDestinationId, string> = {
  feed: "Feed",
  chats: "Chats",
  news: "News",
  alerts: "Alerts",
  media: "Media",
  calendar: "Calendar",
  communities: "Communities",
  create: "Create",
  activity: "Activity",
  discover: "Discover",
  // "Account", not "You". The rail and footer are icons-only, so this label is
  // what a screen reader announces and what the tooltip says — and "You" names
  // the person while every one of its neighbours (Chats, Activity, Discover)
  // names the thing behind the icon. Account is the thing behind this one.
  you: "Account",
};

// The real page again since the Discover bento (round 2, #14). The /search
// spelling still resolves for legacy links; this is just where the TAB points.
const NEWS_PATH = "/news";
const MEDIA_PATH = "/search?tab=media";

/**
 * The Stories node list. Order is most-used-first and IDENTICAL across both
 * surfaces. Signed-out visitors see only the public destinations (no personal
 * counts, no Create); signed-in users get the full list.
 */
export function buildNavDestinations(opts: {
  loggedIn: boolean;
  counts: NavCounts;
  /** The collapsed 4-destination IA. Off until lib/ia-prefs.ts says otherwise. */
  collapsed?: boolean;
}): NavDestination[] {
  const { loggedIn, counts, collapsed } = opts;
  if (collapsed) return buildCollapsedDestinations(loggedIn, counts);
  const news: NavDestination = {
    id: "news",
    title: NAV_TITLES.news,
    path: NEWS_PATH,
    count: counts.newsUnread > 0 ? counts.newsUnread : undefined,
    live: counts.newsUnread > 0,
  };

  if (!loggedIn) {
    return [
      { id: "feed", title: NAV_TITLES.feed, path: "/" },
      { id: "media", title: NAV_TITLES.media, path: MEDIA_PATH },
      news,
      { id: "communities", title: NAV_TITLES.communities, path: "/outposts" },
    ];
  }

  return [
    { id: "feed", title: NAV_TITLES.feed, path: "/" },
    {
      id: "chats",
      title: NAV_TITLES.chats,
      path: "/messages",
      count: counts.chatsUnread > 0 ? counts.chatsUnread : undefined,
      live: counts.chatsUnread > 0,
    },
    news,
    {
      id: "alerts",
      title: NAV_TITLES.alerts,
      path: "/notifications",
      count: counts.alertsUnread > 0 ? counts.alertsUnread : undefined,
      live: counts.alertsUnread > 0,
    },
    { id: "media", title: NAV_TITLES.media, path: MEDIA_PATH },
    { id: "calendar", title: NAV_TITLES.calendar, path: "/calendar" },
    { id: "communities", title: NAV_TITLES.communities, path: "/outposts" },
    { id: "create", title: NAV_TITLES.create, isAction: true },
  ];
}

/**
 * The collapsed list: Chats · Activity · Discover · You.
 *
 * Four choices worth stating, because each removes something:
 *  - **No Feed node.** Public Nostr stops being a mode and becomes a source you
 *    reach through Discover — since the bento (DISCOVER_BENTO_PLAN.md) that is
 *    literal: /discover is a chooser and the feed at `/` is its first tile.
 *    News is a tile there too; its unread count renders ON that tile, next to
 *    the thing that clears it, never on this tab (see below).
 *  - **No Create node.** Creating happens inside whatever you're looking at; a
 *    global "create something, somewhere" button is a menu, not a destination.
 *  - **Media and Calendar are gone as destinations.** Media is an attribute
 *    (files *in this space*), and time isn't a place either — the calendar
 *    becomes a row under You.
 *  - **Signed-out sees only Discover.** Chats, Activity and You all require an
 *    account; offering them to a visitor is offering four doors, three locked.
 */
function buildCollapsedDestinations(loggedIn: boolean, counts: NavCounts): NavDestination[] {
  /**
   * STILL no news badge, and now for a sharper reason. The first version
   * routed Discover to `/` (the feed) while counting news that lived at
   * `/search?tab=media&type=news` — a badge nobody could clear, reported from
   * a phone as "Discover is showing notifications".
   *
   * News IS genuinely under Discover now — it is the bento's hero tile — but
   * the tab badge stays off on purpose: tapping Discover lands on the CHOOSER,
   * which shows the headline without marking anything read, so a tab count
   * would survive the visit and be the same complaint one level shallower. The
   * count renders on the News tile itself (pages/Discover.tsx), beside the
   * door that actually clears it (/news).
   */
  const discover: NavDestination = {
    id: "discover",
    title: NAV_TITLES.discover,
    path: "/discover",
  };

  if (!loggedIn) return [discover];

  return [
    {
      id: "chats",
      title: NAV_TITLES.chats,
      path: "/messages",
      count: counts.chatsUnread > 0 ? counts.chatsUnread : undefined,
      live: counts.chatsUnread > 0,
    },
    {
      id: "activity",
      title: NAV_TITLES.activity,
      path: "/notifications",
      // SUMMED, not replaced. Activity holds both halves and the badge is one
      // number, so hiding either would send the operator to a page whose
      // contents the badge did not describe. The pair stays distinguishable in
      // NavCounts for whenever this grows a second visual treatment — a
      // decision deserves louder than a reaction, but that is a design change,
      // not a counting one.
      // `?? 0` is load-bearing, not defensive noise: without it a caller that
      // omits `needsYou` produces NaN, `NaN > 0` is false, and the operator
      // loses the ALERTS badge too — a new field silently deleting an old one.
      // The type forbids omitting it; the type is not what runs in a browser.
      count: counts.alertsUnread + (counts.needsYou ?? 0) > 0
        ? counts.alertsUnread + (counts.needsYou ?? 0)
        : undefined,
      live: counts.alertsUnread + (counts.needsYou ?? 0) > 0,
    },
    discover,
    { id: "you", title: NAV_TITLES.you, path: "/account/menu" },
  ];
}

/**
 * The mobile footer's four tab slots (the centre Create button is an action the
 * footer owns, not a destination, so it isn't in here).
 *
 * The collapsed layout IS the collapsed nav list — same four, same order — which
 * is the tell that the reduction is coherent: the phone and the desktop rail
 * finally want the same thing. Only the legacy footer needs its own order, and
 * it is preserved EXACTLY as it shipped so nothing moves while the flag is off.
 */
export function buildFooterTabs(opts: { loggedIn: boolean; counts: NavCounts; collapsed?: boolean }): NavDestination[] {
  const { loggedIn, counts, collapsed } = opts;
  if (collapsed) return buildCollapsedDestinations(loggedIn, counts);
  return [
    { id: "feed", title: NAV_TITLES.feed, path: "/" },
    {
      id: "news",
      title: NAV_TITLES.news,
      path: NEWS_PATH,
      count: counts.newsUnread > 0 ? counts.newsUnread : undefined,
      live: counts.newsUnread > 0,
    },
    { id: "communities", title: NAV_TITLES.communities, path: "/outposts" },
    {
      id: "chats",
      title: NAV_TITLES.chats,
      path: "/messages",
      count: counts.chatsUnread > 0 ? counts.chatsUnread : undefined,
      live: counts.chatsUnread > 0,
    },
  ];
}
