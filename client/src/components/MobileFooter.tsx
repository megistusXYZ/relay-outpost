import { useState, useEffect, memo } from "react";
import { useLocation, useSearch } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { openCreateStudio } from "@/components/CreateStudio";
import { useOutpostCompose } from "@/contexts/OutpostComposeContext";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { ensureConcordUnreadWatcher, useConcordUnread } from "@/lib/concord/concord-unread";
import { concordChatsBadgeCount, useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { ensureConcordMentionScanner } from "@/lib/concord/concord-mention-scan";
import { isNavDestinationActive } from "@/lib/footer-nav";
import { buildFooterTabs, NAV_ICONS, type NavDestination, type NavDestinationId } from "@/lib/nav-destinations";
import { useIaCollapsed } from "@/lib/ia-prefs";
import { appHistoryIndex } from "@/lib/app-history";
import { useNeedsYouCount } from "@/contexts/NeedsYouContext";
import { useNewsUnread } from "@/hooks/use-news-unread";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import { YouAvatarIcon } from "@/components/YouAvatarIcon";

/**
 * One tab slot. Was four near-identical 15-line blocks; the differences that
 * actually mattered (icon shape, badge) are now data, so a new destination can
 * never arrive with a subtly different active treatment.
 *
 * Two icon conventions coexist: the footer's bespoke glyphs take an `active`
 * prop and animate with it, while the shared NAV_ICONS take a className. Both
 * are honoured rather than forcing a rewrite of the hand-drawn ones.
 */
function FooterTab({ tab, active, onNavigate }: {
  tab: NavDestination;
  active: boolean;
  onNavigate: (target: string) => (e: React.MouseEvent) => void;
}) {
  const path = tab.path ?? "/";
  const testId = FOOTER_TESTIDS[tab.id] ?? tab.id;
  const Bespoke = FOOTER_BESPOKE_ICONS[tab.id];
  const Shared = NAV_ICONS[tab.id];
  return (
    <a
      href={path}
      onClick={onNavigate(path)}
      aria-label={`Navigate to ${tab.title}`}
      className={`mobile-nav-item ${active ? "mobile-nav-active" : ""}`}
      data-testid={`mobile-nav-${testId}`}
    >
      {active && <div className="mobile-nav-active-beam" />}
      {/* Bigger now that the caption is gone: the tab freed ~12px of height, so
          the icon takes some of it back. Sized on the wrapper with a CSS rule
          rather than per-icon, because the bespoke glyphs hardcode width/height
          on the <svg> and CSS wins over that attribute — one place, both kinds. */}
      <div className={`relative z-10 [&_svg]:h-7 [&_svg]:w-7 ${active ? "mobile-nav-icon-glow" : ""}`} data-testid={`mobile-nav-icon-${testId}`}>
        <div className="relative">
          {Bespoke
            ? <Bespoke active={active} />
            : <Shared className={`w-[24px] h-[24px] ${active ? "opacity-100" : "opacity-85"}`} />}
          {!!tab.count && tab.count > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1"
              data-testid={`mobile-nav-${testId}-badge`}
            >
              {tab.count > 9 ? "9+" : tab.count}
            </span>
          )}
        </div>
      </div>
      {active && <div className="mobile-nav-dot" />}
    </a>
  );
}

function FeedIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="22" x2="12" y2="11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity={active ? 1 : 0.85} />
      <circle cx="12" cy="9" r="2" stroke="currentColor" strokeWidth="1.4" fill={active ? "currentColor" : "none"} opacity={active ? 0.9 : 0.85} />
      <path d="M7.5 6.5C9 4.5 10.5 3.5 12 3.5s3 1 4.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity={active ? 0.8 : 0.65} />
      <path d="M5 4.5C7.5 1.5 9.8 0.5 12 0.5s4.5 1 7 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity={active ? 0.6 : 0.45} />
      <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={active ? 0.7 : 0.6} />
      {active && (
        <circle cx="12" cy="9" r="4.5" stroke="currentColor" strokeWidth="0.8" opacity="0.2" strokeDasharray="2 2" />
      )}
    </svg>
  );
}

