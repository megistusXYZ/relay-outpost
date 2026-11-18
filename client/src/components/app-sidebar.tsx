import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { isNavItemActive } from "./sidebar-nav";
import { primeKeyboard } from "@/lib/keyboard-handoff";
import { NewsIcon } from "@/components/icons/NewsIcon";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { getOutpostRelays } from "@/lib/outpost-relays";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { Rss, Search, Unplug, Fingerprint, PanelLeftClose, Plus, ChevronsUpDown, GalleryVerticalEnd } from "lucide-react";
import { openCreateStudio } from "@/lib/shell-events";
import { AccountIcon } from "@/components/icons/AccountIcon";
import { SidebarOutposts } from "@/components/SidebarOutposts";
import { SidebarWallet } from "@/components/SidebarWallet";
import { CalendarAddIcon } from "@/components/icons/CalendarAddIcon";
import { MessagesIcon } from "@/components/icons/MessagesIcon";
import { NotificationIcon } from "@/components/icons/NotificationIcon";
import { useNotifications } from "@/contexts/NotificationContext";
import { useChatsBadge } from "@/hooks/use-chats-badge";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { PublicBetaBadge } from "@/components/PublicBetaBadge";
import { OttoMark } from "@/components/OttoMark";

// "You are an operator" signal. A bright center dot with two rings that
// pulse outward on a staggered loop — quiet, but visible in both light
// and dark themes. Built with stacked divs (instead of SVG transforms)
// so transform-origin behaves predictably across browsers.
function OperatorRadarIndicator() {
  return (
    <span
      className="operator-radar ml-auto relative inline-flex items-center justify-center w-5 h-5 shrink-0"
      aria-label="Operator console available"
      title="You operate at least one community — Console unlocked"
      data-testid="indicator-sidebar-operator-radar"
    >
      {/* Outer pulse ring */}
      <span className="operator-radar__ring operator-radar__ring--outer" aria-hidden="true" />
      {/* Inner pulse ring (staggered) */}
      <span className="operator-radar__ring operator-radar__ring--inner" aria-hidden="true" />
      {/* Static halo so the indicator is visible even between pulses */}
      <span className="operator-radar__halo" aria-hidden="true" />
      {/* Bright center dot */}
      <span className="operator-radar__dot" aria-hidden="true" />
    </span>
  );
}

