import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation, useSearch } from "wouter";
import { useReducedMotion } from "framer-motion";
import { Search, LogOut, ChevronRight, ChevronDown, Sun, Moon, Eclipse, Check, UserPlus, X, Settings, SquarePen, Bug, Wrench, HelpCircle, Wallet, RadioTower } from "lucide-react";
import { getAdminOutposts } from "@/lib/featured-append";

// Custom "What's New" glyph (user-provided edit.svg): a quill over an
// underline. fill uses currentColor (source had hardcoded #ffffff) so it
// inherits the dock button's text color in both themes.
function WhatsNewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12.1259 1.03663L10.7832 2.45724L11.3811 6.29019L15.0534 6.65114L16.1648 5.47526C16.3074 5.32471 16.4364 5.177 16.5516 5.03181C16.9769 4.49583 17.2141 3.99409 17.248 3.5094C17.2882 2.93292 17.0512 2.18765 16.0453 1.23606C15.3217 0.555168 14.7267 0.263223 14.2361 0.179923C14.0445 0.1474 13.8688 0.146682 13.7076 0.167039C13.1939 0.231895 12.6742 0.527134 12.1259 1.03663ZM3.19662 10.484L9.48013 3.83592L10.0781 7.66935L13.75 8.03025L7.54641 14.5938L2.62891 15.4413L3.19662 10.484Z" />
      <path opacity="0.4" fillRule="evenodd" clipRule="evenodd" d="M0.25 18.5005H19.75V20.0005H0.25V18.5005Z" />
    </svg>
  );
}
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { buildNavDestinations, NAV_ICONS } from "@/lib/nav-destinations";
import { useBackClosable } from "@/hooks/use-back-closable";
import { useNeedsYouCount } from "@/contexts/NeedsYouContext";
import { useIaCollapsed } from "@/lib/ia-prefs";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useNWC } from "@/contexts/NWCContext";
import { useTheme } from "@/hooks/use-theme";
import { ensureConcordUnreadWatcher, useConcordUnread } from "@/lib/concord/concord-unread";
import { concordChatsBadgeCount, useConcordMentionCounts } from "@/lib/concord/concord-mentions";
import { ensureConcordMentionScanner } from "@/lib/concord/concord-mention-scan";
import { openCreateStudio } from "@/components/CreateStudio";
import { isNavDestinationActive } from "@/lib/footer-nav";
import { primeKeyboard } from "@/lib/keyboard-handoff";
import { formatNpub, shortenNpub, getDisplayName, getAvatarUrl, getProfileContent } from "@/lib/nostr-helpers";
import { queryClient } from "@/lib/queryClient";
import { getCachedProfile, fetchProfilesCached } from "@/lib/nostr";
import { usePeopleTypeahead } from "@/hooks/use-people-typeahead";
import {
  getRecentDestinations,
  getDismissedSuggestionIds,
  dismissSuggestion,
  destinationSuggestionId,
  filterDismissed,
} from "@/lib/recent-destinations";
import {
  getRecentSearches,
  recordRecentSearch,
  clearRecentSearches,
} from "@/lib/recent-searches";
import { getRecentProfiles, clearRecentProfiles } from "@/lib/recent-profiles";
import { openFeedbackDrawer } from "@/lib/nip34-feedback";
import { getConversationList, getLatestMessage, isLeakedInviteBundleJson } from "@/lib/dm-cache";
import { readDmLastRead } from "@/lib/dm-read";
import { getLocalScheduledPosts } from "@/lib/local-schedule";
import { getCommunity } from "@/lib/concord/concord-keys";
import { getLocallyCachedPinnedEvents } from "@/lib/calendar-events";
import {
  selectUpNext,
  eventCandidateFromPinned,
  type UpNextEventCandidate,
  type UpNextDmCandidate,
} from "@/lib/up-next";
import { requestAccountHeaderExpand } from "@/lib/account-expand";
import { DEFAULT_FEEDS, loadCustomFeeds, loadHiddenDefaults } from "@/lib/rss-feeds";
import { loadNewsAlertPrefs } from "@/lib/news-alert-settings";
import {
  computePriorityNewsUnread,
  loadRssReadLedger,
  type RssCachedItemLite,
} from "@/lib/orbit-stories";
import type { PriorityUnreadSummary } from "@/lib/news-unread";
import {
  listAccounts,
  getActiveAccountPubkey,
  switchAccount,
  removeAccount,
  beginAddAccount,
  accountDisplayName,
  type RegisteredAccount,
} from "@/lib/account-registry";

// The mobile "Stories" menu: a full-screen overlay with a fixed 4×2 grid of
// story-ring destinations (glowing conic ring = something new, dim ring =
// quiet) and, beneath it, always-visible live preview cards for the
// destinations that actually have content — all driven from data already on
// the device (see orbit-stories.ts). Replaces the old slide-out drawer; the
// desktop sidebar is untouched.
//
// Theme-aware: soft light surfaces with violet-alpha hairlines in light mode,
// the deep violet void (+ starfield) in dark. The dark values keep their
// original literals; light values map to the Synthesis tokens.
//
// One global event opens it from anywhere (the mobile header trigger today) —
// mirrors the CreateStudio open pattern.
export const OPEN_ORBIT_MENU = "open-orbit-menu";
export function openOrbitMenu() {
  window.dispatchEvent(new CustomEvent(OPEN_ORBIT_MENU));
}

interface StoryEntry {
  id: string;
  title: string;
  icon: (props: { className?: string }) => JSX.Element | null;
  path?: string;
  action?: () => void;
  count?: number;
  /** Story ring: true = glowing conic "something new" ring, false = quiet. */
  live?: boolean;
  testId: string;
}

interface StoryCard {
  id: string;
  title: string;
  body: string;
  path: string;
  testId: string;
}

/** "Jump back in" row with its identity resolved from local caches. */
interface ResolvedRecent {
  key: string;
  path: string;
  /** Display name; null while still resolving (renders a skeleton). */
  primary: string | null;
  /** Shortened npub — the LAST-RESORT subtitle, never the primary label. */
  secondary: string | null;
  avatar?: string;
  typeLabel: "Chat" | "Community";
  testId: string;
}

interface UpNextRow {
  primary: string;
  path: string;
  testId: string;
  /** Stable dismissal id ("upnext:<kind>:<id>") for the row's ✕. */
  suggestionId: string;
}

/** "Recent people" chip with its identity resolved from the kind-0 cache. */
interface RecentPerson {
  pubkey: string;
  /** Display name; null falls back to a shortened npub label. */
  name: string | null;
  avatar?: string;
}

const NOTIFICATION_LABELS: Record<string, string> = {
  reply: "a reply",
  mention: "a mention",
  reaction: "a reaction",
  repost: "a repost",
  zap: "a zap",
  follow: "a new follower",
  ticket: "a ticket update",
};

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function fmtCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Deterministic tiny PRNG so the starfield is stable across re-renders. */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Static starfield — plain SVG dots, no filters, no animation loops. Heavy
// glass ::before/::after textures caused repaint flicker on mobile sheets
// (PR #98), so this overlay sticks to opacity/transform-only effects.
// Dark mode only: on the light canvas it read as dust/noise.
function Starfield({ width, height }: { width: number; height: number }) {
  const stars = useMemo(() => {
    const rand = seededRandom(42);
    return Array.from({ length: 54 }, () => ({
      x: rand() * width,
      y: rand() * height,
      r: 0.4 + rand() * 1.1,
      o: 0.08 + rand() * 0.35,
      violet: rand() > 0.72,
    }));
  }, [width, height]);
  return (
    <>
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={s.violet ? "#a855f7" : "#ffffff"}
          opacity={s.o}
        />
      ))}
    </>
  );
}