// Newspaper glyph in FeedIcon's house style: currentColor strokes, weight
// ~1.3–1.5, opacity stepping up when active (with a subtle fill on the panel).
function NewsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.1 : 0} opacity={active ? 1 : 0.85} />
      <path d="M17 9h2.5A1.5 1.5 0 0 1 21 10.5V17a2 2 0 0 1-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={active ? 0.8 : 0.6} />
      <line x1="6" y1="9.5" x2="14" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={active ? 0.9 : 0.75} />
      <line x1="6" y1="12.5" x2="14" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity={active ? 0.7 : 0.6} />
      <line x1="6" y1="15.5" x2="10.5" y2="15.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity={active ? 0.7 : 0.6} />
    </svg>
  );
}

function CenterLogoIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="centerLogoGrad" x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--center-logo-start, #1f1b4b)" />
          <stop offset="50%" stopColor="var(--center-logo-mid, #4c1d95)" />
          <stop offset="100%" stopColor="var(--center-logo-end, #7c3aed)" />
        </linearGradient>
        <filter id="centerLogoGlow">
          <feGaussianBlur stdDeviation="0.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="clip0_mobile_center">
          <rect width="24" height="24" />
        </clipPath>
      </defs>
      <g clipPath="url(#clip0_mobile_center)" filter="url(#centerLogoGlow)">
        <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="url(#centerLogoGrad)" />
        <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="url(#centerLogoGrad)" />
      </g>
    </svg>
  );
}

/** Test ids kept EXACTLY as they were, so existing selectors keep working. */
const FOOTER_TESTIDS: Partial<Record<NavDestinationId, string>> = {
  feed: "feed",
  news: "news",
  communities: "outposts",
  chats: "messages",
};

/** "You" wears the account's own face — see YouAvatarIcon for why, and for the
 *  no-picture fallback. Shared with the desktop rail so the two can't drift. */
function YouIcon({ active }: { active: boolean }) {
  return (
    <YouAvatarIcon
      // Same footprint as its neighbours. The nav glyphs paint at 29.8px
      // ([&_svg]:h-7 on a 17px root); this was a hardcoded 24px box whose
      // border ate two more, so the account's own face landed at 22px — 26%
      // smaller than every icon beside it, which is what "the profile pic
      // seems smaller" was. Matching the Tailwind step rather than another
      // literal is what stops it drifting again.
      className="w-7 h-7"
      glyphClassName={active ? "opacity-100" : "opacity-85"}
      active={active}
    />
  );
}

/** Footer-only hand-drawn glyphs; everything else falls back to NAV_ICONS. */
const FOOTER_BESPOKE_ICONS: Partial<Record<NavDestinationId, ({ active }: { active: boolean }) => JSX.Element>> = {
  feed: FeedIcon,
  news: NewsIcon,
  you: YouIcon,
};