export function AppSidebar() {
  const { toggleSidebar, setOpenMobile, isMobile } = useSidebar();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { pubkey, profile, isLoggingIn, isReconnecting, loginMethod } = useNostrAuth();
  const { unreadCount } = useNotifications();
  // Chats badge, the same everywhere (lib/chats-badge); empty while private mode masks the chats.
  const chatsUnread = useChatsBadge(pubkey).total;
  // Detect whether the signed-in pubkey owns at least one outpost relay.
  // Mirrors the gating used elsewhere: an OutpostRelay flagged `isAdmin`
  // means the operator console is unlocked for that relay. We re-read on
  // mount and on the global `outpost-relays-changed` event so the sidebar
  // signal updates the moment a relay is verified or removed.
  const [hasOperatorRelay, setHasOperatorRelay] = useState(false);
  useEffect(() => {
    if (!pubkey) { setHasOperatorRelay(false); return; }
    const sync = () => {
      try {
        const relays = getOutpostRelays();
        setHasOperatorRelay(relays.some((r) => r.isAdmin === true));
      } catch {
        setHasOperatorRelay(false);
      }
    };
    sync();
    window.addEventListener("outpost-relays-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [pubkey]);
  // Track the FULL location (pathname + query). wouter's `location` is
  // pathname-only, so query-only hops (Media ⇄ News ⇄ Search all live under
  // /search) wouldn't otherwise register as a route change.
  const prevLocation = useRef(`${location}?${search}`);

  const closeMobileNav = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  // Close the mobile sidebar on ANY navigation — including query-only hops among
  // Search/Media/News — so tapping any item reveals the page instead of leaving the
  // sheet covering it (a stuck-open sheet swallows subsequent taps). Keying on the
  // full location makes this reliable regardless of the per-link closeMobileNav.
  useEffect(() => {
    const key = `${location}?${search}`;
    if (prevLocation.current !== key) {
      prevLocation.current = key;
      setOpenMobile(false);
    }
  }, [location, search, setOpenMobile]);

  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setLocation("/search");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setLocation]);

  const displayName = profile?.display_name || profile?.name || null;
  const npub = pubkey ? shortenNpub(formatNpub(pubkey)) : null;
  const lightningAddress = profile?.lud16 || null;
  const avatarUrl = profile?.picture;

  // Search is its own thing — a standalone item above the browse group.
  const searchItem: { title: string; icon: any; path: string; testId: string; badge?: number } =
    { title: "Search", icon: Search, path: "/search", testId: "link-sidebar-search" };

  // Browse group: Feed → Media (the /search?tab=media hub) → News (a media slice).
  const mainItems: { title: string; icon: any; path: string; testId: string; badge?: number }[] = [
    { title: "Feed", icon: Rss, path: "/", testId: "link-sidebar-feed" },
    { title: "Media", icon: GalleryVerticalEnd, path: "/search?tab=media", testId: "link-sidebar-media" },
    { title: "News", icon: NewsIcon, path: "/news", testId: "link-sidebar-news" },
  ];

  const outpostSubItems: { title: string; icon: any; path: string; testId: string; badge?: number }[] = pubkey ? [
    { title: "Chats", icon: MessagesIcon, path: "/messages", testId: "link-sidebar-messages", badge: chatsUnread > 0 ? chatsUnread : undefined },
    { title: "Calendar", icon: CalendarAddIcon, path: "/calendar", testId: "link-sidebar-calendar" },
    { title: "Activity", icon: NotificationIcon, path: "/notifications", testId: "link-sidebar-notifications", badge: unreadCount > 0 ? unreadCount : undefined },
  ] : [];


  const loginMethodLabel = loginMethod === "bunker" ? "NIP-46" : loginMethod === "extension" ? "NIP-07" : null;
  const LoginMethodIcon = loginMethod === "bunker" ? Unplug : Fingerprint;

  // The profile row's inner content — shared by the desktop dropdown trigger and
  // the mobile button (which routes to the full /account page instead).
  // Active-state lives in the pure isNavItemActive helper (see sidebar-nav.ts +
  // sidebar-nav.test.ts) so the "exactly one item active" invariant is tested.
  const renderNavItem = (item: { title: string; icon: any; path: string; testId: string; badge?: number }) => {
    const isActive = isNavItemActive(location, search, item);
    const isSearch = item.path === "/search";
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={item.title}
          className={isActive ? "nav-item-active" : ""}
        >
          <Link href={item.path} data-testid={item.testId} onClick={(e) => {
            if (item.path === "/" && location === "/") {
              e.preventDefault();
              closeMobileNav();
              setTimeout(() => {
                const main = document.querySelector(".feed-scroll-container");
                if (main) main.scrollTo({ top: 0, behavior: "smooth" });
              }, 150);
              return;
            }
            // Same hand-off as the header magnifying glass: open the mobile
            // keyboard NOW (inside the tap gesture) so the Search page's input
            // can take over and the user can type immediately.
            if (isSearch) primeKeyboard();
            closeMobileNav();
          }}>
            <item.icon className={isActive ? "text-foreground" : ""} />
            <span>{item.title}</span>
            {isSearch && (
              <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground" data-testid="badge-search-shortcut">
                {isMac ? "⌘" : "Ctrl+"}K
              </kbd>
            )}
            {item.badge && (
              <span className="ml-auto text-xs font-semibold tabular-nums text-brand" data-testid="badge-notifications-unread">
                {item.badge > 99 ? "99+" : item.badge} new
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const accountButtonInner = (
    <>
      <Avatar className="w-7 h-7 border border-border shrink-0">
        <AvatarImage src={avatarUrl} alt={displayName || "Profile"} />
        <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
          {displayName ? displayName.slice(0, 2).toUpperCase() : npub ? npub.slice(0, 2).toUpperCase() : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col min-w-0 flex-1">
        {displayName && (
          <span className="text-xs font-medium truncate leading-tight" data-testid="text-sidebar-display-name">{displayName}</span>
        )}
        <span className="text-xs text-muted-foreground truncate leading-tight" data-testid="text-sidebar-subtitle">{lightningAddress || npub}</span>
        {isReconnecting ? (
          <span className="flex items-center gap-1 mt-0.5">
            <RelayOutpostInlineLoader className="w-2.5 h-2.5" />
            <span className="text-[12px] text-warning font-medium" data-testid="text-sidebar-reconnecting">Reconnecting</span>
          </span>
        ) : loginMethodLabel ? (
          <span className="flex items-center gap-1 mt-0.5">
            <LoginMethodIcon className="w-3 h-3 text-muted-foreground" />
            <span className="text-[12px] text-muted-foreground font-medium" data-testid="text-sidebar-login-method">{loginMethodLabel}</span>
          </span>
        ) : null}
      </div>
      <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </>
  );

  return (
    <Sidebar className="sidebar-galaxy">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center" data-testid="link-sidebar-brand" onClick={closeMobileNav}>
            <div className="flex items-center gap-2" data-testid="container-brand-pill">
              <OttoMark size={28} className="shrink-0" />
              <span className="text-[15px] font-semibold leading-none text-foreground">Relay Outpost</span>
            </div>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleSidebar()}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-sidebar-collapse"
          >
            <PanelLeftClose className="w-4 h-4" />
            <span className="sr-only">Close menu</span>
          </Button>
        </div>
        <div className="mt-2">
          <PublicBetaBadge variant="sidebar" onNavigate={closeMobileNav} />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Desktop only: on mobile the bottom-nav OUTPOSTS tab already links to
            /outposts (and the hub shows joined + discovery), so this tall
            expandable block is redundant — hide it to simplify the mobile menu. */}
        {!isMobile && (
          <SidebarOutposts
            closeMobileNav={closeMobileNav}
            operatorIndicator={hasOperatorRelay ? <OperatorRadarIndicator /> : null}
          />
        )}

        {/* Search stands on its own, above the browse group. */}
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <div className="glass-nav-panel rounded-lg mx-1 p-1.5" data-testid="container-search-nav">
              <SidebarMenu>
                {renderNavItem(searchItem)}
              </SidebarMenu>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Browse: Feed · Media · News */}
        <SidebarGroup className="pt-1">
          <SidebarGroupContent>
            <div className="glass-nav-panel rounded-lg mx-1 p-1.5" data-testid="container-main-nav">
              <SidebarMenu>
                {mainItems.map(renderNavItem)}
              </SidebarMenu>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {pubkey && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/account"}
                    tooltip="Your account dashboard — profile, wallet, trust & safety"
                  >
                    <Link href="/account" data-testid="link-sidebar-outpost" onClick={closeMobileNav}>
                      <AccountIcon className="w-4 h-4" />
                      <span className="flex-1">Account</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuSub>
                  {outpostSubItems.map((item) => {
                    const isActive = location.startsWith(item.path);
                    return (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isActive}
                          className="text-xs"
                        >
                          <Link href={item.path} data-testid={item.testId} onClick={closeMobileNav}>
                            <item.icon className="w-3.5 h-3.5" />
                            <span className="flex-1">{item.title}</span>
                            {item.badge && (
                              <span className="ml-auto text-xs font-semibold tabular-nums text-brand" data-testid="badge-notifications-unread">
                                {item.badge > 99 ? "99+" : item.badge} new
                              </span>
                            )}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                  <SidebarMenuSubItem>
                    <SidebarWallet closeMobileNav={closeMobileNav} />
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild className="text-xs">
                      <button
                        type="button"
                        onClick={() => { openCreateStudio(); closeMobileNav(); }}
                        data-testid="link-sidebar-create"
                        className="w-full text-brand"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span className="flex-1 text-left">Create</span>
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-4 py-3">
        <div className="space-y-1">
          {pubkey ? (
            <>
                // All breakpoints: the account switcher routes to the dedicated
                // /account/menu page (grouped iOS-Settings-style rows) instead of
                // opening a cramped floating dropdown. Same trigger (avatar + name
                // + chevron) — it just navigates now.
                <button
                  className="w-full flex items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-primary/[0.06] dark:hover:bg-white/[0.04] cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => { closeMobileNav(); setLocation("/account/menu"); }}
                  data-testid="button-account-menu"
                  title="Account"
                >
                  {accountButtonInner}
                </button>
            </>
        ) : (
          <button
            onClick={() => setLocation("/login")}
            disabled={isLoggingIn}
            className="w-full inline-flex items-center justify-center gap-2 px-3 h-10 rounded-full bg-foreground text-background text-sm transition-colors duration-150 hover:bg-foreground/90 disabled:opacity-50 disabled:pointer-events-none font-medium"
            data-testid="button-sidebar-login"
          >
            {isLoggingIn ? (
              <RelayOutpostInlineLoader className="w-4 h-4" />
            ) : (
              <>
                Sign in
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 opacity-70">
                  <g clipPath="url(#clip0_login_sat)">
                    <path d="M7.26 6.94L6.2 7.18C5.44 7.35 4.85 7.95 4.67 8.71L4.42 9.77C4.4 9.88 4.23 9.88 4.21 9.77L3.97 8.71C3.8 7.95 3.2 7.36 2.44 7.18L1.38 6.93C1.27 6.91 1.27 6.74 1.38 6.72L2.44 6.48C3.2 6.31 3.79 5.71 3.97 4.95L4.22 3.89C4.24 3.78 4.41 3.78 4.43 3.89L4.67 4.95C4.84 5.71 5.44 6.3 6.2 6.48L7.26 6.73C7.37 6.75 7.37 6.92 7.26 6.94Z" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" />
                    <path d="M7.17 2.92C7.49 2.43 7.86 1.97 8.29 1.54L20.73 13.98C19.03 15.68 16.75 16.55 14.51 16.55C12.27 16.55 9.99 15.68 8.29 13.98C7.56 13.25 6.99 12.42 6.57 11.54" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6.57 11.61L4.27 19L11.09 16.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M18.54 11.74V5.52" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M16.76 3.73H10.48" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M18.54 5.51C19.52 5.51 20.32 4.71 20.32 3.73C20.32 2.75 19.52 1.95 18.54 1.95C17.56 1.95 16.76 2.75 16.76 3.73C16.76 4.71 17.56 5.51 18.54 5.51Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3.02 22H20.99C21.55 22 22.01 21.54 22.01 20.98V20.01C22.01 19.45 21.55 18.99 20.99 18.99H3.02C2.46 18.99 2 19.45 2 20.01V20.98C2 21.54 2.46 22 3.02 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                  <defs>
                    <clipPath id="clip0_login_sat">
                      <rect width="24" height="24" fill="white" />
                    </clipPath>
                  </defs>
                </svg>
              </>
            )}
          </button>
        )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