export function OrbitMenu() {
  const [open, setOpen] = useState(false);
  const [dims, setDims] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 375,
    height: typeof window !== "undefined" ? window.innerHeight : 667,
  }));
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [isMac, setIsMac] = useState(false);
  useEffect(() => { setIsMac(/Mac|iPhone|iPad/.test(navigator.userAgent)); }, []);
  // Account switcher panel (identity chip tap). `removeArmedPk` is the
  // account whose per-row ✕ is showing its inline Remove confirm.
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [accounts, setAccounts] = useState<RegisteredAccount[]>([]);
  const [removeArmedPk, setRemoveArmedPk] = useState<string | null>(null);
  // Live in-menu search: the pill is a real input with a typeahead dropdown.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHighlight, setSearchHighlight] = useState(-1);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [dropdownMaxH, setDropdownMaxH] = useState(288);
  const searchWrapRef = useRef<HTMLFormElement>(null);
  const searchDropOpenRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const reducedMotion = useReducedMotion();
  const { theme, isDark, toggleTheme } = useTheme();

  const { pubkey, profile, logout } = useNostrAuth();
  const { unreadCount, unreadDmCount, notifications, lastSeenTimestamp } = useNotifications();
  const concordUnread = useConcordUnread();
  const concordMentions = useConcordMentionCounts();
  useEffect(() => { void ensureConcordUnreadWatcher(pubkey); ensureConcordMentionScanner(pubkey); }, [pubkey]);
  const chatsUnread = unreadDmCount + concordChatsBadgeCount(concordUnread, concordMentions);
  const iaCollapsed = useIaCollapsed();
  const { isConnected: walletConnected } = useNWC();

  const displayName = profile?.display_name || profile?.name || null;
  const npub = pubkey ? shortenNpub(formatNpub(pubkey)) : null;
  const avatarUrl = profile?.picture;

  // Open via the global event (fired by the mobile header trigger).
  useEffect(() => {
    const onOpen = () => {
      // All the state-priming below is best-effort: NOTHING here may prevent
      // setOpen(true) — a first tap that silently does nothing is the worst
      // failure mode a menu trigger can have (iOS user report). Rapid re-taps
      // while already open just re-prime and re-open; close unmounts
      // synchronously (no exit animation), so `open` can't wedge.
      try {
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        setDims({ width: window.innerWidth, height: window.innerHeight });
        setConfirmSignOut(false);
        setAccountPanelOpen(false);
        setRemoveArmedPk(null);
        try { setAccounts(listAccounts()); } catch { setAccounts([]); }
        setSearchQuery("");
        setSearchHighlight(-1);
        setSearchFocused(false);
      } catch {}
      setOpen(true);
    };
    window.addEventListener(OPEN_ORBIT_MENU, onOpen);
    return () => window.removeEventListener(OPEN_ORBIT_MENU, onOpen);
  }, []);

  // Belt-and-suspenders for the entrance animations: 700ms after opening
  // (every stagger has finished by then), a plain timer cancels them all via
  // the .orbit-settle CSS below, pinning the overlay at its static styles
  // (opacity 1, no transform). setTimeout keeps ticking when rAF — and even
  // the CSS animation timeline — stalls, so no animation glitch can leave the
  // menu (or any of its content) invisible for more than ~a second.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!open) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    const el = restoreFocusRef.current;
    if (el && typeof el.focus === "function") {
      // setTimeout, not rAF — rAF can stall entirely (background tab, iOS
      // throttling), which would leave focus wherever it was.
      setTimeout(() => el.focus(), 0);
    }
  }, []);

  // The launcher is a full-screen overlay: while it is open, Back must close
  // IT, not navigate the page underneath it (the live-QA teleport bug —
  // lib/modal-history.ts). Uses `close`, not bare setOpen(false), so the
  // focus-restore contract holds on the Back path too.
  useBackClosable(open, close);

  // Close on ANY navigation (mirrors the old drawer's full-location watcher) so
  // a tapped entry always reveals its page instead of leaving the overlay up.
  const prevLocation = useRef(`${location}?${search}`);
  useEffect(() => {
    const key = `${location}?${search}`;
    if (prevLocation.current !== key) {
      prevLocation.current = key;
      setOpen(false);
    }
  }, [location, search]);

  // The overlay is opened from the mobile trigger, but stays usable if the
  // viewport grows past md while open (rotation, window resize): at >= md the
  // content renders as a centered max-width column instead of full-bleed.

  // Track viewport changes while open (starfield sizing).
  useEffect(() => {
    if (!open) return;
    const onResize = () =>
      setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [open]);

  // Body scroll lock while open (the app scrolls inside <main>, but iOS can
  // still rubber-band the body behind a fixed overlay without this).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      // Never restore a stale "hidden": if another overlay (e.g. a radix
      // dialog) held the lock when we opened and released it while we were
      // up, restoring its captured value would leave the app permanently
      // unscrollable. Restoring "" instead is at worst a momentary
      // scroll-behind for a still-open dialog.
      document.body.style.overflow = prev === "hidden" ? "" : prev;
    };
  }, [open]);

  // Escape closes; Tab cycles inside the overlay (focus trap).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Layered: Escape peels one layer at a time — the search dropdown
        // first (ref, not state, so the listener rarely rebinds), then the
        // account switcher panel, then the overlay itself.
        if (searchDropOpenRef.current) {
          setSearchQuery("");
          setSearchHighlight(-1);
          return;
        }
        if (accountPanelOpen) {
          setAccountPanelOpen(false);
          setRemoveArmedPk(null);
          return;
        }
        close();
        return;
      }
      if (e.key === "Tab") {
        const root = containerRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // Move focus into the dialog without popping the mobile keyboard.
    // (setTimeout, not rAF — rAF stalls entirely in background tabs.)
    const focusTimer = setTimeout(() => containerRef.current?.focus(), 0);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, accountPanelOpen]);

  // Theme flip stays inside the menu: one clean 200ms View Transitions
  // crossfade (same mechanism as the Account page's toggle); browsers without
  // the API — and reduced-motion users — just snap.
  const toggleThemeAnimated = useCallback(() => {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) =>
        | { ready?: Promise<void>; finished?: Promise<void>; skipTransition?: () => void }
        | undefined;
    };
    if (!reducedMotion && typeof doc.startViewTransition === "function") {
      // Rapid re-taps (or a hidden tab) abort the previous transition — its
      // promises reject with "invalid state". The theme still applies; just
      // keep the rejection from surfacing as an unhandled error.
      try {
        const vt = doc.startViewTransition(() => toggleTheme());
        vt?.ready?.catch(() => {});
        vt?.finished?.catch(() => {});
        // iOS WebKit can leave a view transition HUNG (snapshot pseudo-tree
        // never torn down) — the whole page goes tap-dead, which reads as
        // "the menu won't open". Watchdog: if the ~200ms crossfade hasn't
        // finished well past its budget, force-skip it. skipTransition() on
        // an already-finished transition is a no-op-ish throw, hence the try.
        if (vt && typeof vt.skipTransition === "function") {
          const watchdog = setTimeout(() => {
            try { vt.skipTransition?.(); } catch {}
          }, 800);
          const clear = () => clearTimeout(watchdog);
          if (vt.finished) vt.finished.then(clear, clear);
          else clear();
        }
      } catch {
        // WebKit threw synchronously (unsupported edge / invalid state):
        // fall back to the direct flip — same path reduced-motion takes.
        toggleTheme();
      }
    } else {
      toggleTheme();
    }
  }, [toggleTheme, reducedMotion]);

  // ——— Stories data: rings + live preview cards ———
  // Everything below reads ONLY data that is already local: unread counts from
  // contexts, react-query's in-memory RSS cache, the News read-ledger, the DM
  // conversation cache (already-decrypted teasers) and locally scheduled
  // posts. Zero new relay work, zero decryption.

  // News: PRIORITY unread only (tier 1–2 within the 72h freshness window —
  // news-unread.ts, the same policy as the News page's badge). The raw
  // everything-unread diff produced numbers like "566"; that total now lives
  // only inside the News page as secondary text.
  const [rssUnread, setRssUnread] = useState<PriorityUnreadSummary>({ count: 0, topTitle: null, topId: null });
  useEffect(() => {
    if (!open) return;
    try {
      const cached = queryClient
        .getQueriesData<{ items?: RssCachedItemLite[] }>({ queryKey: ["/api/rss"] })
        .map(([key, data]) => ({
          url: typeof key[1] === "string" ? key[1] : undefined,
          items: data?.items,
        }));
      const hidden = loadHiddenDefaults();
      const savedFeeds = [...DEFAULT_FEEDS.filter((f) => !hidden.has(f.url)), ...loadCustomFeeds()];
      const prefs = loadNewsAlertPrefs();
      setRssUnread(
        computePriorityNewsUnread(cached, savedFeeds, loadRssReadLedger(), Date.now(), {
          mutedSources: prefs.mutedSources,
          mutedKeywords: prefs.mutedKeywords,
          onlyPresets: prefs.onlyPresets,
          onlyCreators: prefs.onlyCreators,
        }),
      );
    } catch {
      setRssUnread({ count: 0, topTitle: null, topId: null });
    }
  }, [open]);

  // Recent searches (local, per-account) for the empty-focused search pill.
  useEffect(() => {
    if (open) setRecentSearches(getRecentSearches(pubkey));
  }, [open, pubkey]);

  // "Recent people" for the same empty-focused state: recently visited
  // profiles (local MRU written by the Profile page; dismissed ids filtered
  // at selection so the next-most-recent person backfills), identities
  // resolved from the kind-0 cache with a targeted batched fetch for misses.
  const [recentPeople, setRecentPeople] = useState<RecentPerson[]>([]);
  useEffect(() => {
    if (!open || !pubkey) {
      setRecentPeople([]);
      return;
    }
    let alive = true;
    const base = filterDismissed(
      getRecentProfiles(pubkey),
      getDismissedSuggestionIds(pubkey),
      (p) => `profile:${p.pubkey}`,
    ).slice(0, 8);
    if (base.length === 0) {
      setRecentPeople([]);
      return;
    }
    const missing = base.filter((p) => !getCachedProfile(p.pubkey)).map((p) => p.pubkey);
    if (missing.length > 0) fetchProfilesCached(missing);
    const resolve = () => {
      if (!alive) return;
      setRecentPeople(
        base.map((p) => {
          const ev = getCachedProfile(p.pubkey);
          return {
            pubkey: p.pubkey,
            name: (ev ? getDisplayName(ev) : null) || null,
            avatar: (ev ? getAvatarUrl(ev) : undefined) || undefined,
          };
        }),
      );
    };
    resolve();
    const timers = missing.length ? [700, 1800].map((ms) => setTimeout(resolve, ms)) : [];
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [open, pubkey]);

  const dismissRecentPerson = useCallback(
    (pk: string) => {
      dismissSuggestion(pubkey, `profile:${pk}`);
      setRecentPeople((rows) => rows.filter((r) => r.pubkey !== pk));
    },
    [pubkey],
  );

  // In-menu live people typeahead — same machinery as the Search page (shared
  // cached/NIP-50 helpers, one debounced remote call, stale-cancel). Disabled
  // whenever the menu is closed, which also cancels anything in flight.
  const { results: peopleResults, loading: peopleLoading } = usePeopleTypeahead(searchQuery, open);
  const searchTrimmed = searchQuery.trim();
  const searchDropdownVisible =
    open && searchTrimmed.length >= 2 && (peopleResults.length > 0 || peopleLoading);
  const recentsDropdownVisible =
    open && searchFocused && searchTrimmed.length === 0 &&
    (recentSearches.length > 0 || recentPeople.length > 0);
  searchDropOpenRef.current = searchDropdownVisible;
  // Rows the keyboard can walk: people first, then the "See all results" row.
  const searchRowCount = peopleResults.length + 1;

  // Keyboard-aware dropdown height: cap it to the strip between the input and
  // the visual viewport's bottom (the mobile keyboard shrinks that), so
  // results never paint hidden behind the keyboard. Same approach as the
  // Search page's typeahead sizing.
  useEffect(() => {
    if (!searchDropdownVisible && !recentsDropdownVisible) return;
    const vv = window.visualViewport;
    const measure = () => {
      const wrap = searchWrapRef.current;
      if (!wrap) return;
      const inputBottom = wrap.getBoundingClientRect().bottom;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      setDropdownMaxH(Math.max(160, Math.min(320, Math.round(visibleBottom - inputBottom - 8))));
    };
    measure();
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [searchDropdownVisible, recentsDropdownVisible]);

  const go = useCallback(
    (path: string, opts?: { keyboard?: boolean }) => {
      if (opts?.keyboard) primeKeyboard();
      close();
      setLocation(path);
    },
    [close, setLocation],
  );

  // "Report a problem" — hand off to the app-wide FeedbackDrawer (App.tsx),
  // pre-set to the "bug" type. This is the USER-INITIATED, identified feedback
  // path (distinct from the anonymous auto crash reporter). Close this overlay
  // first, then open the Sheet a tick later so this z-[80] layer unmounts and
  // releases its scroll lock before the Sheet applies its own (mirrors the
  // PublicBetaBadge open-after-close timing).
  const reportProblem = useCallback(() => {
    close();
    setTimeout(() => openFeedbackDrawer({ initialType: "bug" }), 80);
  }, [close]);

  // Record + run a search (submit / see-all / recent-row tap). Typeahead
  // person taps record the QUERY TEXT too, so a half-typed name is re-runnable.
  const commitSearch = useCallback(
    (query: string) => {
      recordRecentSearch(pubkey, query);
      go(`/search?q=${encodeURIComponent(query)}`);
    },
    [pubkey, go],
  );
  const recordQueryOnly = useCallback(
    (query: string) => {
      if (query) {
        recordRecentSearch(pubkey, query);
        setRecentSearches(getRecentSearches(pubkey));
      }
    },
    [pubkey],
  );

  // "Jump back in": up to 3 most recent destinations from the local MRU
  // (written at the DM-thread and community write sites), with REAL identities
  // resolved at render time — DM rows from the kind-0 profile cache (kicking a
  // targeted batched fetch for at most 3 missing pubkeys), community rows from
  // the stored community record (name + icon). Skeleton while resolving; a raw
  // npub is never the primary label.
  const [resolvedRecents, setResolvedRecents] = useState<ResolvedRecent[]>([]);
  const [recentsSettled, setRecentsSettled] = useState(false);
  useEffect(() => {
    if (!open || !pubkey) {
      setResolvedRecents([]);
      setRecentsSettled(false);
      return;
    }
    let alive = true;
    // Dismissed rows are dropped BEFORE the cap, so the next-most-recent
    // destination backfills the freed slot on later menu opens.
    const base = filterDismissed(
      getRecentDestinations(pubkey),
      getDismissedSuggestionIds(pubkey),
      destinationSuggestionId,
    ).slice(0, 3);
    if (base.length === 0) {
      setResolvedRecents([]);
      return;
    }
    const missing = base.filter((r) => r.type === "dm" && !getCachedProfile(r.id)).map((r) => r.id);
    if (missing.length > 0) fetchProfilesCached(missing);
    setRecentsSettled(missing.length === 0);

    const build = async (): Promise<ResolvedRecent[]> =>
      Promise.all(
        base.map(async (r): Promise<ResolvedRecent> => {
          if (r.type === "dm") {
            const ev = getCachedProfile(r.id);
            const name = (ev ? getDisplayName(ev) : null) || r.label || null;
            return {
              key: `dm:${r.id}`,
              path: r.path,
              primary: name,
              secondary: shortenNpub(formatNpub(r.id)),
              avatar: (ev ? getAvatarUrl(ev) : undefined) || r.avatar,
              typeLabel: "Chat",
              testId: `orbit-recent-dm-${r.id.slice(0, 8)}`,
            };
          }
          let name = r.label || null;
          let avatar = r.avatar;
          try {
            const c = await getCommunity(pubkey, r.id);
            if (c) {
              name = c.name?.trim() || name;
              avatar = c.icon || avatar;
            }
          } catch {}
          return {
            key: `community:${r.id}`,
            path: r.path,
            primary: name,
            secondary: null,
            avatar,
            typeLabel: "Community",
            testId: `orbit-recent-community-${r.id.slice(0, 8)}`,
          };
        }),
      );
    const apply = () => {
      void build().then((rows) => {
        if (alive) setResolvedRecents(rows);
      });
    };
    apply();
    // Missing profiles land out-of-band via the batched fetch — re-resolve a
    // few times while the menu is open, then settle (skeletons fall back).
    const timers = missing.length
      ? [600, 1600, 3200].map((ms) => setTimeout(apply, ms))
      : [];
    const settleTimer = missing.length
      ? setTimeout(() => {
          if (alive) setRecentsSettled(true);
        }, 3600)
      : null;
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [open, pubkey]);

  // "Up next" — at most ONE timely row (up-next.ts owns the rules): a pinned
  // calendar event happening today, else a post scheduled within 24h, else a
  // DM unanswered >24h whose last message is inbound. All locally derived.
  const [upNextRow, setUpNextRow] = useState<UpNextRow | null>(null);
  useEffect(() => {
    if (!open || !pubkey) {
      setUpNextRow(null);
      return;
    }
    let alive = true;
    // Retry timers for the DM row's late-arriving profile (cleared on close).
    const upNextTimers: number[] = [];
    void (async () => {
      try {
        const now = Date.now();
        // Dismissed candidates drop out BEFORE the priority pick, so the
        // next-best timely row backfills (up-next.ts stays dismissal-blind).
        const dismissed = getDismissedSuggestionIds(pubkey);
        const events = filterDismissed(
          getLocallyCachedPinnedEvents(pubkey)
            .map(eventCandidateFromPinned)
            .filter((c): c is UpNextEventCandidate => c !== null),
          dismissed,
          (c) => `upnext:event:${c.id}`,
        );
        const scheduled = filterDismissed(
          getLocalScheduledPosts(pubkey).map((p) => ({
            id: p.id,
            snippet: p.contentPreview || "post",
            publishAtMs: Date.parse(p.scheduledAt as unknown as string),
            pending: p.status === "pending",
          })),
          dismissed,
          (p) => `upnext:scheduled:${p.id}`,
        );
        let dms: UpNextDmCandidate[] = [];
        try {
          const convos = (await getConversationList(pubkey)).slice(0, 8);
          dms = (
            await Promise.all(
              convos.map(async (c) => {
                const last = await getLatestMessage(pubkey, c.peerPubkey);
                if (!last) return null;
                return {
                  peerPubkey: c.peerPubkey,
                  lastMessageMs: last.timestamp * 1000,
                  lastIsInbound: last.from !== pubkey,
                };
              }),
            )
          ).filter((d): d is UpNextDmCandidate => d !== null);
        } catch {}
        dms = filterDismissed(dms, dismissed, (d) => `upnext:dm:${d.peerPubkey}`);
        const pick = selectUpNext(now, { events, scheduled, dms });
        if (!alive) return;
        if (!pick) {
          setUpNextRow(null);
        } else if (pick.kind === "event") {
          const when = pick.allDay ? "today" : fmtTime(pick.startMs);
          setUpNextRow({
            primary: `🗓 ${clip(pick.title, 40)} · ${when}`,
            path: "/calendar",
            testId: "orbit-up-next-event",
            suggestionId: `upnext:event:${pick.id}`,
          });
        } else if (pick.kind === "scheduled") {
          setUpNextRow({
            primary: `Scheduled: ${clip(pick.snippet, 36)} · ${fmtTime(pick.publishAtMs)}`,
            path: "/calendar",
            testId: "orbit-up-next-scheduled",
            suggestionId: `upnext:scheduled:${pick.id}`,
          });
        } else {
          // Resolve from the kind-0 cache, and — unlike the old single-shot —
          // re-resolve on a short ladder while the menu is open so the row
          // upgrades from "Reply to npub1…?" to the real name when the batched
          // profile fetch lands (same pattern as the Jump-back-in rows).
          const setDmRow = () => {
            const ev = getCachedProfile(pick.peerPubkey);
            const name = (ev ? getDisplayName(ev) : null) || shortenNpub(formatNpub(pick.peerPubkey));
            setUpNextRow({
              primary: `Reply to ${name}?`,
              path: `/messages/${formatNpub(pick.peerPubkey)}`,
              testId: "orbit-up-next-dm",
              suggestionId: `upnext:dm:${pick.peerPubkey}`,
            });
            return !!ev;
          };
          const resolved = setDmRow();
          if (!resolved) {
            fetchProfilesCached([pick.peerPubkey]);
            for (const ms of [600, 1600, 3200]) {
              upNextTimers.push(window.setTimeout(() => {
                if (alive) setDmRow();
              }, ms));
            }
          }
        }
      } catch {
        if (alive) setUpNextRow(null);
      }
    })();
    return () => {
      alive = false;
      upNextTimers.forEach(clearTimeout);
    };
  }, [open, pubkey]);

  // Dismissing a suggestion (the row ✕): persist per-account (expires after
  // ~14 days) and hide the row immediately; the next-best candidate backfills
  // on the next menu open via the selection-layer filters above.
  const dismissRecentRow = useCallback(
    (rowKey: string) => {
      dismissSuggestion(pubkey, rowKey);
      setResolvedRecents((rows) => rows.filter((r) => r.key !== rowKey));
    },
    [pubkey],
  );
  const dismissUpNext = useCallback(
    (suggestionId: string) => {
      dismissSuggestion(pubkey, suggestionId);
      setUpNextRow(null);
    },
    [pubkey],
  );

  // Live preview cards — one per destination that HAS content; quiet
  // destinations get no card (the grid ring already says quiet).
  const [cards, setCards] = useState<StoryCard[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const next: StoryCard[] = [];
      // Chats: counts + the latest cached, already-decrypted DM teaser (the
      // same store the chats list renders from — nothing is decrypted here).
      if (pubkey && chatsUnread > 0) {
        const bits: string[] = [];
        if (unreadDmCount > 0) bits.push(`${unreadDmCount} unread`);
        if (concordUnread.size > 0) bits.push(`${concordUnread.size} active communit${concordUnread.size === 1 ? "y" : "ies"}`);
        if (unreadDmCount > 0) {
          try {
            const convos = await getConversationList(pubkey);
            const latest = convos
              .filter(
                (c) =>
                  c.lastTimestamp > readDmLastRead(c.peerPubkey) &&
                  !!c.lastMessage &&
                  !isLeakedInviteBundleJson(c.lastMessage),
              )
              .sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
            if (latest) bits.push(`“${clip(latest.lastMessage, 56)}”`);
          } catch {}
        }
        next.push({ id: "chats", title: "Chats", body: bits.join(" · "), path: "/messages", testId: "orbit-card-chats" });
      }
      // Alerts: page-level unread + the newest notification's type.
      if (pubkey && unreadCount > 0) {
        const bits = [`${unreadCount} unread`];
        const newest =
          notifications
            .filter((n) => n.timestamp > lastSeenTimestamp)
            .sort((a, b) => b.timestamp - a.timestamp)[0] ??
          [...notifications].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (newest) bits.push(`latest: ${NOTIFICATION_LABELS[newest.type] ?? newest.type}`);
        next.push({ id: "alerts", title: "Alerts", body: bits.join(" · "), path: "/notifications", testId: "orbit-card-alerts" });
      }
      // News: priority unread + the newest PRIORITY unread headline as teaser.
      // Tapping the card lands ON the teased article (News page opens its
      // reader via the ?item= deep-link), not just the News page.
      if (rssUnread.count > 0) {
        const bits = [`${rssUnread.count} unread`];
        if (rssUnread.topTitle) bits.push(`“${clip(rssUnread.topTitle, 56)}”`);
        const newsPath = rssUnread.topId
          ? `/news?item=${encodeURIComponent(rssUnread.topId)}`
          : "/news";
        next.push({ id: "news", title: "News", body: bits.join(" · "), path: newsPath, testId: "orbit-card-news" });
      }
      // Calendar: next pending on-device scheduled post (localStorage).
      if (pubkey) {
        try {
          const upcoming = getLocalScheduledPosts(pubkey)
            .filter((p) => p.status === "pending" && new Date(p.scheduledAt as unknown as string).getTime() > Date.now())
            .sort(
              (a, b) =>
                new Date(a.scheduledAt as unknown as string).getTime() -
                new Date(b.scheduledAt as unknown as string).getTime(),
            )[0];
          if (upcoming) {
            const when = new Date(upcoming.scheduledAt as unknown as string).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            });
            const bits = [`next scheduled ${when}`];
            if (upcoming.contentPreview) bits.push(`“${clip(upcoming.contentPreview, 56)}”`);
            next.push({ id: "calendar", title: "Calendar", body: bits.join(" · "), path: "/calendar", testId: "orbit-card-calendar" });
          }
        } catch {}
      }
      if (alive) setCards(next);
    })();
    return () => {
      alive = false;
    };
  }, [open, pubkey, chatsUnread, unreadDmCount, concordUnread, unreadCount, notifications, lastSeenTimestamp, rssUnread]);

  // ——— Grid entries (inventory-complete vs the old drawer) ———
  // Fixed 4×2 grid, most-used first: Feed · Chats · News · Alerts /
  // Media · Calendar · Communities · Create. No scrolling, no cutoff.
  // Search gets the top pill; Account (plus Edit profile / Sign out) lives on
  // the identity chip's sheet; Settings / Tools / Invite / Help / What's New /
  // theme / Report / Wallet land in the dock bar; Terms / Privacy in the
  // micro row.
  const needsYou = useNeedsYouCount();
  // Operator gate for the Relay Control dock chip — one localStorage read per
  // menu open, no network.
  const isOperator = useMemo(() => getAdminOutposts().length > 0, []);
  const entries: StoryEntry[] = useMemo(() => {
    // Both the rings here and the desktop Stories rail read the SAME node list
    // (lib/nav-destinations.ts) so the two Stories surfaces can never drift.
    const destinations = buildNavDestinations({
      loggedIn: !!pubkey,
      counts: { chatsUnread, newsUnread: rssUnread.count, alertsUnread: unreadCount, needsYou },
      collapsed: iaCollapsed,
    });
    // The launcher trades "You" for "Create" once the IA collapses, and both
    // halves of that swap are the point.
    //
    // Dropping You: this menu already carries a LABELLED identity chip at the
    // bottom — avatar, name, "ACCOUNT ▾" — so a You ring above it is a second
    // control for the same person, which is the duplicate-identity problem the
    // rail and the header bell were already cleaned of. The chip wins here
    // because it is the more explicit of the two, unlike on the rail where the
    // reverse held.
    //
    // Adding Create: `create` lives only in the EXPANDED destination list, so
    // collapsing left it with no home on desktop at all — the mobile footer has
    // its own centre button, but the rail and this menu had nothing. The empty
    // slot You vacates is exactly where it belongs.
    const shown = iaCollapsed
      ? [
          ...destinations.filter((d) => d.id !== "you"),
          ...(pubkey ? [{ id: "create" as const, title: "Create", isAction: true }] : []),
        ]
      : destinations;
    return shown.map((d): StoryEntry => {
      const Icon = NAV_ICONS[d.id];
      return {
        id: d.id,
        title: d.title,
        icon: (p) => <Icon className={p.className} />,
        path: d.path,
        action: d.isAction ? () => { close(); openCreateStudio(); } : undefined,
        count: d.count,
        live: d.live,
        testId: `orbit-node-${d.id}`,
      };
    });
    // iaCollapsed MUST be here: it is read inside, and the launcher is a
    // long-lived overlay that mounts once. Without it the destination list is
    // computed at mount and frozen, so flipping "Simplified navigation" in
    // Settings updated the rail and the footer — both re-render on the store —
    // while the launcher kept serving its pre-toggle list until a full reload.
    // Looked exactly like "the menu ignores the setting."
  }, [pubkey, chatsUnread, unreadCount, rssUnread.count, needsYou, close, iaCollapsed]);

  const isEntryActive = useCallback(
    // Was a copy of the desktop rail's hand-rolled matcher, with the same defect:
    // the title special-case missed the collapsed IA's "Discover", so it fell
    // through to startsWith("/") and marked Discover current on every route.
    // Both surfaces now share the footer's id-keyed predicate.
    (entry: StoryEntry) =>
      entry.path ? isNavDestinationActive(entry.id, location, search, iaCollapsed) : false,
    [location, search, iaCollapsed],
  );

  // ——— Theme-dependent visuals ———
  // Dark keeps its original literals (deep violet void + neon rings); light
  // maps to the Synthesis system — soft near-white canvas, violet-alpha
  // hairlines, deeper violet ring stops so they stay legible on white.
  const overlayBg = isDark ? "hsl(258 32% 5%)" : "hsl(262 20% 97%)";
  const dropdownBg = isDark ? "hsl(258 28% 8%)" : "#ffffff";
  const dropdownShadow = isDark
    ? "0 10px 32px rgba(0,0,0,0.6), 0 0 16px rgba(124,58,237,0.2)"
    : "0 10px 32px rgba(31,27,75,0.14), 0 0 16px rgba(109,40,217,0.08)";
  const cardShadow = isDark
    ? "0 4px 18px rgba(0,0,0,0.35), 0 0 10px rgba(124,58,237,0.12)"
    : "0 4px 18px rgba(31,27,75,0.08), 0 0 10px rgba(109,40,217,0.06)";
  const ringConic = isDark
    ? "conic-gradient(from 0deg, #7c3aed, #a855f7 26%, rgba(168,85,247,0.3) 50%, #a855f7 72%, #7c3aed)"
    : "conic-gradient(from 0deg, #5b21b6, #7c3aed 26%, rgba(109,40,217,0.3) 50%, #7c3aed 72%, #5b21b6)";

  // ——— Account switcher actions ———
  // Switching does a deliberate full reload (see account-registry.ts): a
  // clean boot is the only way to guarantee zero cross-account state bleed.
  // No confirm step — a switch is trivially reversible from the same panel.
  const handleSwitchAccount = useCallback(
    (acct: RegisteredAccount) => {
      if (acct.pubkey === pubkey) {
        setAccountPanelOpen(false);
        return;
      }
      switchAccount(acct.pubkey, { toastMessage: `Switched to ${accountDisplayName(acct)}` });
    },
    [pubkey],
  );

  const handleRemoveAccount = useCallback(
    (acct: RegisteredAccount) => {
      const isActive = acct.pubkey === pubkey || getActiveAccountPubkey() === acct.pubkey;
      if (isActive) {
        // Removing the account you're currently using IS signing it out —
        // logout() removes only this account's credentials and switches to
        // the next known account (toast after reload), or fully signs out.
        close();
        logout();
        return;
      }
      try { removeAccount(acct.pubkey); } catch {}
      try { setAccounts(listAccounts()); } catch {}
      setRemoveArmedPk(null);
    },
    [pubkey, close, logout],
  );

  const handleAddAccount = useCallback(() => {
    // Marks the sign-in flow as ADD-mode: the new login joins the registry
    // and becomes active; the current account's credentials stay on device.
    beginAddAccount();
    go("/login");
  }, [go]);

  const chipClass =
    "inline-flex items-center gap-1.5 h-11 px-4 rounded-full border text-[12px] font-medium transition-colors border-primary/25 bg-white/70 text-foreground/85 active:bg-primary/10 dark:border-brand/20 dark:bg-white/[0.05] dark:text-white/75 dark:active:bg-white/[0.12]";
  // Dock bar — ONE glass container for the utility overflow, every button the
  // same geometry (replaces the old mixed pills/circles). Mobile shows tiny
  // labels under the icons for discoverability; ≥sm is icon-only (tooltips via
  // title). Buttons flex evenly on mobile so 7–8 items share the row without
  // overflow while keeping ≥44px targets wherever the viewport allows.
  const dockClass =
    "flex w-full max-w-[26rem] items-center justify-between gap-0.5 rounded-2xl border p-1.5 border-primary/25 bg-white/70 dark:border-brand/20 dark:bg-white/[0.05] sm:w-auto sm:max-w-none sm:justify-center sm:gap-1";
  const dockItemClass =
    "flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-foreground/75 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/10 dark:text-white/70 dark:active:bg-white/[0.12] sm:h-11 sm:w-11 sm:min-h-0 sm:flex-none sm:basis-auto sm:p-0";
  // Signed-in adds equal flexing so 7–8 items share the mobile row evenly;
  // signed-out items stay content-sized (only 3, the dock hugs them).
  const dockItemFlexClass = "flex-1 basis-0";
  const rowClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors border-primary/15 bg-white/70 active:bg-primary/[0.06] dark:border-brand/10 dark:bg-white/[0.03] dark:active:bg-white/[0.08]";
  const microLabelClass =
    "mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80 dark:text-brand/70";
  const avatarFallbackClass =
    "bg-secondary text-secondary-foreground dark:bg-[hsl(258,30%,14%)] dark:text-brand";

  // The overlay's entrance animations are TIME-BASED CSS animations, not
  // framer-motion: framer drives values via requestAnimationFrame, and iOS
  // Safari can stall rAF entirely (scroll flings, focus regain, low-power
  // mode) — reproduced in dev with rAF suspended, the menu then mounted stuck
  // at inline opacity 0: a full-screen invisible layer swallowing every tap
  // ("the menu doesn't open"). CSS animations are computed from elapsed time
  // at every paint, so a rAF stall can only delay the fade, never hold the
  // menu invisible. Close unmounts instantly for the same reason: an exit
  // animation that never ticks would wedge the overlay mounted forever.
  const overlay = !open ? null : (
        <div
          className={`orbit-enter-fade fixed inset-0 z-[80] overflow-hidden overscroll-contain ${settled ? "orbit-settle" : ""}`}
          style={{ background: overlayBg }}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          data-testid="orbit-menu-overlay"
          ref={containerRef}
          tabIndex={-1}
          onClick={(e) => {
            // Backdrop tap closes. The content column is pointer-events-none
            // with interactive children opted back in, so empty-space taps
            // land here.
            if (e.target === e.currentTarget) close();
          }}
        >
          {/* Explicit opaque backing layer (PR #321 pattern): iOS WebKit can
              fail to composite the BACKGROUND of an animated/transformed fixed
              container that holds a scrollable descendant — on-device the menu
              painted its rings/chips with NO panel behind them (the feed bled
              through). The shell itself stays overflow-free (scrolling lives on
              the inner middle wrapper below); this dedicated non-scrolling
              child layer makes the background unlosable. pointer-events-none so
              gutter taps still reach the shell's backdrop-close handler. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: overlayBg }}
            data-testid="orbit-menu-backing"
          />
          {/* Scoped keyframes: the live story rings + every entrance
              animation (see the rAF-stall note above — entrances must be CSS,
              time-based). "from"-only keyframes + fill-mode:both means the
              static styles (opacity 1, no transform) are the guaranteed
              resting state; reduced motion snaps everything straight there. */}
          <style>{`
            @keyframes orbit-ring-rot { to { transform: rotate(360deg); } }
            .orbit-ring-spin { animation: orbit-ring-rot 8s linear infinite; will-change: transform; }
            @keyframes orbit-kf-fade { from { opacity: 0; } }
            @keyframes orbit-kf-drop { from { opacity: 0; transform: translateY(-8px); } }
            @keyframes orbit-kf-rise { from { opacity: 0; transform: translateY(10px); } }
            @keyframes orbit-kf-pop  { from { opacity: 0; transform: scale(0.6); } }
            .orbit-enter-fade { animation: orbit-kf-fade 170ms ease-out both; }
            .orbit-enter-drop { animation: orbit-kf-drop 200ms ease-out 50ms both; }
            .orbit-enter-rise { animation: orbit-kf-rise 240ms ease-out both; }
            .orbit-enter-pop  { animation: orbit-kf-pop 280ms cubic-bezier(0.34,1.56,0.64,1) both; }
            .orbit-enter-late { animation: orbit-kf-fade 200ms ease-out 200ms both; }
            .orbit-enter-panel { animation: orbit-kf-rise 160ms ease-out both; }
            .orbit-settle.orbit-enter-fade, .orbit-settle .orbit-enter-drop,
            .orbit-settle .orbit-enter-rise, .orbit-settle .orbit-enter-pop,
            .orbit-settle .orbit-enter-late, .orbit-settle .orbit-enter-panel { animation: none; }
            @media (prefers-reduced-motion: reduce) {
              .orbit-ring-spin { animation: none; }
              .orbit-enter-fade, .orbit-enter-drop, .orbit-enter-rise,
              .orbit-enter-pop, .orbit-enter-late, .orbit-enter-panel { animation: none; }
            }
          `}</style>

          {/* Starfield — static SVG, GPU-cheap. Dark mode only; on the light
              canvas it read as noise. */}
          {isDark && (
            <svg
              className="absolute inset-0 h-full w-full pointer-events-none"
              width={dims.width}
              height={dims.height}
              viewBox={`0 0 ${dims.width} ${dims.height}`}
              aria-hidden="true"
            >
              <Starfield width={dims.width} height={dims.height} />
            </svg>
          )}

          {/* Content column: full-bleed on phones, a centered max-width column
              from md up (full-bleed at desktop read as unfinished). Empty-space
              taps close via target===currentTarget checks on the wrappers; the
              starfield stays full-screen behind. */}
          <div
            className="relative mx-auto flex h-full w-full max-w-[32rem] flex-col"
            style={{
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            {/* Search — a REAL input with a live people typeahead inside the
                overlay (and the focus trap). Enter / "See all results" hands
                off to the full Search page with the query; focusing it EMPTY
                surfaces the last few searches. */}
            <form
              ref={searchWrapRef}
              onSubmit={(e) => {
                e.preventDefault();
                if (searchTrimmed) commitSearch(searchTrimmed);
                else go("/search", { keyboard: true });
              }}
              className="orbit-enter-drop relative z-20 mx-auto w-[min(88vw,22rem)] shrink-0"
              data-testid="orbit-search-pill"
            >
              <div className="flex h-11 items-center gap-2.5 rounded-full border px-4 border-brand/30 bg-white/80 focus-within:border-brand/60 dark:border-brand/25 dark:bg-white/[0.06] dark:focus-within:border-brand/50">
                <Search className="h-4 w-4 shrink-0 text-brand/80" />
                <input
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchHighlight(-1);
                  }}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onKeyDown={(e) => {
                    if (!searchDropdownVisible) return;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSearchHighlight((h) => (h + 1) % searchRowCount);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSearchHighlight((h) => (h <= 0 ? searchRowCount - 1 : h - 1));
                    } else if (e.key === "Enter" && searchHighlight >= 0) {
                      e.preventDefault();
                      if (searchHighlight < peopleResults.length) {
                        recordQueryOnly(searchTrimmed);
                        go(`/profile/${formatNpub(peopleResults[searchHighlight].pubkey)}`);
                      } else {
                        commitSearch(searchTrimmed);
                      }
                    }
                  }}
                  className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground dark:text-white/90 dark:placeholder:text-white/50 focus:outline-none"
                  aria-label="Search"
                  aria-expanded={searchDropdownVisible || recentsDropdownVisible}
                  data-testid="orbit-search-input"
                />
                {/* Desktop-only affordance: this launcher answers the ⌘K/Ctrl-K
                    global hotkey the Stories rail binds. */}
                <kbd
                  className="ml-auto hidden shrink-0 items-center gap-0.5 rounded border border-brand/20 bg-brand/[0.08] px-1.5 py-0.5 text-[10px] font-mono text-brand/60 md:inline-flex"
                  aria-hidden="true"
                  data-testid="orbit-search-shortcut"
                >
                  {isMac ? "⌘" : "Ctrl+"}K
                </kbd>
              </div>
              {searchDropdownVisible && (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+6px)] overflow-y-auto overscroll-contain rounded-xl border border-brand/20 dark:border-brand/25"
                  style={{ maxHeight: dropdownMaxH, background: dropdownBg, boxShadow: dropdownShadow, WebkitOverflowScrolling: "touch" }}
                  data-testid="orbit-search-dropdown"
                >
                  {peopleResults.map((ev, idx) => {
                    const name = getDisplayName(ev) || `npub1…${ev.pubkey.slice(-6)}`;
                    const picture = getAvatarUrl(ev);
                    let nip05 = "";
                    try { nip05 = getProfileContent(ev)?.nip05 || ""; } catch {}
                    return (
                      <button
                        key={ev.pubkey}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          recordQueryOnly(searchTrimmed);
                          go(`/profile/${formatNpub(ev.pubkey)}`);
                        }}
                        className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors active:bg-primary/[0.08] dark:active:bg-white/[0.1] ${
                          searchHighlight === idx ? "bg-primary/[0.08] dark:bg-white/[0.08]" : ""
                        }`}
                        data-testid={`orbit-suggest-person-${ev.pubkey.slice(0, 8)}`}
                      >
                        <Avatar className="h-8 w-8 shrink-0 border border-brand/20">
                          <AvatarImage src={picture} alt={name} />
                          <AvatarFallback className={`text-[10px] ${avatarFallbackClass}`}>
                            {name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground dark:text-white/90">{name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground dark:text-white/45">
                            {nip05 || shortenNpub(formatNpub(ev.pubkey))}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitSearch(searchTrimmed)}
                    className={`flex min-h-11 w-full items-center justify-between px-3 py-2 text-left text-[12px] font-medium text-brand transition-colors active:bg-brand/[0.08] dark:active:bg-white/[0.1] ${ searchHighlight === peopleResults.length ? "bg-brand/[0.08] dark:bg-white/[0.08]" : "" } ${peopleResults.length > 0 ? "border-t border-brand/15" : ""}`}
                    data-testid="orbit-search-see-all"
                  >
                    <span>{peopleLoading && peopleResults.length === 0 ? "Searching…" : "See all results"}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              )}
              {recentsDropdownVisible && (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+6px)] overflow-y-auto overscroll-contain rounded-xl border border-brand/20 dark:border-brand/25"
                  style={{ maxHeight: dropdownMaxH, background: dropdownBg, boxShadow: dropdownShadow, WebkitOverflowScrolling: "touch" }}
                  data-testid="orbit-recent-searches"
                >
                  {/* Recent people — compact avatar strip of recently visited
                      profiles, above recent searches. Each chip navigates to
                      the profile; the corner ✕ removes the person via the
                      shared suggestion-dismissal ledger. */}
                  {recentPeople.length > 0 && (
                    <div className="px-3 pb-1 pt-2" data-testid="orbit-recent-people">
                      <div className="flex items-center justify-between pb-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand/80 dark:text-brand/70">
                          Recent people
                        </span>
                        {/* Clear-all, mirroring the Recent searches header — the
                            per-avatar ✕ stays for removing one person. */}
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            clearRecentProfiles(pubkey!);
                            setRecentPeople([]);
                          }}
                          className="min-h-[24px] px-1.5 text-[11px] font-medium text-muted-foreground active:text-foreground dark:text-white/45 dark:active:text-white/80"
                          data-testid="orbit-recent-people-clear"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
                        {recentPeople.map((p) => {
                          const label = p.name || shortenNpub(formatNpub(p.pubkey));
                          return (
                            <div key={p.pubkey} className="relative shrink-0">
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => go(`/profile/${formatNpub(p.pubkey)}`)}
                                className="flex w-14 flex-col items-center gap-1 pt-1.5"
                                data-testid={`orbit-recent-person-${p.pubkey.slice(0, 8)}`}
                              >
                                <Avatar className="h-11 w-11 border border-brand/20">
                                  <AvatarImage src={p.avatar} alt={label} />
                                  <AvatarFallback className={`text-[10px] ${avatarFallbackClass}`}>
                                    {label.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="w-full truncate text-center text-[10px] text-muted-foreground dark:text-white/50">
                                  {label}
                                </span>
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => dismissRecentPerson(p.pubkey)}
                                className="absolute -right-1 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full border bg-white text-muted-foreground/60 active:text-foreground border-brand/20 dark:border-brand/25 dark:bg-[hsl(258,28%,10%)] dark:text-white/40 dark:active:text-white/80"
                                aria-label={`Remove ${label} from recent people`}
                                data-testid={`orbit-recent-person-dismiss-${p.pubkey.slice(0, 8)}`}
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {recentSearches.length > 0 && (
                    <>
                      <div className={`flex items-center justify-between px-3 pb-0.5 pt-2 ${recentPeople.length > 0 ? "border-t border-brand/10 dark:border-brand/15" : ""}`}>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand/80 dark:text-brand/70">
                          Recent
                        </span>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            clearRecentSearches(pubkey);
                            setRecentSearches([]);
                          }}
                          className="min-h-[24px] px-1.5 text-[11px] font-medium text-muted-foreground active:text-foreground dark:text-white/45 dark:active:text-white/80"
                          data-testid="orbit-recent-searches-clear"
                        >
                          Clear
                        </button>
                      </div>
                      {recentSearches.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitSearch(q)}
                          className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition-colors active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                          data-testid={`orbit-recent-search-${q.slice(0, 16)}`}
                        >
                          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 dark:text-white/40" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90 dark:text-white/85">{q}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </form>

            {/* Middle region (grid + cards) scrolls vertically on short
                viewports — the bottom identity/overflow chips stay pinned and
                reachable instead of clipping. This inner wrapper is the ONLY
                scroller inside the animated shell (see the backing-layer note
                above): keeping overflow off the shell itself is what lets iOS
                composite the menu background reliably. */}
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
              style={{ WebkitOverflowScrolling: "touch" }}
              onClick={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
            {/* Stories grid: destinations as story rings in a FIXED 2-row ×
                4-column grid — no scrolling, no cutoff. Ring size scales with
                the column width (clamped ~52–64px) so 320→430px all render 8
                entries unclipped; the >= md centered column fits naturally. */}
            <div
              className="mt-5 grid shrink-0 grid-cols-4 gap-x-1 gap-y-3 px-3"
              data-testid="orbit-rail"
            >
              {entries.map((entry, i) => {
                const active = isEntryActive(entry);
                const isCreate = entry.id === "create";
                return (
                  <button
                    key={entry.id}
                    type="button"
                    style={{ animationDelay: `${40 + i * 40}ms` }}
                    onClick={() => (entry.action ? entry.action() : entry.path ? go(entry.path) : undefined)}
                    className="orbit-enter-pop flex min-w-0 flex-col items-center rounded-2xl py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={entry.count ? `${entry.title}, ${entry.count} new` : entry.title}
                    aria-current={active ? "page" : undefined}
                    data-testid={entry.testId}
                  >
                    {/* Story ring: glowing conic gradient when the destination
                        has something new; dim hairline when quiet. Painted
                        once; the live ring spins with a transform-only CSS
                        animation — no filters, GPU-cheap. */}
                    <span
                      className="relative flex h-[clamp(52px,15vw,64px)] w-[clamp(52px,15vw,64px)] items-center justify-center rounded-full"
                      style={{
                        boxShadow: active
                          ? isDark
                            ? "0 0 18px rgba(168,85,247,0.55), 0 0 6px rgba(168,85,247,0.4)"
                            : "0 0 18px rgba(109,40,217,0.30), 0 0 6px rgba(109,40,217,0.18)"
                          : entry.live
                            ? isDark
                              ? "0 0 14px rgba(168,85,247,0.4)"
                              : "0 0 14px rgba(109,40,217,0.22)"
                            : isCreate
                              ? isDark
                                ? "0 0 10px rgba(124,58,237,0.25)"
                                : "0 0 10px rgba(109,40,217,0.12)"
                              : isDark
                                ? "0 0 8px rgba(124,58,237,0.16)"
                                : "0 0 8px rgba(109,40,217,0.08)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute inset-0 rounded-full ${entry.live && !reducedMotion ? "orbit-ring-spin" : ""}`}
                        style={{
                          background: entry.live
                            ? ringConic
                            : active
                              ? isDark
                                ? "rgba(196,181,253,0.6)"
                                : "rgba(109,40,217,0.6)"
                              : isCreate
                                ? isDark
                                  ? "rgba(168,85,247,0.4)"
                                  : "rgba(109,40,217,0.42)"
                                : isDark
                                  ? "rgba(168,85,247,0.22)"
                                  : "rgba(109,40,217,0.26)",
                        }}
                        data-testid={entry.live ? `${entry.testId}-ring-live` : `${entry.testId}-ring-quiet`}
                      />
                      <span
                        className="absolute inset-[3px] flex items-center justify-center rounded-full transition-colors"
                        style={{
                          background: active
                            ? isDark
                              ? "hsl(262 45% 17%)"
                              : "hsl(262 45% 92%)"
                            : isCreate
                              ? isDark
                                ? "hsl(262 38% 12%)"
                                : "hsl(262 40% 96%)"
                              : isDark
                                ? "hsl(258 26% 10%)"
                                : "#ffffff",
                        }}
                      >
                        <entry.icon
                          className={`h-6 w-6 ${ active ? "text-brand" : isCreate ? "text-brand" : "text-foreground/80 dark:text-white/85" }`}
                        />
                      </span>
                      {/* The count used to live in the label text ("Chats · 3").
                          With the label gone it becomes a badge, the same
                          treatment the rail and footer already use — otherwise
                          removing a word would have quietly removed the number. */}
                      {entry.count !== undefined && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background"
                          data-testid={`${entry.testId}-count`}
                        >
                          {fmtCount(entry.count)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Live preview cards — one per destination with content, always
                visible (no gesture). Quiet destinations get no card. */}
            <div
              className="mt-4 space-y-2.5 px-4 pb-3"
              data-testid="orbit-card-stack"
              onClick={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
              {cards.map((card, i) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => go(card.path)}
                  className="orbit-enter-rise block w-full rounded-xl border p-3.5 text-left border-brand/15 bg-white/80 active:bg-brand/[0.06] dark:border-brand/20 dark:bg-white/[0.05] dark:active:bg-white/[0.1]"
                  style={{ boxShadow: cardShadow, animationDelay: `${180 + i * 60}ms` }}
                  data-testid={card.testId}
                >
                  <span className="block text-[13px] font-semibold text-foreground dark:text-white/90">{card.title}</span>
                  <span
                    className="mt-0.5 block text-[12px] leading-snug text-muted-foreground dark:text-white/60"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {card.body}
                  </span>
                </button>
              ))}
            </div>

            {/* Jump back in — up to 3 most recent destinations from the local
                MRU, with real names/avatars resolved from local caches (plus a
                targeted batched fetch for missing profiles). Renders nothing
                when the ledger is empty. */}
            {resolvedRecents.length > 0 && (
              <div className="mt-4 px-4 pb-3" data-testid="orbit-jump-back">
                <div className={microLabelClass}>Jump back in</div>
                <div className="space-y-1.5">
                  {resolvedRecents.map((r) => {
                    const primary =
                      r.primary ?? (recentsSettled ? r.typeLabel : null);
                    return (
                      /* Row + its ✕ are SIBLINGS (buttons can't nest): the
                         nav button keeps the row look, the always-visible
                         muted ✕ overlays the right edge with a 44px target. */
                      <div key={r.key} className="relative">
                      <button
                        type="button"
                        onClick={() => go(r.path)}
                        className={`${rowClass} pr-11`}
                        data-testid={r.testId}
                      >
                        <Avatar className="h-7 w-7 shrink-0 border border-brand/20">
                          <AvatarImage src={r.avatar} alt={primary ?? r.typeLabel} />
                          <AvatarFallback className={`text-[9px] ${avatarFallbackClass}`}>
                            {primary ? (
                              primary.slice(0, 2).toUpperCase()
                            ) : (
                              <span className="block h-3 w-3 animate-pulse rounded-full bg-brand/20" />
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          {primary ? (
                            <span className="block truncate text-[12px] font-medium text-foreground/90 dark:text-white/85">
                              {primary}
                            </span>
                          ) : (
                            /* Clean skeleton while the identity resolves —
                               never a raw npub as the primary label. */
                            <span className="block h-3 w-24 animate-pulse rounded bg-primary/15 dark:bg-white/15" aria-hidden="true" />
                          )}
                          {r.secondary && (
                            <span className="block truncate text-[10px] text-muted-foreground/80 dark:text-white/40">
                              {r.secondary}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 dark:text-white/40">
                          {r.typeLabel}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissRecentRow(r.key)}
                        className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground/50 active:text-foreground dark:text-white/30 dark:active:text-white/70"
                        aria-label={`Dismiss ${primary ?? r.typeLabel} suggestion`}
                        data-testid={`${r.testId}-dismiss`}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Up next — at most ONE timely, locally-derived row (today's
                pinned event / a post publishing within 24h / a stale unanswered
                DM), rendered only when relevant. */}
            {upNextRow && (
              <div className="mt-1 px-4 pb-3" data-testid="orbit-up-next">
                <div className={microLabelClass}>Up next</div>
                {/* Same sibling-✕ pattern as the Jump-back-in rows. */}
                <div className="relative">
                <button
                  type="button"
                  onClick={() => go(upNextRow.path)}
                  className={`${rowClass} pr-11`}
                  data-testid={upNextRow.testId}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90 dark:text-white/85">
                    {upNextRow.primary}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-brand/60" />
                </button>
                <button
                  type="button"
                  onClick={() => dismissUpNext(upNextRow.suggestionId)}
                  className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground/50 active:text-foreground dark:text-white/30 dark:active:text-white/70"
                  aria-label="Dismiss suggestion"
                  data-testid={`${upNextRow.testId}-dismiss`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                </div>
              </div>
            )}
            </div>

            {/* Bottom: identity chip + dock bar — everything else the old
                drawer offered, quiet but present. */}
            <div className="orbit-enter-late mt-3 flex shrink-0 flex-col items-center gap-2 px-4">
              {/* Account switcher panel — a compact glass sheet above the
                  identity chip listing every account this device knows.
                  Lives inside the overlay's existing focus trap; Escape
                  closes the panel before the overlay. */}
              {pubkey && accountPanelOpen && (
                <div
                  className="orbit-enter-panel w-[min(92vw,24rem)] rounded-2xl border p-1.5 border-brand/25 bg-white/95 shadow-[0_8px_28px_rgba(31,27,75,0.14),0_0_14px_rgba(109,40,217,0.08)] dark:border-brand/20 dark:bg-[hsl(258,28%,9%)]/95 dark:shadow-[0_8px_28px_rgba(0,0,0,0.5),0_0_14px_rgba(124,58,237,0.15)]"
                  role="group"
                  aria-label="Switch account"
                  data-testid="orbit-account-panel"
                >
                  {/* View profile — the sheet's "who am I" door: avatar + name
                      at the top, tapping opens your own profile page. */}
                  <button
                    type="button"
                    onClick={() => go(`/profile/${formatNpub(pubkey)}`)}
                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                    data-testid="orbit-account-view-profile"
                  >
                    <Avatar className="h-8 w-8 shrink-0 border border-brand/40">
                      <AvatarImage src={avatarUrl} alt={displayName || "You"} />
                      <AvatarFallback className={`text-[11px] ${avatarFallbackClass}`}>
                        {displayName ? displayName.slice(0, 2).toUpperCase() : npub ? npub.slice(0, 2).toUpperCase() : "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground/90 dark:text-white/90">
                        {displayName || npub}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground/80 dark:text-white/45">
                        View profile
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-brand/60" aria-hidden="true" />
                  </button>
                  {/* Edit profile — THE edit entry point now (the old
                      standalone pill folded into this sheet). */}
                  <button
                    type="button"
                    onClick={() => go("/account")}
                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                    data-testid="orbit-account-edit-profile"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground dark:text-white/50">
                      <SquarePen className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-[13px] font-medium text-foreground/85 dark:text-white/85">Edit profile</span>
                  </button>
                  <div className="mx-2 my-1 h-px bg-primary/10 dark:bg-white/[0.08]" aria-hidden="true" />
                  {accounts.map((acct) => {
                    const isActive = acct.pubkey === pubkey;
                    const name = isActive ? (displayName || accountDisplayName(acct)) : accountDisplayName(acct);
                    const pic = isActive ? (avatarUrl || acct.picture) : acct.picture;
                    const armed = removeArmedPk === acct.pubkey;
                    return (
                      <div key={acct.pubkey} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleSwitchAccount(acct)}
                          className="flex min-h-[44px] flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                          aria-label={isActive ? `${name}, current account` : `Switch to ${name}`}
                          aria-current={isActive ? "true" : undefined}
                          data-testid={`orbit-account-row-${acct.pubkey.slice(0, 8)}`}
                        >
                          <Avatar className="h-8 w-8 shrink-0 border border-brand/40">
                            <AvatarImage src={pic} alt={name} />
                            <AvatarFallback className={`text-[11px] ${avatarFallbackClass}`}>
                              {name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-foreground/90 dark:text-white/90">{name}</span>
                            <span className="block truncate text-[11px] text-muted-foreground/80 dark:text-white/45">
                              {shortenNpub(formatNpub(acct.pubkey))}
                            </span>
                          </span>
                          {isActive && (
                            <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" data-testid="orbit-account-active-check" />
                          )}
                        </button>
                        {armed ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveAccount(acct)}
                            className="inline-flex h-11 shrink-0 items-center rounded-xl border border-red-500/40 bg-red-500/15 px-3 text-[11px] font-medium text-red-600 active:bg-red-500/25 dark:text-red-300"
                            data-testid={`orbit-account-remove-confirm-${acct.pubkey.slice(0, 8)}`}
                          >
                            {isActive ? "Sign out" : "Remove"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRemoveArmedPk(acct.pubkey)}
                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground/60 active:bg-primary/[0.08] active:text-foreground dark:text-white/40 dark:active:bg-white/[0.1] dark:active:text-white/70"
                            aria-label={`Remove ${name} from this device`}
                            data-testid={`orbit-account-remove-${acct.pubkey.slice(0, 8)}`}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="mx-2 my-1 h-px bg-primary/10 dark:bg-white/[0.08]" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={handleAddAccount}
                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                    data-testid="orbit-account-add"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-brand/40 text-brand">
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-[13px] font-medium text-foreground/85 dark:text-white/85">Add account</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { requestAccountHeaderExpand(); go("/account/menu"); }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-primary/[0.08] dark:active:bg-white/[0.1]"
                    data-testid="orbit-account-menu-link"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground dark:text-white/50">
                      <Settings className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-[13px] font-medium text-foreground/70 dark:text-white/70">Account menu</span>
                  </button>
                  <div className="mx-2 my-1 h-px bg-primary/10 dark:bg-white/[0.08]" aria-hidden="true" />
                  {/* Sign out — folded in from the old standalone chip; arms
                      the existing confirm row (which renders where the dock
                      sits), so the panel closes to reveal it. */}
                  <button
                    type="button"
                    onClick={() => {
                      setAccountPanelOpen(false);
                      setConfirmSignOut(true);
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left active:bg-red-500/10 dark:active:bg-red-500/15"
                    data-testid="orbit-chip-signout"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-600/80 dark:text-red-300/80">
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-[13px] font-medium text-red-600/90 dark:text-red-300/90">Sign out</span>
                  </button>
                </div>
              )}
              {pubkey && (
                /* Identity row — the chip reads as one pill with two tap zones
                   (HTML forbids nested buttons, so a styled wrapper holds two
                   sibling buttons): avatar+name opens YOUR profile, the
                   "Account" chevron opens the switcher sheet, which now also
                   carries Edit profile and Sign out. */
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <div
                    className="flex h-11 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 transition-colors border-brand/25 bg-white/70 active:bg-brand/10 dark:border-brand/20 dark:bg-white/[0.05] dark:active:bg-white/[0.12]"
                    data-testid="orbit-identity-chip"
                  >
                    <button
                      type="button"
                      onClick={() => go(`/profile/${formatNpub(pubkey)}`)}
                      className="flex items-center gap-2 self-stretch rounded-full pr-1 transition-colors active:bg-primary/10 dark:active:bg-white/[0.12]"
                      aria-label="View your profile"
                      data-testid="orbit-identity-view-profile"
                    >
                      <Avatar className="h-8 w-8 border border-brand/40">
                        <AvatarImage src={avatarUrl} alt={displayName || "You"} />
                        <AvatarFallback className={`text-[11px] ${avatarFallbackClass}`}>
                          {displayName ? displayName.slice(0, 2).toUpperCase() : npub ? npub.slice(0, 2).toUpperCase() : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-[40vw] truncate text-[12px] font-medium text-foreground/90 dark:text-white/85">
                        {displayName || npub}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRemoveArmedPk(null);
                        if (!accountPanelOpen) {
                          try { setAccounts(listAccounts()); } catch {}
                        }
                        setAccountPanelOpen((v) => !v);
                      }}
                      className="flex items-center gap-1 self-stretch rounded-full px-1 text-[10px] uppercase tracking-[0.14em] text-brand/70 transition-colors active:bg-brand/10 dark:text-brand/80 dark:active:bg-white/[0.12]"
                      aria-label={accountPanelOpen ? "Close account switcher" : "Switch account"}
                      aria-expanded={accountPanelOpen}
                      data-testid="orbit-identity-account-toggle"
                    >
                      Account
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${accountPanelOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              )}
              {pubkey ? (
                confirmSignOut ? (
                  <div className="flex items-center gap-2" data-testid="orbit-signout-confirm">
                    <button
                      type="button"
                      onClick={() => { setConfirmSignOut(false); close(); logout(); }}
                      className="inline-flex h-11 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-4 text-[12px] font-medium text-red-600 active:bg-red-500/25 dark:text-red-300"
                      data-testid="orbit-confirm-signout"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmSignOut(false)}
                      className={chipClass}
                      data-testid="orbit-cancel-signout"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  /* Dock — ONE glass bar of uniform icon buttons (account
                     actions live on the identity chip's sheet now):
                     [Wallet] · Settings · Tools · Invite · Help · What's New ·
                     theme · Report */
                  <div className={dockClass} role="group" aria-label="Utilities" data-testid="orbit-dock">
                    {walletConnected && (
                      <button
                        type="button"
                        onClick={() => go("/account?tab=wallet")}
                        className={`${dockItemClass} ${dockItemFlexClass} !text-amber-600 dark:!text-amber-800/90 dark:text-amber-300/90`}
                        aria-label="Wallet"
                        title="Wallet"
                        data-testid="orbit-chip-wallet"
                      >
                        <Wallet className="h-5 w-5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => go("/settings")}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="Settings"
                      title="Settings"
                      data-testid="orbit-chip-settings"
                    >
                      <Settings className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/tools")}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="Tools"
                      title="Tools"
                      data-testid="orbit-chip-tools"
                    >
                      <Wrench className="h-5 w-5" aria-hidden="true" />
                    </button>
                    {/* Operators only: one quiet chip straight into Relay
                        Control — same dock, appears only when they run one. */}
                    {isOperator && (
                      <button
                        type="button"
                        onClick={() => go("/relays/admin")}
                        className={`${dockItemClass} ${dockItemFlexClass}`}
                        aria-label="Relay Control"
                        title="Relay Control"
                        data-testid="orbit-chip-relay-control"
                      >
                        <RadioTower className="h-5 w-5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => go("/account?invite=1")}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="Invite a friend"
                      title="Invite a friend"
                      data-testid="orbit-chip-invite"
                    >
                      <UserPlus className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/help")}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="Help"
                      title="Help"
                      data-testid="orbit-chip-help"
                    >
                      <HelpCircle className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => go("/whats-new")}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="What's New"
                      title="What's New"
                      data-testid="orbit-chip-whats-new"
                    >
                      <WhatsNewIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleThemeAnimated}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label={theme === "dark" ? "Switch to black mode" : theme === "black" ? "Switch to light mode" : "Switch to dark mode"}
                      title={theme === "dark" ? "Switch to black mode" : theme === "black" ? "Switch to light mode" : "Switch to dark mode"}
                      data-testid="orbit-chip-theme"
                    >
                      {theme === "dark" ? <Eclipse className="h-5 w-5" aria-hidden="true" /> : theme === "black" ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={reportProblem}
                      className={`${dockItemClass} ${dockItemFlexClass}`}
                      aria-label="Report a problem"
                      title="Report a problem"
                      data-testid="orbit-chip-report-problem"
                    >
                      <Bug className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                )
              ) : (
                /* Signed-out — Sign in stays a loud standalone button; the
                   dock carries just the guest-relevant utilities. The dock
                   hugs its content here (3 items never crowd a phone row). */
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => go("/login")}
                    className="inline-flex h-11 items-center rounded-full border px-5 text-[12px] font-semibold uppercase tracking-[0.14em] border-brand/50 bg-brand/15 text-brand active:bg-brand/25 dark:bg-brand/20 dark:active:bg-brand/30"
                    data-testid="orbit-chip-signin"
                  >
                    Sign in
                  </button>
                  <div className={`${dockClass} !w-auto !justify-center`} role="group" aria-label="Utilities" data-testid="orbit-dock">
                    <button
                      type="button"
                      onClick={() => go("/help")}
                      className={`${dockItemClass} px-3 sm:px-0`}
                      aria-label="Help"
                      title="Help"
                      data-testid="orbit-chip-help"
                    >
                      <HelpCircle className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={toggleThemeAnimated}
                      className={`${dockItemClass} px-3 sm:px-0`}
                      aria-label={theme === "dark" ? "Switch to black mode" : theme === "black" ? "Switch to light mode" : "Switch to dark mode"}
                      title={theme === "dark" ? "Switch to black mode" : theme === "black" ? "Switch to light mode" : "Switch to dark mode"}
                      data-testid="orbit-chip-theme"
                    >
                      {theme === "dark" ? <Eclipse className="h-5 w-5" aria-hidden="true" /> : theme === "black" ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={reportProblem}
                      className={`${dockItemClass} px-3 sm:px-0`}
                      aria-label="Report a problem"
                      title="Report a problem"
                      data-testid="orbit-chip-report-problem"
                    >
                      <Bug className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
              {/* Micro links the drawer surfaced via the beta dialog. */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/80 dark:text-white/35">
                <button type="button" onClick={() => go("/terms")} className="min-h-[24px] px-1 underline-offset-2 active:text-foreground dark:active:text-white/60" data-testid="orbit-link-terms">
                  Terms
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => go("/privacy")} className="min-h-[24px] px-1 underline-offset-2 active:text-foreground dark:active:text-white/60" data-testid="orbit-link-privacy">
                  Privacy
                </button>
              </div>
            </div>
          </div>
        </div>
  );

  return createPortal(overlay, document.body);
}