export const MobileFooter = memo(function MobileFooter({ hidden = false }: { hidden?: boolean }) {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { pubkey } = useNostrAuth();
  const { unreadCount, unreadDmCount } = useNotifications();
  const newsUnread = useNewsUnread();
  const { outpostCompose } = useOutpostCompose();
  const [dmThreadOpen, setDmThreadOpen] = useState(false);

  useEffect(() => {
    const onOpen = () => setDmThreadOpen(true);
    const onClose = () => setDmThreadOpen(false);
    window.addEventListener("dm-thread-open", onOpen);
    window.addEventListener("dm-thread-close", onClose);
    return () => {
      window.removeEventListener("dm-thread-open", onOpen);
      window.removeEventListener("dm-thread-close", onClose);
    };
  }, []);

  useEffect(() => {
    // Routes that host a full-screen chat overlay (DM thread, Concord outpost
    // chat) manage the hide via dm-thread-open/close; any other route resets it.
    if (!location.startsWith("/messages") && !location.startsWith("/outposts/c/")) setDmThreadOpen(false);
  }, [location]);

  const effectiveHidden = dmThreadOpen || hidden;

  // Native tab-bar navigation: the app's landing tab is the history base.
  // Tapping a tab from the base PUSHES (so Back returns there); tapping a tab
  // from anywhere else REPLACES — switching tabs never stacks, and Back from a
  // tab lands on the base instead of cycling through every tab you visited.
  //
  // The base is IA-dependent, and hardcoding "/" here broke Back when the
  // Discover bento landed: under the collapsed IA no tab points at "/" anymore
  // (Discover moved to /discover, everyone lands on Chats), so `location !==
  // "/"` was true on every tab and switching ALWAYS replaced — Back exited the
  // app instead of returning to Chats.
  const iaCollapsed = useIaCollapsed();
  const historyBase = iaCollapsed ? "/messages" : "/";
  const goTab = (target: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (location === target) return;
    // Push only from the BOTTOM of the app's stack (index 0); replace
    // everywhere else. Deciding by pathname (`location !== historyBase`)
    // accumulated one duplicate base entry per base→tab→base round trip — the
    // stack never stopped growing and Back had to chew through copies of the
    // base. The index says what the pathname can't: whether an entry is
    // already beneath us.
    setLocation(target, { replace: appHistoryIndex() > 0 });
  };

  // Chats badge = DM unread + Concord: mentions of you count as NUMBERS, a
  // community with mere activity contributes 1 (presence), muted contributes 0.
  const concordUnread = useConcordUnread();
  const concordMentions = useConcordMentionCounts();
  useEffect(() => { void ensureConcordUnreadWatcher(pubkey); ensureConcordMentionScanner(pubkey); }, [pubkey]);
  const chatsUnread = unreadDmCount + concordChatsBadgeCount(concordUnread, concordMentions);

  // The footer finally reads the SAME source as the rail and the launcher. It
  // used to hardcode its five slots, which is why its order (Feed·News·+·
  // Communities·Chats) silently disagreed with the rail's for so long.
  // (`iaCollapsed` is read above, where goTab derives the history base.)
  const needsYou = useNeedsYouCount();
  const tabs = buildFooterTabs({
    loggedIn: !!pubkey,
    counts: { chatsUnread, newsUnread, alertsUnread: unreadCount, needsYou },
    collapsed: iaCollapsed,
  });
  // The centre button glowed on Feed or Communities — the two places you
  // compose INTO. Derived from the live tab list so it survives the collapse
  // (where those become Discover and Chats) instead of naming dead ids.
  const centreActive = tabs.some(
    (t) => isNavDestinationActive(t.id, location, search, iaCollapsed)
      && (t.id === "feed" || t.id === "communities" || t.id === "discover" || t.id === "chats"),
  );
  const leading = tabs.slice(0, 2);
  const trailing = tabs.slice(2);

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-50 md:hidden mobile-nav-dock transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none md:translate-y-0 md:opacity-100 ${
        effectiveHidden
          ? "translate-y-full opacity-0 pointer-events-none"
          : "translate-y-0 opacity-100"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="mobile-footer-nav"
    >
      <div className="mobile-nav-inner">
        <div className="flex items-end justify-around px-1">
          {leading.map((t) => (
            <FooterTab key={t.id} tab={t} active={isNavDestinationActive(t.id, location, search, iaCollapsed)} onNavigate={goTab} />
          ))}

          <div className="mobile-nav-center-wrapper">
            <button
              type="button"
              aria-label={outpostCompose ? (outpostCompose.activeTab === "topics" ? "New discussion" : outpostCompose.activeTab === "horizon" ? "New article" : "New post") : "Create post"}
              onClick={() => {
                if (outpostCompose) {
                  if (outpostCompose.activeTab === "horizon") {
                    if (outpostCompose.canPostHorizon) {
                      window.dispatchEvent(new CustomEvent("horizon-new-entry"));
                    }
                    return;
                  }
                  outpostCompose.triggerCompose(outpostCompose.activeTab === "topics" ? "topic" : "note");
                  return;
                }
                openCreateStudio();
              }}
              className={`mobile-nav-center ${centreActive ? "mobile-nav-center-active" : ""} ${!pubkey || (outpostCompose?.activeTab === "horizon" && !outpostCompose?.canPostHorizon) ? "opacity-40 pointer-events-none" : ""}`}
              data-testid="mobile-nav-create"
            >
              <CenterLogoIcon />
            </button>
          </div>

          {trailing.map((t) => (
            <FooterTab key={t.id} tab={t} active={isNavDestinationActive(t.id, location, search, iaCollapsed)} onNavigate={goTab} />
          ))}
        </div>
      </div>
    </nav>
  );
});
