import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useReducedMotion } from "framer-motion";
import { ArrowRight, ChevronRight, Lock, Rocket } from "lucide-react";
import { openOrbitMenu } from "@/components/OrbitMenu";
import { openCreateStudio } from "@/components/CreateStudio";
import { buildNavDestinations, NAV_ICONS, type NavDestination } from "@/lib/nav-destinations";
import { useNeedsYouCount } from "@/contexts/NeedsYouContext";
import { useIaCollapsed } from "@/lib/ia-prefs";
import { useNewsUnread } from "@/hooks/use-news-unread";
import { isNavDestinationActive } from "@/lib/footer-nav";
import { YouAvatarIcon } from "@/components/YouAvatarIcon";
import { SidebarOutposts } from "@/components/SidebarOutposts";
import { SearchPill } from "@/components/SearchPill";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useOutpostDirectorySearch } from "@/hooks/use-outpost-directory-search";
import type { OutpostSearchMatch } from "@/lib/outpost-directory";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { ensureConcordUnreadWatcher, useConcordUnread } from "@/lib/concord/concord-unread";
import { concordChatsBadgeCount, useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { ensureConcordMentionScanner } from "@/lib/concord/concord-mention-scan";
import { useTheme } from "@/hooks/use-theme";
import { formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { queryClient } from "@/lib/queryClient";
import { DEFAULT_FEEDS, loadCustomFeeds, loadHiddenDefaults } from "@/lib/rss-feeds";
import { loadNewsAlertPrefs } from "@/lib/news-alert-settings";
import {
  computePriorityNewsUnread,
  loadRssReadLedger,
  type RssCachedItemLite,
} from "@/lib/orbit-stories";

// Desktop-only "Stories" rail: a slim icon-only ring rail that brings the mobile
// OrbitMenu visual language (glowing violet unread rings) to desktop, replacing
// the labeled sidebar tree. Labels are hover tooltips; the logo and ⌘K summon
// the full OrbitMenu launcher — as does the bottom identity chip, but only in
// the EXPANDED IA. Once collapsed, "You" is a destination in the rail wearing
// this same avatar, so the chip would be a second identical face pointing
// somewhere else. The Communities node opens a glass flyout hosting the
// existing joined-communities tree.
//
// Mounted only on desktop and only when the "Classic sidebar" escape hatch is
// off (see App.tsx); mobile chrome (OrbitMenu overlay + MobileFooter) is
// untouched. `hidden md:flex` is belt-and-suspenders so a brief mobile mount
// never paints.

function fmtCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

// Same fallback the Outposts page uses for a relay with no NIP-11 icon.

/** One compact relay row, sized for the narrow (w-64) flyout. */
function FlyoutResultRow({
  match,
  trailing,
  onOpen,
  testId,
}: {
  match: OutpostSearchMatch;
  trailing?: ReactNode;
  onOpen: (url: string) => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(match.url)}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <Avatar className="h-6 w-6 shrink-0 border border-border/40">
        <AvatarImage src={match.icon || undefined} alt={match.name} />
        <AvatarFallback className="bg-muted text-[8px]">{match.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight">{match.name}</span>
        <span className="block truncate text-[10px] leading-tight text-muted-foreground/60">
          {match.url.replace(/^wss?:\/\//, "")}
        </span>
      </span>
      {trailing}
    </button>
  );
}

/**
 * Compact mirror of the Outposts page command bar, rendered inside the narrow
 * Communities flyout. Reads the SAME directory (saved + other relays) via the
 * shared useOutpostDirectorySearch hook — Your communities, Directory, and
 * paste-a-link, with a "Searching…" loader and the "+N more" hint. Enter (in
 * the flyout's search input) still escapes to the full /outposts?q= page.
 */
function FlyoutSearchResults({
  query,
  active,
  onOpen,
  onOpenInvite,
}: {
  query: string;
  active: boolean;
  onOpen: (url: string) => void;
  onOpenInvite: (path: string) => void;
}) {
  const { joinedMatches, dirMatches, loading, moreCount, looksLikeUrl, urlToOpen, groupInvite } =
    useOutpostDirectorySearch(query, { active });
  const nothing =
    !loading &&
    !groupInvite &&
    !looksLikeUrl &&
    joinedMatches.length === 0 &&
    dirMatches.length === 0;

  return (
    <div className="px-2" data-testid="rail-communities-flyout-results">
      {groupInvite && (
        <button
          type="button"
          onClick={() => onOpenInvite(groupInvite.path)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="rail-flyout-open-invite"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Lock className="h-3 w-3 text-brand" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight">Join group chat</span>
            <span className="block truncate text-[10px] leading-tight text-muted-foreground/60">
              {groupInvite.host ? `Invite from ${groupInvite.host}` : "Encrypted group invite"}
            </span>
          </span>
        </button>
      )}
      {looksLikeUrl && (
        <button
          type="button"
          onClick={() => onOpen(urlToOpen)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="rail-flyout-open-url"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Rocket className="h-3 w-3 text-brand" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight">
              Open {urlToOpen.replace(/^wss?:\/\//, "")}
            </span>
            <span className="block truncate text-[10px] leading-tight text-muted-foreground/60">
              Go straight to this community
            </span>
          </span>
        </button>
      )}
      {joinedMatches.length > 0 && (
        <>
          <p className="px-2 pb-1 pt-2 text-[10px] font-brand uppercase tracking-wider text-muted-foreground/50">
            Your communities
          </p>
          {joinedMatches.map((m) => (
            <FlyoutResultRow
              key={m.url}
              match={m}
              onOpen={onOpen}
              testId={`rail-flyout-joined-${encodeURIComponent(m.url).slice(0, 24)}`}
              trailing={
                <span className="shrink-0 text-[9px] text-emerald-600/80 dark:text-emerald-400/80">Joined</span>
              }
            />
          ))}
        </>
      )}
      {(dirMatches.length > 0 || loading) && (
        <p className="px-2 pb-1 pt-2 text-[10px] font-brand uppercase tracking-wider text-muted-foreground/50">
          Directory
        </p>
      )}
      {loading && dirMatches.length === 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground/60">
          <RelayOutpostInlineLoader className="h-3 w-3" /> Searching…
        </div>
      )}
      {dirMatches.map((m) => (
        <FlyoutResultRow
          key={m.url}
          match={m}
          onOpen={onOpen}
          testId={`rail-flyout-dir-${encodeURIComponent(m.url).slice(0, 24)}`}
          trailing={
            (m.activeUserCount ?? 0) > 0 ? (
              <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground/50">
                ~{m.activeUserCount}
              </span>
            ) : undefined
          }
        />
      ))}
      {nothing && (
        <p className="px-2 py-3 text-[11px] text-muted-foreground/60" data-testid="rail-flyout-empty">
          No communities found — try another name, or paste a link.
        </p>
      )}
      {moreCount > 0 && (
        <p className="px-2 pb-2 pt-1 text-[10px] tabular-nums text-muted-foreground/40">
          +{moreCount} more — keep typing to narrow it down
        </p>
      )}
    </div>
  );
}

/** One glowing ring node — reuses the mobile OrbitMenu ring vocabulary. */
function RailNode({
  destination,
  active,
  isDark,
  reducedMotion,
  onClick,
  onMouseEnter,
  refProp,
  ariaExpanded,
  suppressTooltip,
  testId,
}: {
  destination: NavDestination;
  active: boolean;
  isDark: boolean;
  reducedMotion: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  refProp?: React.Ref<HTMLButtonElement>;
  ariaExpanded?: boolean;
  /**
   * Skip the hover/focus tooltip wrapper (keeping the bare button + its
   * aria-label). Used for the Communities node while its flyout is open — the
   * flyout opens at the same spot and instantly covers the "Communities"
   * tooltip, so the tooltip is both redundant and visually clipped there.
   */
  suppressTooltip?: boolean;
  testId: string;
}) {
  const Icon = NAV_ICONS[destination.id];
  const isCreate = destination.id === "create";
  const live = !!destination.live;

  const ringConic = isDark
    ? "conic-gradient(from 0deg, #7c3aed, #a855f7 26%, rgba(168,85,247,0.3) 50%, #a855f7 72%, #7c3aed)"
    : "conic-gradient(from 0deg, #5b21b6, #7c3aed 26%, rgba(109,40,217,0.3) 50%, #7c3aed 72%, #5b21b6)";

  const boxShadow = active
    ? isDark
      ? "0 0 18px rgba(168,85,247,0.55), 0 0 6px rgba(168,85,247,0.4)"
      : "0 0 18px rgba(109,40,217,0.30), 0 0 6px rgba(109,40,217,0.18)"
    : live
      ? isDark
        ? "0 0 14px rgba(168,85,247,0.4)"
        : "0 0 14px rgba(109,40,217,0.22)"
      : isCreate
        ? isDark
          ? "0 0 10px rgba(124,58,237,0.25)"
          : "0 0 10px rgba(109,40,217,0.12)"
        : isDark
          ? "0 0 8px rgba(124,58,237,0.16)"
          : "0 0 8px rgba(109,40,217,0.08)";

  const ringBg = live
    ? ringConic
    : active
      ? isDark ? "rgba(196,181,253,0.6)" : "rgba(109,40,217,0.6)"
      : isCreate
        ? isDark ? "rgba(168,85,247,0.4)" : "rgba(109,40,217,0.42)"
        : isDark ? "rgba(168,85,247,0.22)" : "rgba(109,40,217,0.26)";

  const innerBg = active
    ? isDark ? "hsl(262 45% 17%)" : "hsl(262 45% 92%)"
    : isCreate
      ? isDark ? "hsl(262 38% 12%)" : "hsl(262 40% 96%)"
      : isDark ? "hsl(258 26% 10%)" : "#ffffff";

  const button = (
    <button
      ref={refProp}
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      aria-label={destination.count ? `${destination.title}, ${destination.count} new` : destination.title}
      aria-current={active ? "page" : undefined}
      aria-expanded={ariaExpanded}
      className="group relative flex h-12 w-12 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ boxShadow }}
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full transition-transform ${live && !reducedMotion ? "rail-ring-spin" : ""}`}
        style={{ background: ringBg }}
        data-testid={live ? `${testId}-ring-live` : `${testId}-ring-quiet`}
      />
      <span
        className="absolute inset-[3px] flex items-center justify-center rounded-full transition-colors"
        style={{ background: innerBg }}
      >
        {destination.id === "you" ? (
          <YouAvatarIcon
            className="h-6 w-6"
            glyphClassName={active ? "text-primary dark:text-brand" : "text-foreground/75 dark:text-white/85"}
            active={active}
          />
        ) : (
          <Icon
            className={`h-5 w-5 ${ active ? "text-brand" : isCreate ? "text-brand" : "text-foreground/75 dark:text-white/85" }`}
          />
        )}
      </span>
      {destination.count !== undefined && (
        <span
          className="absolute -right-1.5 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-sidebar shadow-sm"
          data-testid={`${testId}-count`}
        >
          {fmtCount(destination.count)}
        </span>
      )}
    </button>
  );

  // While the flyout is open the tooltip would open at the same spot and be
  // instantly covered by the panel — render the bare button (aria-label intact).
  if (suppressTooltip) return button;


  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {destination.title}
        {destination.count !== undefined ? ` · ${fmtCount(destination.count)}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function DesktopStoriesRail() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { isDark } = useTheme();
  const reducedMotion = !!useReducedMotion();
  const { pubkey, profile } = useNostrAuth();
  const { unreadCount, unreadDmCount } = useNotifications();
  const concordUnread = useConcordUnread();
  const concordMentions = useConcordMentionCounts();
  useEffect(() => { void ensureConcordUnreadWatcher(pubkey); ensureConcordMentionScanner(pubkey); }, [pubkey]);
  const chatsUnread = unreadDmCount + concordChatsBadgeCount(concordUnread, concordMentions);

  const displayName = profile?.display_name || profile?.name || null;
  const npub = pubkey ? shortenNpub(formatNpub(pubkey)) : null;
  const avatarUrl = profile?.picture;

  // News priority-unread — shared with the mobile footer (hooks/use-news-unread).
  const newsUnread = useNewsUnread();

  const iaCollapsed = useIaCollapsed();
  const needsYou = useNeedsYouCount();
  const destinations = useMemo(
    () => buildNavDestinations({ loggedIn: !!pubkey, counts: { chatsUnread, newsUnread, alertsUnread: unreadCount, needsYou }, collapsed: iaCollapsed }),
    [pubkey, chatsUnread, newsUnread, unreadCount, needsYou, iaCollapsed],
  );

  // The rail used to carry its own matcher here: a title-string special case for
  // Feed/Media/News, then `location.startsWith(path)` for everything else. The
  // collapsed IA renames home to "Discover", which matched no title, so it fell
  // through to startsWith("/") — true on EVERY route — and the rail marked
  // Discover as the current page everywhere, beside whichever destination was
  // genuinely current. Two aria-current="page" at once.
  //
  // The mobile footer already had the right thing: one predicate keyed by
  // destination id, pure and tested. The rail now shares it, so a future
  // destination or rename can't reintroduce this.
  const isEntryActive = useCallback(
    (d: NavDestination) => (d.path ? isNavDestinationActive(d.id, location, search, iaCollapsed) : false),
    [location, search, iaCollapsed],
  );

  // ⌘K / Ctrl-K summons the full launcher (never while typing in a field).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        openOrbitMenu();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Communities flyout: hover-intent open + click toggle; closes on navigate,
  // outside-click, or mouse leaving the node+panel group.
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  // Live filter over the joined-communities tree inside the flyout. Empty =
  // full list; Enter carries it to the full Communities page for discovery.
  const [flyoutSearch, setFlyoutSearch] = useState("");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const communitiesBtnRef = useRef<HTMLButtonElement>(null);

  // Reset the filter whenever the flyout closes so it reopens clean.
  useEffect(() => {
    if (!flyoutOpen) setFlyoutSearch("");
  }, [flyoutOpen]);

  // Navigate to the full Communities hub, carrying an optional query so the
  // page runs its own discovery / paste-join, and close the flyout.
  const goToCommunities = useCallback(
    (query?: string) => {
      const q = (query ?? "").trim();
      setFlyoutOpen(false);
      setLocation(q ? `/outposts?q=${encodeURIComponent(q)}` : "/outposts");
    },
    [setLocation],
  );

  // Open a specific community / group invite straight from a flyout search row,
  // using the same navigation the page's command bar uses (the outpost route).
  const openOutpostFromFlyout = useCallback(
    (url: string) => {
      setFlyoutOpen(false);
      setLocation(`/outposts/${encodeURIComponent(url)}`);
    },
    [setLocation],
  );
  const openInviteFromFlyout = useCallback(
    (path: string) => {
      setFlyoutOpen(false);
      setLocation(path);
    },
    [setLocation],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyoutOpen(false), 180);
  }, [cancelClose]);

  // Close the flyout on any navigation.
  const navKey = `${location}?${search}`;
  const prevNavKey = useRef(navKey);
  useEffect(() => {
    if (prevNavKey.current !== navKey) {
      prevNavKey.current = navKey;
      setFlyoutOpen(false);
    }
  }, [navKey]);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!flyoutOpen) return;
    const onDown = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setFlyoutOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFlyoutOpen(false);
        communitiesBtnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [flyoutOpen]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  // Non-communities nodes: navigate (or fire the Create action). The
  // Communities node is handled inline (flyout) in the render below.
  const handleNodeClick = useCallback(
    (d: NavDestination) => {
      if (d.isAction) { openCreateStudio(); return; }
      if (d.path) setLocation(d.path);
    },
    [setLocation],
  );

  return (
    <aside
      className="relay-rail hidden h-[100dvh] w-[4.25rem] shrink-0 flex-col items-center border-r border-border/40 bg-sidebar/95 py-3 md:flex"
      aria-label="Primary"
      data-testid="desktop-stories-rail"
    >
      {/* Logo → full launcher */}
      <button
        type="button"
        onClick={openOrbitMenu}
        aria-label="Open menu"
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-brand/30 bg-[hsl(235,30%,15%)] transition-colors hover:border-brand/60 dark:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="rail-logo"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 drop-shadow-[0_0_3px_rgba(255,255,255,0.15)]" aria-hidden="true">
          <g clipPath="url(#clip0_rail_brand)">
            <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="white" />
            <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="white" />
          </g>
          <defs><clipPath id="clip0_rail_brand"><rect width="24" height="24" /></clipPath></defs>
        </svg>
      </button>

      {/* Ring nodes */}
      {/* overflow-visible (NOT a scroll container): a scroll container clips
          both axes to its padding box, which tucked the notification count
          badges under the rail's right border AND spawned a phantom horizontal
          scrollbar. The rail's nav icons are a fixed, small set that always fit
          the viewport, so no scroll is needed — and now the badges overhang the
          border cleanly with no scrollbar. */}
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-visible pt-1" data-testid="rail-nodes">
        {destinations.map((d) => {
          const active = isEntryActive(d) || (d.id === "communities" && flyoutOpen);
          if (d.id === "communities") {
            return (
              <div
                key={d.id}
                ref={groupRef}
                className="relative"
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                <RailNode
                  destination={d}
                  active={active}
                  isDark={isDark}
                  reducedMotion={reducedMotion}
                  // Open (idempotent) rather than toggle: hover already opens the
                  // flyout, so a toggle-on-click would immediately close it after
                  // the hover opened it. Close is via outside-click / mouse-leave
                  // / Escape / navigate. The flyout's own "Communities" header row
                  // links to the /outposts hub.
                  onClick={() => setFlyoutOpen(true)}
                  onMouseEnter={() => { cancelClose(); setFlyoutOpen(true); }}
                  refProp={communitiesBtnRef}
                  ariaExpanded={flyoutOpen}
                  suppressTooltip={flyoutOpen}
                  testId={`rail-node-${d.id}`}
                />
                {flyoutOpen && (
                  <div
                    className="fixed left-[4.25rem] top-0 z-[70] flex h-[100dvh] w-64 flex-col border-r border-border/50 bg-sidebar shadow-[0_10px_40px_rgba(31,27,75,0.18)] dark:shadow-[0_10px_40px_rgba(0,0,0,0.55)]"
                    role="group"
                    aria-label="Communities"
                    data-testid="rail-communities-flyout"
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                  >
                    {/* Header doubles as a link to the full Communities hub, so
                        the page is always one obvious click away. */}
                    <button
                      type="button"
                      onClick={() => goToCommunities()}
                      className="flex min-h-[44px] items-center justify-between gap-2 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand/80 transition-colors hover:text-brand dark:text-brand/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="rail-communities-flyout-header"
                    >
                      <span>Communities</span>
                      <ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                    </button>
                    {/* Search / paste-a-link. Typing swaps the joined tree for a
                        compact mirror of the page's command bar (Your communities
                        + Directory + paste-a-link); Enter still carries the query
                        to the full page for discovery. */}
                    <div className="px-3 pb-3">
                      <SearchPill
                        value={flyoutSearch}
                        onChange={(e) => setFlyoutSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            goToCommunities(flyoutSearch);
                          }
                        }}
                        placeholder="Search or paste a link…"
                        aria-label="Search communities or paste a link"
                        data-testid="rail-communities-flyout-search"
                      />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                      {flyoutSearch.trim() ? (
                        <FlyoutSearchResults
                          query={flyoutSearch}
                          active={flyoutOpen}
                          onOpen={openOutpostFromFlyout}
                          onOpenInvite={openInviteFromFlyout}
                        />
                      ) : (
                        <SidebarOutposts closeMobileNav={() => setFlyoutOpen(false)} />
                      )}
                    </div>
                    {/* Quiet escape hatch to the full discovery page. */}
                    <button
                      type="button"
                      onClick={() => goToCommunities()}
                      className="flex min-h-[44px] items-center gap-1.5 border-t border-border/40 px-4 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="rail-communities-flyout-browse-all"
                    >
                      Browse all communities
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            );
          }
          const node = (
            <RailNode
              key={d.id}
              destination={d}
              active={active}
              isDark={isDark}
              reducedMotion={reducedMotion}
              onClick={() => handleNodeClick(d)}
              testId={`rail-node-${d.id}`}
            />
          );
          // Account sits at the FOOT of the rail, not fourth in a stack.
          // Everything above it is somewhere to go; this one is who you are —
          // the same split every desktop app of this shape makes (Slack,
          // Discord, Linear, VS Code all park identity at the bottom). `mt-auto`
          // does it with no second container: the nav is already flex-1, so the
          // last child claims the slack. A hairline above states the separation
          // rather than leaving it to a gap nobody reads as meaningful.
          if (d.id === "you") {
            return (
              <div key={d.id} className="mt-auto flex flex-col items-center gap-3 pt-3" data-testid="rail-account-slot">
                <span className="h-px w-7 bg-border/50" aria-hidden="true" />
                {node}
              </div>
            );
          }
          return node;
        })}
      </nav>

      {/* Bottom identity chip → full launcher.
          Hidden once the IA collapses, because "You" becomes a real destination
          in the rail above and wears this same avatar — two identical faces in
          one unlabelled rail, six icons apart, pointing at DIFFERENT places
          (account page vs launcher). The launcher keeps two triggers, the logo
          and ⌘K, which is plenty for one command palette.
          The signed-OUT branch stays either way: with no pubkey there is no
          "You" destination at all, so this is the only way in.

          The container is CONDITIONAL, not just its contents. Rendering an
          empty div with mt-2 left 8.5px of margin hanging under the Account
          node, so the gap below it (26px) no longer matched the rail's own
          padding above the logo (12.75px) — a box with nothing in it still
          takes up space. */}
      {!(pubkey && iaCollapsed) && (
      <div className="mt-2 shrink-0">
        {pubkey ? (iaCollapsed ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openOrbitMenu}
                aria-label="Account and menu"
                className="flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="rail-identity-chip"
              >
                <Avatar className="h-10 w-10 border border-brand/40 shadow-[0_0_12px_rgba(139,92,246,0.25)]">
                  <AvatarImage src={avatarUrl} alt={displayName || "You"} />
                  <AvatarFallback className="bg-secondary text-secondary-foreground text-[11px] dark:bg-[hsl(258,30%,14%)] dark:text-brand">
                    {displayName ? displayName.slice(0, 2).toUpperCase() : npub ? npub.slice(0, 2).toUpperCase() : "?"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {displayName || npub || "Account"}
            </TooltipContent>
          </Tooltip>
        )) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setLocation("/login")}
                aria-label="Sign in"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-brand/40 bg-brand/10 text-[10px] font-semibold uppercase tracking-wider text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="rail-signin"
              >
                In
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>Sign in</TooltipContent>
          </Tooltip>
        )}
      </div>
      )}

      <style>{`
        @keyframes rail-ring-rot { to { transform: rotate(360deg); } }
        .relay-rail .rail-ring-spin { animation: rail-ring-rot 8s linear infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) {
          .relay-rail .rail-ring-spin { animation: none; }
        }
      `}</style>
    </aside>
  );
}
