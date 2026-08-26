import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import { flushSync } from "react-dom";
import { eventStore, pool, subscribeToFeed, subscribeToFeedPersistent, fetchProfilesCached, fetchInteractionsCached, isProfileFetchSettled, FAST_RELAYS, getRelaysForPurpose, markFeedDataLoaded, hasFeedData, throttledPoolSubscribe } from "@/lib/nostr";
import { getCachedFeedEvents, cacheFeedEvents } from "@/lib/indexeddb-cache";
import { fetchRelayLists, getOptimalRelaysForFeed } from "@/lib/outbox";
import { KIND_TEXT_NOTE, KIND_REPOST } from "@/lib/nostr-helpers";
import { fetchTrendingFeed, fetchGlobalFeed, fetchFollowsFeed, requestFollowerCounts, getCachedFollowerCount, onFollowerCountUpdate, prefetchStatsImmediate, primalStatsCache, searchUsers, getLastReplyTimestamp, updateLastReplyTimestamp, getReplyParentId } from "@/lib/primal-cache";
import { MIN_FOLLOWERS_GLOBAL, isMachineReadableContent, type ReachDepth } from "@/lib/spam-filter";
import { NostrPost, VerifiedBadgeIcon, ParentUnresolvedContext } from "@/components/NostrPost";
import { PollPost } from "@/components/PollPost";
import { isPollEvent, fetchPollsFeed, KIND_POLL } from "@/lib/polls";
import { feedKinds, mediaPageLimit } from "@/lib/feed-kinds";
import { mergeSupplementIntoFeed, interleaveSupplement, splitSupplement, spreadAuthors } from "@/lib/feed-merge";
import { capForGuest } from "@/lib/guest-limits";
import { GuestWall } from "@/components/GuestWall";
import { MEDIA_EVENT_KINDS } from "@/lib/media-frame";
import { PrefetchPostWrapper } from "@/components/PrefetchPostWrapper";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HomeCoachmarks } from "@/components/HomeCoachmarks";
import { PageTabs } from "@/components/PageTabs";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { VirtualFeed } from "@/components/VirtualFeed";
import { FeedErrorBoundary } from "@/components/FeedErrorBoundary";
import { feedVirtualizationEnabled } from "@/lib/is-ios";
import { lazyRetry } from "@/lib/lazy-retry";
import { NewPostsPill } from "@/components/NewPostsPill";
import { hasPendingScrollRestore, isRestoreActive } from "@/lib/scroll-restore";
import { isLiveFeedMode, orderRevealedFirst } from "@/lib/new-posts";
import { ArticleFeedCard } from "@/components/ArticleFeedCard";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { useFollowsOfFollows } from "@/hooks/use-follows-of-follows";
import { Radio, Radar, Plus, Trash2, Antenna, Lock, Hash, Users, Filter, Eye, EyeOff, Type, ChevronDown, ChevronUp, X, Search, Package, Zap, Share2, Copy, Download, ShieldCheck, Grape, Rss, Sparkles, Image as ImageIcon, Video, Vote } from "lucide-react";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { type SignalTier, getSignalTierLabel } from "@/lib/graperank";
import { BrowsePacksDialog } from "@/components/BrowsePacksDialog";
import { SuggestedFollowsStrip } from "@/components/SuggestedFollowsStrip";
import { TuneAntennaIllustration, NoSignalIllustration, RadarSweepIllustration, StaticNoiseIllustration } from "@/components/EmptyStateIllustrations";
import { getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import { computeEngagementScore } from "@/lib/engagement";
import { useFeedPrefs } from "@/lib/feed-prefs";
import { useDiscoverPrefs, setDiscoverSort } from "@/lib/discover-prefs";
import { FeedOptionsSheet, type FeedSortValue, type PresetValue, type ContentFilterValue } from "./home/FeedOptionsSheet";
import { SavedOptionsSheet } from "./home/SavedOptionsSheet";
import { MediaGridGallery } from "./home/media-grid";

const SORT_LABELS: Record<FeedSortValue, string> = { popular: "Popular", latest: "Latest", trending: "Trending" };
const SHOW_LABELS: Record<ContentFilterValue, string> = { posts: "Posts", replies: "Replies", all: "All" };
const PRESET_LABELS: Record<PresetValue, string> = { open: "Open", balanced: "Balanced", strict: "Strict" };
import { rankDiscoverFeed } from "@/lib/discover-rank";
import { getFirstSeen, recordEventsFirstSeen } from "@/lib/account-age";
import { languageAllowed as langAllowed, getPreferredLanguages, ensureLanguageDetector, LANGUAGES_CHANGED_EVENT } from "@/lib/language";
import { getDiscoverFeedRelays, warmDiscoverRelays } from "@/lib/discover-relays";
import { getDiscoverPresetConfig, admitStranger } from "@/lib/discover-quality";
import { effectivePow } from "@/lib/nip13-pow";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { CHANNEL_FRIENDLY_RELAYS } from "@/lib/channel-relays";

const KIND_LONG_FORM = 30023;
// Discover safe floor: kinds the feed renders cleanly. The media kinds are
// here because the floor DROPS anything not listed — subscribing to 20/21/22
// without adding them here would have fetched hundreds of picture and video
// events and then thrown every one of them away, silently.
const DISCOVER_READABLE_KINDS = new Set([KIND_TEXT_NOTE, KIND_REPOST, KIND_POLL, KIND_LONG_FORM, ...MEDIA_EVENT_KINDS]);
import { useLocation } from "wouter";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from "@/components/ui/drawer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { useNostrFeeds, type NostrCustomFeed } from "@/hooks/use-nostr-feeds";
import { FeedIcon as FeedIconSvg, FEED_ICON_LIST, isValidFeedIconKey, type FeedIconKey } from "@/components/FeedIcons";
import { Skeleton } from "@/components/ui/skeleton";

import { publicNostrEnabled, publicNostrStorageKey } from "@/lib/public-nostr";
import { FeedMode, type ContentFilter, isReplyEvent, FeedSortMode, TopTimeWindow, TRENDING_SELECTORS, TRENDING_TIME_OPTIONS, type TrendingTimeValue, type ArchivesRange, POLL_SORTS, type PollSort, SAVED_POLL_SORTS, type SavedPollSort, SAVED_POLL_SHOW_OPTIONS, type SavedPollShow, FEED_SORT_OPTIONS, TIME_WINDOW_SORT_MODES, TOP_TIME_WINDOWS, PAGE_SIZE, TRENDING_CACHE_TTL, BUILT_IN_TABS, getFeedSortKey, getTopWindowKey, getSavedTabLabel, isArchivesSelector, getArchivesMetric, decodePubkey, resolveDefaultFeedMode } from "./home/helpers";

/**
 * How long the network gets before the cached feed is allowed to paint.
 *
 * Measured on this machine: IndexedDB answers in ~3ms, the feed API in ~1431ms.
 * A delay shorter than the network's own latency just reinstates the flash, so
 * this is sized to cover a normal response and fall through on a genuinely slow
 * one — not to be a token pause.
 */
const CACHE_FALLBACK_DELAY_MS = 1800;
import { fetchTopNotes } from "@/lib/nostr-archives";
import { FeedSkeletonCard, FeedSkeletonList, ChipInput, PeopleSearch, TuneFrequencyFormContent, TuneFrequencyDialog, REACH_DEPTH_STOPS, ReachDepthSlider, FEED_FILTER_TIERS, FeedTierFilter, StrictnessPresetControl } from "./home/feed-controls";
import { detectPreset, PRESET_DEFS, type StrictnessPreset } from "@/lib/trust-preset";
import { writeExcludedTiers } from "@/lib/trust-filter";

let _savedCutoffTimestamp: number | null = null;

// Rendered-feed snapshot for back-navigation: when the user leaves Home (to a
// thread/profile) and comes back, remount re-renders EXACTLY these items in
// this order — no refetch reshuffle under the restored scroll offset. Keyed by
// the feed configuration so a different tab/sort never shows a stale list.
let _savedFeedSnapshot: { key: string; events: Event[]; savedAt: number } | null = null;

// Phase 2 (#152): window-virtualize the feed. Default ON for desktop/Android;
// OFF on iOS/iPadOS, where Safari's threaded momentum scrolling starved the
// virtualizer of scroll events and corrupted row transforms in production
// (glitching rows, near-black pages). The gate + its overrides
// (`?forcePlainFeed=1`, `localStorage.ro_virtual_feed` = "0"/"1") live in
// lib/is-ios.ts. Read once per mount so a toggle takes effect on the next
// feed visit.

// Macro "Images"/"Videos" feeds reuse the real Search Media components (proper
// media kinds, gallery/player) instead of a crude kind-1 URL filter.
const ImagesFeedLazy = lazy(() => lazyRetry(() => import("./ImagesFeed")));
const VideoFeedLazy = lazy(() => lazyRetry(() => import("./VideoFeed")));
const PollsFeedLazy = lazy(() => lazyRetry(() => import("./PollsFeed")));

export default function Home() {
  const { pubkey, follows } = useNostrAuth();
  const { scores: grapeRankScores, flaggedPubkeys, isAuthorFlagged, requestScoresBulk, wotEnabled, wotReady, getAuthorTier } = useGrapeRankScores();
  const [, navigate] = useLocation();
  const { filter: spamFilter } = useSpamFilter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const useVirtualFeed = useMemo(() => feedVirtualizationEnabled(), []);
  const hasSessionPref = useRef(false);
  const [feedMode, setFeedModeState] = useState<FeedMode>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-feed-mode");
      if (saved === "transmission") { hasSessionPref.current = true; return "open_comms"; }
      if (saved) {
        if (saved === "open_comms" && !pubkey) {
          sessionStorage.removeItem("relay-outpost-feed-mode");
        } else {
          hasSessionPref.current = true;
          return saved as FeedMode;
        }
      }
    } catch {}
    try {
      const defaultMode = localStorage.getItem("relay-outpost-default-feed-mode");
      if (defaultMode && ["deep_scan", "raw_signal"].includes(defaultMode)) return defaultMode as FeedMode;
      if (defaultMode && defaultMode.startsWith("custom_")) return defaultMode as FeedMode;
      if (defaultMode === "open_comms") return "deep_scan";
    } catch {}
    return "deep_scan";
  });
  const defaultApplied = useRef(false);
  const getDefaultFeedMode = useCallback((): FeedMode => {
    // Where decision 4 finally gets READ. The flag has been written at signup
    // since #509 and consumed by nothing, which meant "public Nostr is off for
    // new accounts" was true in storage and false on screen — the same
    // writer-with-no-readers shape that let the collapsed IA ship unseen.
    //
    // Public Nostr off ⇒ land on Following, not on posts from across the
    // network. An explicit saved preference still wins over both.
    try {
      const publicNostr = publicNostrEnabled(
        localStorage.getItem(publicNostrStorageKey(pubkey) ?? "__none__"),
      );
      return resolveDefaultFeedMode(
        localStorage.getItem("relay-outpost-default-feed-mode"),
        { publicNostr },
      );
    } catch {}
    return "deep_scan";
  }, [pubkey]);
  useEffect(() => {
    if (defaultApplied.current || hasSessionPref.current) return;
    const defaultMode = getDefaultFeedMode();
    if (defaultMode === "open_comms") {
      if (pubkey && follows.length > 0) {
        defaultApplied.current = true;
        setFeedModeState("open_comms");
      }
    } else {
      defaultApplied.current = true;
      setFeedModeState(defaultMode);
    }
  }, [pubkey, follows, getDefaultFeedMode]);
  const setFeedMode = useCallback((mode: FeedMode) => {
    hasSessionPref.current = true;
    defaultApplied.current = true;
    setFeedModeState(mode);
    try {
      sessionStorage.setItem("relay-outpost-feed-mode", mode);
    } catch {}
  }, []);
  // Unified Posts / Replies / All content filter. Replaces the old
  // `crewShowReplies` toggle and now drives reply filtering across the
  // For You / Trending / Following feeds (NOT custom/saved feeds, which are
  // user-curated). Default "posts" so the main feed hides replies by default.
  const [contentFilter, setContentFilterState] = useState<ContentFilter>(() => {
    try {
      const saved = localStorage.getItem("relay-outpost-content-filter");
      if (saved === "posts" || saved === "replies" || saved === "all") return saved;
    } catch {}
    return "posts";
  });
  const setContentFilter = useCallback((value: ContentFilter) => {
    setContentFilterState(value);
    try { localStorage.setItem("relay-outpost-content-filter", value); } catch {}
  }, []);
  const [tierFilterExpanded] = useState(() => {
    try { return localStorage.getItem("relay-outpost-tier-filter-expanded") === "true"; } catch { return false; }
  });

  const [excludedTiers, setExcludedTiersState] = useState<Set<SignalTier>>(() => {
    try {
      const stored = localStorage.getItem("relay-outpost-excluded-tiers");
      if (stored) return new Set(JSON.parse(stored) as SignalTier[]);
    } catch {}
    return new Set();
  });
  // Persist via writeExcludedTiers (not a bare localStorage.setItem): it
  // dispatches the same-tab trust-filter-tiers-changed event, so consumers of
  // useExcludedTiers — the embedded Saved macro media feeds live under this
  // very bar — re-filter immediately when a chip is toggled.
  const toggleTierFilter = useCallback((tier: SignalTier) => {
    setExcludedTiersState(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier); else next.add(tier);
      writeExcludedTiers(next);
      return next;
    });
    setHasMore(true);
    if (tierSearchFloorRef.current) tierSearchFloorRef.current = 0;
  }, []);
  const clearTierFilters = useCallback(() => {
    setExcludedTiersState(new Set());
    writeExcludedTiers(new Set());
    setHasMore(true);
    if (tierSearchFloorRef.current) tierSearchFloorRef.current = 0;
  }, []);
  const setExcludedTiers = useCallback((tiers: SignalTier[]) => {
    const next = new Set(tiers);
    setExcludedTiersState(next);
    writeExcludedTiers(next);
    setHasMore(true);
    if (tierSearchFloorRef.current) tierSearchFloorRef.current = 0;
  }, []);


  const [reachDepth, setReachDepthState] = useState<ReachDepth>(() => {
    try {
      const stored = localStorage.getItem("relay-outpost-reach-depth");
      if (stored === "direct" || stored === "1hop" || stored === "2hops" || stored === "3hops") return "global";
      if (stored && ["global", "off"].includes(stored)) return stored as ReachDepth;
      const legacy = localStorage.getItem("relay-outpost-wot-filter");
      if (legacy === "true") return "global";
    } catch {}
    return "off";
  });
  const [tierChangeAt, setTierChangeAt] = useState<number>(0);
  const reachDepthRef = useRef<ReachDepth>(reachDepth);
  const resetVisibleWindowRef = useRef<() => void>(() => {});
  const setReachDepth = useCallback((depth: ReachDepth) => {
    const changed = reachDepthRef.current !== depth;
    if (changed) {
      reachDepthRef.current = depth;
      resetVisibleWindowRef.current();
      setTierChangeAt(Date.now());
    }
    setReachDepthState(depth);
    try { localStorage.setItem("relay-outpost-reach-depth", depth); } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  useEffect(() => { reachDepthRef.current = reachDepth; }, [reachDepth]);
  const savedDepthRef = useRef<ReachDepth | null>(null);
  const prevWotEnabledRef = useRef(wotEnabled);
  useEffect(() => {
    if (prevWotEnabledRef.current === wotEnabled) return;
    prevWotEnabledRef.current = wotEnabled;
    if (!wotEnabled) {
      if (reachDepth !== "off") {
        savedDepthRef.current = reachDepth;
        setReachDepthState("off");
      }
    } else {
      if (savedDepthRef.current && savedDepthRef.current !== "off") {
        setReachDepth(savedDepthRef.current);
        savedDepthRef.current = null;
      }
    }
  }, [wotEnabled, reachDepth, setReachDepth]);
  useEffect(() => {
    const handleSettingsApplied = () => {
      try {
        const stored = localStorage.getItem("relay-outpost-reach-depth");
        if (stored && ["1hop", "2hops", "3hops", "global", "off"].includes(stored)) {
          setReachDepthState(stored as ReachDepth);
        } else {
          setReachDepthState("off");
        }
      } catch {}
      try {
        const stored = localStorage.getItem("relay-outpost-excluded-tiers");
        if (stored) {
          setExcludedTiersState(new Set(JSON.parse(stored) as SignalTier[]));
        } else {
          setExcludedTiersState(new Set());
        }
      } catch {}
      if (!hasSessionPref.current) {
        try {
          const defaultMode = localStorage.getItem("relay-outpost-default-feed-mode");
          if (defaultMode && ["deep_scan", "raw_signal"].includes(defaultMode)) {
            setFeedModeState(defaultMode as FeedMode);
          } else if (defaultMode && defaultMode.startsWith("custom_")) {
            setFeedModeState(defaultMode as FeedMode);
          }
        } catch {}
      }
      try {
        const cfStored = localStorage.getItem("relay-outpost-content-filter");
        if (cfStored === "posts" || cfStored === "replies" || cfStored === "all") {
          setContentFilterState(cfStored);
        }
      } catch {}
    };
    window.addEventListener("nip78-settings-applied", handleSettingsApplied);
    return () => window.removeEventListener("nip78-settings-applied", handleSettingsApplied);
  }, []);

  const effectiveReachDepth: ReachDepth = wotEnabled && wotReady ? reachDepth : "off";
  // Derive the active "How strict?" preset straight from Home's live reach + tier
  // state so hand-tweaks in Customize immediately fall back to "Custom". (Home owns
  // this state; tier writes now fire the shared tiers-changed event for the embedded
  // media feeds, but reach writes are still direct — detect locally rather than via
  // useStrictnessPreset.)
  const activePreset: StrictnessPreset = detectPreset(reachDepth, excludedTiers);
  const applyStrictnessPreset = useCallback((name: Exclude<StrictnessPreset, "custom">) => {
    const def = PRESET_DEFS[name];
    setReachDepth(def.reach);
    setExcludedTiers(def.tiers);
  }, [setReachDepth, setExcludedTiers]);
  const [showRawGate, setShowRawGate] = useState(false);
  const rawAcknowledged = useRef(() => {
    try { return localStorage.getItem("relay-outpost-raw-acknowledged") === "true"; } catch { return false; }
  });
  const handleRawTabClick = useCallback(() => {
    if (rawAcknowledged.current()) {
      setFeedMode("raw_signal");
    } else {
      setFeedModeState("raw_signal");
      setShowRawGate(true);
    }
  }, [setFeedMode]);
  const acknowledgeRaw = useCallback((enableTrust: boolean) => {
    try { localStorage.setItem("relay-outpost-raw-acknowledged", "true"); } catch {}
    rawAcknowledged.current = () => true;
    setReachDepth(enableTrust ? "2hops" : "off");
    setShowRawGate(false);
    setFeedMode("raw_signal");
  }, [setFeedMode, setReachDepth]);
  // "For you" is the trust-ranked discovery feed. Rather than a scary unfiltered
  // gate, first-time signed-in visitors default to Network (their web of trust);
  // the Everyone end of the reach dial is where the raw firehose lives.
  const handleForYouClick = useCallback(() => {
    if (pubkey && wotEnabled && !rawAcknowledged.current()) {
      try { localStorage.setItem("relay-outpost-raw-acknowledged", "true"); } catch {}
      rawAcknowledged.current = () => true;
      setReachDepth("global");
    }
    setFeedMode("raw_signal");
  }, [pubkey, wotEnabled, setReachDepth, setFeedMode]);
  const [feedStyle, setFeedStyle] = useState<"all" | "photos" | "video" | "polls">("all");
  const [feedSortMode, setFeedSortModeState] = useState<FeedSortMode>("latest");
  const { rankingEnabled } = useFeedPrefs();
  // Discover v2 (flag-gated): curated-relay-sampled feed + algorithmic mix +
  // language/kind safe-floor. Off by default → behaves exactly as before.
  const { v2: discoverV2, sort: discoverSort } = useDiscoverPrefs();
  const [preferredLangs, setPreferredLangs] = useState<string[]>(() => getPreferredLanguages());
  useEffect(() => {
    if (!discoverV2) return;
    ensureLanguageDetector(); // warm the code-split language model
    warmDiscoverRelays(getPreferredLanguages()); // background: broaden the relay pool
    const onLangs = () => {
      setPreferredLangs(getPreferredLanguages());
      // New languages → re-warm the NIP-66 pool so the next fetch matches them.
      warmDiscoverRelays(getPreferredLanguages());
    };
    window.addEventListener(LANGUAGES_CHANGED_EVENT, onLangs);
    return () => window.removeEventListener(LANGUAGES_CHANGED_EVENT, onLangs);
  }, [discoverV2]);
  // Read latest discover state at subscribe time without churning the big load
  // effects. Only the global For You feed is broadened, and only when v2 is on;
  // otherwise `withDiscoverRelays` returns the base set unchanged.
  const discoverV2Ref = useRef(discoverV2);
  const preferredLangsRef = useRef(preferredLangs);
  const discoverGlobalRef = useRef(false);
  useEffect(() => { discoverV2Ref.current = discoverV2; preferredLangsRef.current = preferredLangs; }, [discoverV2, preferredLangs]);
  // The strictness preset drives BOTH breadth (relay pool cap / sub cap / time
  // window / which sources fold in) and the stranger-quality floor. Read via
  // refs at subscribe time so switching preset re-runs the load effects (via
  // discoverEpoch) without churning the withDiscoverRelays identity.
  const presetConfigRef = useRef(getDiscoverPresetConfig(activePreset));
  const followsRef = useRef(follows);
  useEffect(() => { presetConfigRef.current = getDiscoverPresetConfig(activePreset); }, [activePreset]);
  useEffect(() => { followsRef.current = follows; }, [follows]);
  // "Changes apply immediately": this key re-runs the load + live-sub effects
  // when the Discover toggle, preset, or languages change mid-session, so the
  // feed re-fetches with the new relay pool instead of waiting for a reload.
  const discoverEpoch = `${discoverV2 ? 1 : 0}:${activePreset}:${preferredLangs.join(",")}`;
  // Broaden the global For You relay set: FAST base → follows' outbox →
  // community (joined outposts + curated group relays) → curated-discover pool,
  // deduped and capped to the preset's sub cap. Higher-quality-by-default
  // sources (your follows' own relays, communities you joined) fold in first so
  // liveness rises without junk; Strict folds nothing extra (network-centered).
  const withDiscoverRelays = useCallback(
    (base: string[], capOverride?: number) => {
      const enabled = discoverV2Ref.current && discoverGlobalRef.current;
      if (!enabled) return base;
      const cfg = presetConfigRef.current;
      const cap = capOverride ?? cfg.subCap;
      const outbox = cfg.foldOutbox
        ? getOptimalRelaysForFeed(followsRef.current.slice(0, 100), 8)
        : undefined;
      const community = cfg.foldCommunity
        ? [
            ...getOutpostRelays().map((r) => r.url),
            ...CHANNEL_FRIENDLY_RELAYS.map((r) => r.url),
          ]
        : undefined;
      return getDiscoverFeedRelays(base, true, preferredLangsRef.current, cap, {
        outbox,
        community,
        foldOutbox: cfg.foldOutbox,
        foldCommunity: cfg.foldCommunity,
      });
    },
    [],
  );
  // On the global Discover feed, also query long-form articles (30023).
  const withDiscoverKinds = useCallback(
    (base: number[]) => (discoverV2Ref.current && discoverGlobalRef.current ? [...base, KIND_LONG_FORM] : base),
    [],
  );

  // X-style feed options sheet (replaces the old stacked header rows). Popular =
  // algorithmic mix, Latest = chronological, Trending = the top-notes source.
  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false);
  // Attached to the active feed tab pill so the desktop options popover drops
  // from it (mobile keeps the full-width bottom sheet). Only one tab is active
  // at a time, so this single ref serves both the For you/Following options
  // popover and the Saved options popover.
  const feedTabAnchorRef = useRef<HTMLButtonElement>(null);
  // Saved-pill options sheet (Images/Videos/Polls · sort · custom feeds ·
  // Tune/Packs/Import) — opened by tapping the active Saved pill, the same
  // bottom-sheet surface the other two pills use (SavedOptionsSheet).
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);
  // Sort for the macro Images/Videos feeds — owned HERE so it lives inside the
  // macro dropdown (one chip: "Images · Trending") instead of a second chip row.
  const [mediaSort, setMediaSort] = useState<"trending" | "latest">("trending");
  // Saved Polls macro feed controls (SavedOptionsSheet -> PollsFeed). Same
  // sessionStorage pattern as the For You pollSort, but distinct keys: the
  // Saved sort has an extra "latest" mode the For You selector doesn't.
  const [savedPollSort, setSavedPollSortState] = useState<SavedPollSort>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-saved-poll-sort") as SavedPollSort | null;
      if (saved && SAVED_POLL_SORTS.some(s => s.value === saved)) return saved;
    } catch {}
    return "trending";
  });
  const setSavedPollSort = useCallback((v: SavedPollSort) => {
    setSavedPollSortState(v);
    try { sessionStorage.setItem("relay-outpost-saved-poll-sort", v); } catch {}
  }, []);
  const [savedPollShow, setSavedPollShowState] = useState<SavedPollShow>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-saved-poll-show") as SavedPollShow | null;
      if (saved && SAVED_POLL_SHOW_OPTIONS.some(s => s.value === saved)) return saved;
    } catch {}
    return "open";
  });
  const setSavedPollShow = useCallback((v: SavedPollShow) => {
    setSavedPollShowState(v);
    try { sessionStorage.setItem("relay-outpost-saved-poll-show", v); } catch {}
  }, []);
  const currentSort: FeedSortValue = feedMode === "deep_scan" ? "trending" : (discoverSort === "latest" ? "latest" : "popular");
  const handleSortChange = useCallback((v: FeedSortValue) => {
    if (v === "trending") { setFeedMode("deep_scan"); }
    else {
      if (feedMode === "deep_scan") setFeedMode("raw_signal");
      setDiscoverSort(v === "popular" ? "mix" : "latest");
    }
    toast({ description: `Sorted by ${SORT_LABELS[v]}` });
  }, [feedMode, setFeedMode, toast]);
  const handleContentFilterChange = useCallback((v: ContentFilterValue) => {
    setContentFilter(v);
    toast({ description: `Showing ${SHOW_LABELS[v]}` });
  }, [setContentFilter, toast]);
  const handlePresetChange = useCallback((p: PresetValue) => {
    applyStrictnessPreset(p);
    toast({ description: `Strictness: ${PRESET_LABELS[p]}` });
  }, [applyStrictnessPreset, toast]);
  const [topTimeWindow, setTopTimeWindowState] = useState<TopTimeWindow>("24h");
  const [topFallbackAll, setTopFallbackAll] = useState(false);
  const topFallbackRef = useRef(false);
  const [topWindowLoading, setTopWindowLoading] = useState(false);
  const fetchedWindowsRef = useRef<Map<string, Set<string>>>(new Map());

  const setFeedSortMode = useCallback((mode: FeedSortMode, feedId?: string) => {
    setFeedSortModeState(mode);
    setTopFallbackAll(false);
    if (feedId) {
      try { localStorage.setItem(getFeedSortKey(feedId), mode); } catch {}
    }
  }, []);

  const setTopTimeWindow = useCallback((window: TopTimeWindow, feedId?: string) => {
    setTopTimeWindowState(window);
    setTopFallbackAll(false);
    if (feedId) {
      try { localStorage.setItem(getTopWindowKey(feedId), window); } catch {}
    }
  }, []);

  const [trendingSelector, setTrendingSelectorState] = useState(() => {
    const migrate = (v: string | null): string | null => {
      if (!v) return null;
      if (v === "mostzapped_24h" || v === "mostzapped_yesterday" || v === "mostzapped_week" || v === "mostzapped_4h") return "arc_zaps";
      if (v === "hot" || v === "rising" || v === "weekly_top") return "arc_reactions";
      if (v === "trending_12h" || v === "trending_24h") return "trending_4h";
      return v;
    };
    try {
      const saved = migrate(sessionStorage.getItem("relay-outpost-trending-selector"));
      if (saved) return saved;
      const preset = migrate(localStorage.getItem("relay-outpost-default-filter"));
      if (preset) return preset;
    } catch {}
    return "arc_replies";
  });

  const [archivesRange, setArchivesRangeState] = useState<ArchivesRange>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-archives-range");
      if (saved && ["today", "7d", "30d", "1y", "all"].includes(saved)) return saved as ArchivesRange;
    } catch {}
    return "today";
  });
  const setArchivesRange = useCallback((range: ArchivesRange) => {
    setArchivesRangeState(range);
    try { sessionStorage.setItem("relay-outpost-archives-range", range); } catch {}
  }, []);
  const setTrendingSelector = useCallback((sel: string) => {
    setTrendingSelectorState(sel);
    try { sessionStorage.setItem("relay-outpost-trending-selector", sel); } catch {}
  }, []);
  const [trendingPosts, setTrendingPosts] = useState<Event[]>([]);
  /**
   * Replies whose parent no relay would serve. Posts report themselves here
   * once their own lookup SETTLES — never while it is still in flight — so the
   * feed can drop a fragment without ever dropping a post that was merely slow.
   */
  const [unresolvedParents, setUnresolvedParents] = useState<Set<string>>(() => new Set());
  const markUnresolvedParent = useCallback((eventId: string) => {
    setUnresolvedParents((prev) => (prev.has(eventId) ? prev : new Set(prev).add(eventId)));
  }, []);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [pollResponseCounts, setPollResponseCounts] = useState<Map<string, number>>(new Map());
  const [pollSort, setPollSortState] = useState<PollSort>(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-poll-sort") as PollSort | null;
      if (saved && POLL_SORTS.some(s => s.value === saved)) return saved;
    } catch {}
    return "trending";
  });
  const setPollSort = useCallback((sort: PollSort) => {
    setPollSortState(sort);
    try { sessionStorage.setItem("relay-outpost-poll-sort", sort); } catch {}
  }, []);

  // ---- Trending controls in the For You options sheet ----
  // The metric pill/dropdown + time-range chip rows that used to sit under the
  // tab bar moved into FeedOptionsSheet; these handlers bridge the sheet's
  // Metric / Time range / Polls picks onto the same selector + range state.
  // "1 hour"/"4 hours" live in the sheet's Time range row but are really the
  // Primal quick-window SELECTORS (a different source from the Archives
  // charts), so leaving them clears the metric — remember the last Archives
  // chart and restore it when a longer range brings the user back.
  const lastArchivesSelectorRef = useRef("arc_replies");
  useEffect(() => {
    if (isArchivesSelector(trendingSelector)) lastArchivesSelectorRef.current = trendingSelector;
  }, [trendingSelector]);

  const trendingTime: TrendingTimeValue | null =
    trendingSelector === "trending_1h" ? "1h"
    : trendingSelector === "trending_4h" ? "4h"
    : isArchivesSelector(trendingSelector) ? archivesRange
    : null;

  const handleTrendingMetric = useCallback((v: string) => {
    setTrendingSelector(v);
    const label = TRENDING_SELECTORS.find((s) => s.value === v)?.label ?? v;
    toast({ description: `Trending: ${label}` });
  }, [setTrendingSelector, toast]);

  const handleTrendingTime = useCallback((v: TrendingTimeValue) => {
    if (v === "1h" || v === "4h") {
      setTrendingSelector(v === "1h" ? "trending_1h" : "trending_4h");
    } else {
      if (!isArchivesSelector(trendingSelector)) setTrendingSelector(lastArchivesSelectorRef.current);
      setArchivesRange(v);
    }
    const label = TRENDING_TIME_OPTIONS.find((o) => o.value === v)?.label ?? v;
    toast({ description: `Time range: ${label}` });
  }, [trendingSelector, setTrendingSelector, setArchivesRange, toast]);

  const handlePollSort = useCallback((v: PollSort) => {
    setPollSort(v);
    const label = POLL_SORTS.find((s) => s.value === v)?.label ?? v;
    toast({ description: `Polls: ${label}` });
  }, [setPollSort, toast]);

  const handlePickPolls = useCallback(() => {
    setTrendingSelector("polls");
    toast({ description: "Showing polls" });
  }, [setTrendingSelector, toast]);
  const trendingCacheRef = useRef<Map<string, { posts: Event[]; fetchedAt: number; pollCounts?: Map<string, number> }>>(new Map());
  const trendingPrefetchedRef = useRef(false);
  const followingSubRef = useRef<{ close: () => void } | null>(null);
  const liveSubRef = useRef<{ close: () => void } | null>(null);
  const repostMapRef = useRef<Map<string, { pubkey: string; timestamp: number }>>(new Map());
  const [repostVersion, setRepostVersion] = useState(0);

  const [cutoffTimestamp, setCutoffTimestampState] = useState(() => {
    const saved = _savedCutoffTimestamp;
    if (saved !== null && (Math.floor(Date.now() / 1000) - saved) < 600) return saved;
    return Math.floor(Date.now() / 1000);
  });
  const cutoffTimestampRef = useRef(cutoffTimestamp);
  useEffect(() => { cutoffTimestampRef.current = cutoffTimestamp; _savedCutoffTimestamp = cutoffTimestamp; }, [cutoffTimestamp]);
  const setCutoffTimestamp = useCallback((v: number | ((prev: number) => number)) => {
    setCutoffTimestampState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      _savedCutoffTimestamp = next;
      return next;
    });
  }, []);
  const initialLoadDoneRef = useRef(hasFeedData());
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const bufferedIdsRef = useRef<Set<string>>(new Set());
  const [bufferedVersion, setBufferedVersion] = useState(0);
  const [displayLimit, setDisplayLimitState] = useState(() => {
    try {
      const saved = sessionStorage.getItem("relay-outpost-display-limit");
      if (saved) { const n = parseInt(saved, 10); if (!isNaN(n) && n >= PAGE_SIZE) return n; }
    } catch {}
    return PAGE_SIZE;
  });
  const setDisplayLimit = useCallback((v: number | ((prev: number) => number)) => {
    setDisplayLimitState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try { sessionStorage.setItem("relay-outpost-display-limit", String(next)); } catch {}
      return next;
    });
  }, []);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(() => !hasFeedData());
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  // ---- Feed stability: is the reader at the top of the feed? ----
  // While they are NOT, the rendered list is pinned (see displayedEvents) so
  // nothing can move under them. A pending back-navigation restore means we're
  // about to be scrolled back down — start pinned, don't wait for the listener.
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const restoringOnMountRef = useRef(hasPendingScrollRestore());
  const [isAtTop, setIsAtTop] = useState(() => !restoringOnMountRef.current);
  useEffect(() => {
    // The scroll container can be absent from THIS commit's DOM (app shell
    // still in its reconnecting/overlay state when Home first mounts). The
    // old one-shot querySelector then left isAtTop stuck true forever: the
    // pill could never render and the at-top auto-merge silently swallowed
    // the buffer. Retry on animation frames until the container exists.
    let cancelled = false;
    let raf = 0;
    let attachedEl: HTMLElement | null = null;
    let ticking = false;
    const onScroll = () => {
      if (ticking || !attachedEl) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        // While a back-navigation restore is driving the scroll position, the
        // container can transit through 0 (clamps while virtualized rows are
        // still measuring, correction passes). Flipping isAtTop true on those
        // programmatic blips dropped the pinned snapshot and re-adopted a
        // fresh (possibly still-empty) list mid-restore — the feed collapsed
        // to a skeleton under the restored offset. The reader is NOT at the
        // top during a restore; ignore scroll events until it finishes.
        if (attachedEl && !isRestoreActive()) setIsAtTop(attachedEl.scrollTop <= 80);
      });
    };
    const find = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(".feed-scroll-container");
      if (!el) {
        raf = requestAnimationFrame(find);
        return;
      }
      attachedEl = el;
      scrollContainerRef.current = el;
      el.addEventListener("scroll", onScroll, { passive: true });
      // Sync once at attach — but not during a pending back-navigation
      // restore: isAtTop deliberately starts false then (the container is
      // about to be scrolled back down), and the restore's own scrollTop
      // write fires the listener with the real position.
      if (!restoringOnMountRef.current) setIsAtTop(el.scrollTop <= 80);
    };
    find();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (attachedEl) attachedEl.removeEventListener("scroll", onScroll);
    };
  }, []);

  const [tuneDialogOpen, setTuneDialogOpen] = useState(false);
  const [browsePacksOpen, setBrowsePacksOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<NostrCustomFeed | null>(null);
  const [isSavingFeed, setIsSavingFeed] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharingFeed, setSharingFeed] = useState<NostrCustomFeed | null>(null);
  const [deletingFeed, setDeletingFeed] = useState<NostrCustomFeed | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const followSet = useMemo(() => new Set(follows), [follows]);
  const { fofSet } = useFollowsOfFollows(follows);

  // Accounts-in-reach count shown next to the strictness preset (mirrors the
  // ReachDepthSlider's own calc for the active reach depth).
  const reachAccountCount = useMemo<number | null>(() => {
    if (reachDepth === "off") return null;
    if (reachDepth === "1hop") return followSet.size;
    const fofSize = fofSet ? fofSet.size : 0;
    if (reachDepth === "2hops") return followSet.size + fofSize;
    let extra = 0;
    if (grapeRankScores) {
      grapeRankScores.forEach((score, pk) => {
        if (reachDepth === "global" && score <= 0) return;
        if (followSet.has(pk)) return;
        if (fofSet?.has(pk)) return;
        extra++;
      });
    }
    return followSet.size + fofSize + extra;
  }, [reachDepth, followSet, fofSet, grapeRankScores]);

  const [followerVersion, setFollowerVersion] = useState(0);
  useEffect(() => {
    return onFollowerCountUpdate(() => setFollowerVersion((v) => v + 1));
  }, []);

  const addRepostToMap = useCallback((originalEvent: Event, repostEvent: Event) => {
    eventStore.add(originalEvent);
    const existing = repostMapRef.current.get(originalEvent.id);
    if (!existing || repostEvent.created_at > existing.timestamp) {
      repostMapRef.current.set(originalEvent.id, {
        pubkey: repostEvent.pubkey,
        timestamp: repostEvent.created_at,
      });
      setRepostVersion((v) => v + 1);
    }
  }, []);

  const handleRepostEvent = useCallback((repostEvent: Event) => {
    let parsed = false;
    if (repostEvent.content && repostEvent.content.trim().startsWith("{")) {
      try {
        const originalEvent = JSON.parse(repostEvent.content) as Event;
        if (originalEvent && originalEvent.id && (originalEvent.kind === KIND_TEXT_NOTE || originalEvent.kind === KIND_POLL)) {
          addRepostToMap(originalEvent, repostEvent);
          parsed = true;
        }
      } catch {}
    }
    if (!parsed) {
      const eTag = repostEvent.tags.find((t) => t[0] === "e");
      if (eTag && eTag[1]) {
        const cachedSet = eventStore.getByFilters({ ids: [eTag[1]] });
        const cached = cachedSet ? [...cachedSet].find((e) => e.id === eTag[1]) : undefined;
        if (cached) {
          addRepostToMap(cached, repostEvent);
        } else {
          const fetchSub = throttledPoolSubscribe(FAST_RELAYS, { kinds: feedKinds(), ids: [eTag[1]] }, {
            onevent(original) {
              addRepostToMap(original, repostEvent);
            },
            oneose() { fetchSub.close(); },
          });
        }
      }
    }
  }, [addRepostToMap]);

  const profileGetter = useCallback((pk: string) => {
    try {
      const event = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
      if (!event) return null;
      return JSON.parse(event.content);
    } catch { return null; }
  }, []);

  const { feeds: customFeeds, createFeed, updateFeed, deleteFeed, reorderFeeds } = useNostrFeeds();

  const isCustomMode = feedMode.startsWith("custom_");

  const activeCustomFeed = useMemo(() => {
    if (!isCustomMode) return null;
    const id = feedMode.replace("custom_", "");
    return customFeeds.find((f) => f.id === id) || null;
  }, [feedMode, customFeeds, isCustomMode]);

  // Only the global For You feed is broadened with the Discover relay pool.
  useEffect(() => {
    discoverGlobalRef.current = feedMode === "raw_signal" && !activeCustomFeed;
  }, [feedMode, activeCustomFeed]);

  useEffect(() => {
    if (!isCustomMode) {
      setFeedSortModeState("latest");
      setTopFallbackAll(false);
      setFeedStyle("all");
      return;
    }
    if (activeCustomFeed) {
      try {
        const savedSort = localStorage.getItem(getFeedSortKey(activeCustomFeed.id));
        // Validate against the FULL option list. This used to whitelist only
        // 4 of the 7 modes, so a persisted "oldest" / "most_discussed" /
        // "recently_active" was silently reset to "latest" — not just on
        // reload: this effect re-runs seconds after mount when useNostrFeeds
        // swaps the cached feeds array for the relay-fetched one (new
        // activeCustomFeed identity), actively reverting a just-picked sort.
        if (savedSort && FEED_SORT_OPTIONS.some((o) => o.value === savedSort)) {
          setFeedSortModeState(savedSort as FeedSortMode);
        } else {
          setFeedSortModeState("latest");
        }
        const savedWindow = localStorage.getItem(getTopWindowKey(activeCustomFeed.id));
        if (savedWindow && TOP_TIME_WINDOWS.some((w) => w.value === savedWindow)) {
          setTopTimeWindowState(savedWindow as TopTimeWindow);
        } else {
          setTopTimeWindowState("24h");
        }
      } catch {
        setFeedSortModeState("latest");
        setTopTimeWindowState("24h");
      }
      setTopFallbackAll(false);
    }
  }, [isCustomMode, activeCustomFeed]);

  useEffect(() => {
    // "custom_all" is the macro media feed (network-wide, no custom-feed base) —
    // it intentionally has no matching saved feed, so don't auto-redirect it.
    if (feedMode === "custom_all") return;
    if (isCustomMode && customFeeds.length > 0 && (!activeCustomFeed || feedMode === "custom_empty")) {
      setFeedMode(`custom_${customFeeds[0].id}`);
    } else if (isCustomMode && customFeeds.length === 0 && feedMode !== "custom_empty") {
      setFeedModeState("custom_empty" as FeedMode);
    }
  }, [isCustomMode, customFeeds, activeCustomFeed, feedMode]);

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    setIsInitialLoading(true);
    let cancelled = false;

    /**
     * The cached feed is a FALLBACK for a slow network, not the first paint.
     *
     * It used to paint the moment IndexedDB answered — measured at 3ms against
     * 1431ms for the network on the same load. So Discover reliably showed the
     * previous session's feed, killed the skeleton, and then replaced the whole
     * thing when the real results arrived: reported as "old posts and
     * engagements flashing at first before loading in the proper feed".
     *
     * The authors already wrote the race — `initialLoadDoneRef` below skips the
     * cache when the fresh load got there first. IndexedDB simply always won it,
     * by three orders of magnitude. Giving the network a real head start is what
     * makes that guard do the job it was written for.
     *
     * WHY NOT KEEP THE INSTANT PAINT. You cannot have both. The buffer that
     * normally stops content moving under a reader is deliberately disabled at
     * the top of the feed ("new arrivals auto-merge, so the pill would be
     * noise"), and a cold load is always at the top — so anything painted early
     * WILL be re-sorted when the real results land. For a discovery feed,
     * whose entire claim is "here is what is happening", a stale first paint is
     * a worse trade than a skeleton.
     *
     * A slow or failing network still gets the cache, which is the case it was
     * always genuinely useful for.
     */
    const cacheFallback = setTimeout(() => {
      getCachedFeedEvents("global_feed").then((cached) => {
        if (cancelled || !cached || cached.length === 0) return;
        if (initialLoadDoneRef.current) return;
        for (const e of cached) { eventStore.add(e); }
        initialLoadDoneRef.current = true;
        setCutoffTimestamp(now);
        markFeedDataLoaded();
        setIsInitialLoading(false);
      });
    }, CACHE_FALLBACK_DELAY_MS);

    async function loadFromPrimal() {
      try {
        const result = await fetchGlobalFeed(PAGE_SIZE * 2, now - 6 * 60 * 60, undefined);
        if (cancelled) return false;
        if (result.posts.length > 0) {
          const allPks = new Set<string>();
          for (const e of result.posts) {
            allPks.add(e.pubkey);
            for (const t of e.tags) {
              if (t[0] === "p" && t[1]) allPks.add(t[1]);
            }
          }
          if (!result.statsLoaded) {
            prefetchStatsImmediate(result.posts.map((e) => e.id));
          }
          const profilePks = new Set(result.profiles.map((p) => p.pubkey));
          const missingProfilePks = Array.from(allPks).filter((pk) => !profilePks.has(pk));
          if (missingProfilePks.length > 0) {
            fetchProfilesCached(missingProfilePks);
          }
          if (!initialLoadDoneRef.current) {
            initialLoadDoneRef.current = true;
            setCutoffTimestamp(now);
            markFeedDataLoaded();
          }
          setIsInitialLoading(false);
          cacheFeedEvents("global_feed", result.posts);
          return true;
        }
      } catch (err) {
        console.warn("[Home] Primal feed failed, falling back to relays:", err);
      }
      return false;
    }

    function loadFromRelays() {
      const noteRelays = withDiscoverRelays(getRelaysForPurpose('notes'));
      // Preset-driven initial window: a wider pool over a wider window is what
      // makes For You feel alive without lowering the quality bar.
      const windowH = presetConfigRef.current.timeWindowH;
      const unresolvedReposts: Event[] = [];
      const collectedEventIds: string[] = [];
      const collectedPubkeys: string[] = [];
      const sub = throttledPoolSubscribe(noteRelays, { kinds: withDiscoverKinds([KIND_TEXT_NOTE, KIND_REPOST, KIND_POLL]), limit: PAGE_SIZE * 2, since: now - windowH * 60 * 60 }, {
        onevent(event) {
          if (cancelled) return;
          if (event.kind === KIND_REPOST) {
            let parsed = false;
            if (event.content && event.content.trim().startsWith("{")) {
              try {
                const originalEvent = JSON.parse(event.content) as Event;
                if (originalEvent && originalEvent.id && (originalEvent.kind === KIND_TEXT_NOTE || originalEvent.kind === KIND_POLL)) {
                  addRepostToMap(originalEvent, event);
                  collectedEventIds.push(originalEvent.id);
                  collectedPubkeys.push(originalEvent.pubkey);
                  parsed = true;
                }
              } catch {}
            }
            if (!parsed) {
              const eTag = event.tags.find((t) => t[0] === "e");
              if (eTag && eTag[1]) {
                const cachedSet = eventStore.getByFilters({ ids: [eTag[1]] });
                const cached = cachedSet ? [...cachedSet].find((e) => e.id === eTag[1]) : undefined;
                if (cached) {
                  addRepostToMap(cached, event);
                  collectedEventIds.push(cached.id);
                  collectedPubkeys.push(cached.pubkey);
                } else {
                  unresolvedReposts.push(event);
                }
              }
            }
          } else {
            eventStore.add(event);
            collectedEventIds.push(event.id);
            collectedPubkeys.push(event.pubkey);
            for (const t of event.tags) {
              if (t[0] === "p" && t[1]) collectedPubkeys.push(t[1]);
            }
          }
        },
        oneose() {
          sub.close();
          if (cancelled) return;

          const uniquePubkeys = Array.from(new Set(collectedPubkeys));
          fetchProfilesCached(uniquePubkeys);
          prefetchStatsImmediate(collectedEventIds);

          if (unresolvedReposts.length > 0) {
            const missingIds = unresolvedReposts
              .map((r) => r.tags.find((t) => t[0] === "e")?.[1])
              .filter(Boolean) as string[];
            const uniqueIds = Array.from(new Set(missingIds));
            const resolvedEventIds: string[] = [];
            const resolvedPubkeys: string[] = [];
            const batchSub = throttledPoolSubscribe(FAST_RELAYS, { kinds: feedKinds(), ids: uniqueIds }, {
              onevent(original) {
                const matchingReposts = unresolvedReposts.filter(
                  (r) => r.tags.some((t) => t[0] === "e" && t[1] === original.id)
                );
                for (const rp of matchingReposts) {
                  addRepostToMap(original, rp);
                }
                resolvedEventIds.push(original.id);
                resolvedPubkeys.push(original.pubkey);
              },
              oneose() {
                batchSub.close();
                if (resolvedPubkeys.length > 0) {
                  fetchProfilesCached(resolvedPubkeys);
                }
                if (resolvedEventIds.length > 0) {
                  prefetchStatsImmediate(resolvedEventIds);
                }
              },
            });
          }
          if (!initialLoadDoneRef.current) {
            initialLoadDoneRef.current = true;
            setCutoffTimestamp(now);
            markFeedDataLoaded();
          }
          setIsInitialLoading(false);
        },
      });
      return sub;
    }

    // Media runs ALONGSIDE Primal, not behind it. For You is served by Primal's
    // cached API, and loadFromRelays — which holds every kind, filter and budget
    // decision in this initiative — only executes when Primal FAILS. On a healthy
    // connection it never runs, so all of that work was correct and unreached.
    // Primal's API does not serve kinds 20/21/22, so the only way a picture post
    // reaches For You is a relay subscription that does not wait for a failure.
    //
    // It is additive by construction: it writes to eventStore, and the feed's
    // single read path (allTextNotesObs) already unions everything in the store.
    // If it returns nothing, the feed is exactly what it is today.
    const mediaPubkeys: string[] = [];
    const mediaSub = throttledPoolSubscribe(
      withDiscoverRelays(getRelaysForPurpose('notes')),
      {
        kinds: [...MEDIA_EVENT_KINDS],
        limit: mediaPageLimit(PAGE_SIZE * 2),
        since: now - presetConfigRef.current.timeWindowH * 60 * 60,
      },
      {
        onevent(event) {
          if (cancelled) return;
          eventStore.add(event);
          mediaPubkeys.push(event.pubkey);
          // Nudge the merge. The store HAS these events (getByFilters finds
          // them); applesauce's timeline simply never yields them, so nothing
          // else would tell the feed they exist.
          setMediaTick((t) => t + 1);
        },
        oneose() {
          // WITHOUT THIS THE WHOLE SUBSCRIPTION IS POINTLESS. The feed's
          // profile floor HOLDS any post whose author's kind-0 has not resolved
          // — deliberately, so raw-npub spam never flashes on first paint. The
          // main subscription prefetches profiles at its own EOSE; this one did
          // not, so every media author sat permanently "unknown" and every
          // media post was held out of the feed forever. Events arrived, were
          // stored, were merged, and were still never shown.
          if (!cancelled && mediaPubkeys.length > 0) {
            fetchProfilesCached(Array.from(new Set(mediaPubkeys)));
          }
          mediaSub.close();
        },
      },
    );

    // ---- Relay supplement: the feed stops being one provider's feed ----
    // BOTH feed modes are Primal-backed (fetchTrendingFeed and fetchGlobalFeed
    // are both primal-cache), and the relay path only ran when Primal FAILED,
    // which on a healthy connection is never. So the app's content was, in
    // practice, Primal's content.
    //
    // This runs unconditionally beside it. FOLLOWS FIRST, because the strongest
    // thing a relay supplement adds is not breadth — it is the quiet posts of
    // people you explicitly chose, which a popularity ranking structurally
    // cannot surface. Someone with forty followers never trends, so you never
    // hear them, even though you asked to. A global sample only tops up what
    // follows could not fill, so the supplement is never mostly strangers when
    // it does not have to be.
    const supplementPubkeys: string[] = [];
    const myFollows = followsRef.current ?? [];
    const supplementSubs: ReturnType<typeof throttledPoolSubscribe>[] = [];
    const supplementSince = now - presetConfigRef.current.timeWindowH * 60 * 60;
    const takeSupplement = (event: Event) => {
      if (cancelled) return;
      // Top-level posts only. A global relay sample is mostly REPLIES, and the
      // feed's default content lens shows Posts — so an unfiltered supplement
      // spends its whole budget on events that are then dropped downstream,
      // which is exactly what the first live run did: 12 relay posts picked,
      // zero rendered. A reply also arrives here without its parent, so it
      // would read as a fragment even if the lens let it through.
      if (event.tags.some((t) => t[0] === "e" || t[0] === "E")) return;
      // Machine payloads never enter the pool at all. A service publishing a
      // JSON heartbeat (zone_presence + CPU metrics, ttl 120, every 2 minutes)
      // is a kind-1 to a relay and "newest" to splitSupplement — which is a
      // standing top-of-Trending slot unless it dies here at intake.
      if (isMachineReadableContent(event.content)) return;
      eventStore.add(event);
      supplementRef.current.push(event);
      supplementPubkeys.push(event.pubkey);
      setSupplementTick((t) => t + 1);
    };
    const finishSupplement = () => {
      if (!cancelled && supplementPubkeys.length > 0) {
        // Same trap the media subscription fell into: the feed's profile floor
        // HOLDS any post whose author's kind-0 has not resolved, so a supplement
        // that does not prefetch profiles is a supplement nobody ever sees.
        fetchProfilesCached(Array.from(new Set(supplementPubkeys)));
      }
    };
    if (myFollows.length > 0) {
      const followSub = throttledPoolSubscribe(
        withDiscoverRelays(getRelaysForPurpose('notes')),
        { kinds: [KIND_TEXT_NOTE], authors: myFollows.slice(0, 200), limit: PAGE_SIZE, since: supplementSince },
        { onevent: takeSupplement, oneose() { finishSupplement(); followSub.close(); } },
      );
      supplementSubs.push(followSub);
    }
    const globalSub = throttledPoolSubscribe(
      withDiscoverRelays(getRelaysForPurpose('notes')),
      { kinds: [KIND_TEXT_NOTE], limit: PAGE_SIZE, since: supplementSince },
      { onevent: takeSupplement, oneose() { finishSupplement(); globalSub.close(); } },
    );
    supplementSubs.push(globalSub);

    let relaySub: ReturnType<typeof throttledPoolSubscribe> | null = null;
    loadFromPrimal().then((success) => {
      if (!cancelled && !success) {
        relaySub = loadFromRelays();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(cacheFallback);
      try { mediaSub.close(); } catch {}
      for (const sub of supplementSubs) { try { sub.close(); } catch {} }
      if (relaySub) relaySub.close();
    };
    // discoverEpoch: re-fetch with the new relay pool when Discover prefs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverEpoch]);

  useEffect(() => {
    if (liveSubRef.current) {
      liveSubRef.current.close();
      liveSubRef.current = null;
    }

    const liveSub = subscribeToFeedPersistent(
      { kinds: withDiscoverKinds([KIND_TEXT_NOTE, KIND_REPOST, KIND_POLL, ...MEDIA_EVENT_KINDS]), since: Math.floor(Date.now() / 1000) },
      // Live tail: preset-driven cap (was a fixed 6) so breadth scales with the dial.
      withDiscoverRelays(FAST_RELAYS.slice(0, 4)),
      (event) => {
        if (event.kind === KIND_REPOST) {
          handleRepostEvent(event);
        }
        if (event.kind === KIND_TEXT_NOTE) {
          const parentId = getReplyParentId(event);
          if (parentId) {
            updateLastReplyTimestamp(parentId, event.created_at);
          }
        }
      },
    );
    liveSubRef.current = liveSub;

    return () => {
      if (liveSubRef.current) {
        liveSubRef.current.close();
        liveSubRef.current = null;
      }
    };
    // discoverEpoch: re-subscribe with the new relay pool when prefs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverEpoch]);

  useEffect(() => {
    const handleLocalRepost = ((e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.repostEvent) {
        handleRepostEvent(detail.repostEvent);
      }
    }) as EventListener;
    const handleLocalUnrepost = ((e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.originalEventId && detail?.reposterPubkey) {
        const existing = repostMapRef.current.get(detail.originalEventId);
        if (existing && existing.pubkey === detail.reposterPubkey) {
          repostMapRef.current.delete(detail.originalEventId);
          setRepostVersion((v) => v + 1);
        }
      }
    }) as EventListener;
    window.addEventListener("nostr-repost-created", handleLocalRepost);
    window.addEventListener("nostr-repost-removed", handleLocalUnrepost);
    return () => {
      window.removeEventListener("nostr-repost-created", handleLocalRepost);
      window.removeEventListener("nostr-repost-removed", handleLocalUnrepost);
    };
  }, [handleRepostEvent]);

  useEffect(() => {
    if (follows.length > 0) {
      fetchRelayLists(follows);
    }
  }, [follows]);

  const optimalRelaysRef = useRef<string[] | null>(null);

  const followsPrimalFetchedRef = useRef(false);

  const hasFollows = follows.length > 0;

  useEffect(() => {
    if (hasFollows && pubkey && !followsPrimalFetchedRef.current) {
      followsPrimalFetchedRef.current = true;
      const now = Math.floor(Date.now() / 1000);
      // Warm-start: paint the Following feed from the per-feed IndexedDB cache
      // before the network round-trip, mirroring the global feed (line ~549) and
      // custom feeds (line ~833). eventStore dedupes by id, so the seeded events
      // are harmless once fresh ones arrive.
      getCachedFeedEvents("following_feed").then((cached) => {
        if (!cached || cached.length === 0) return;
        for (const e of cached) { try { eventStore.add(e); } catch {} }
      });
      fetchFollowsFeed(pubkey, PAGE_SIZE, now - 24 * 60 * 60).then((result) => {
        if (result.posts.length > 0) {
          const pks = new Set<string>();
          for (const e of result.posts) {
            pks.add(e.pubkey);
            for (const t of e.tags) {
              if (t[0] === "p" && t[1]) pks.add(t[1]);
            }
          }
          fetchProfilesCached(Array.from(pks));
          prefetchStatsImmediate(result.posts.map((e) => e.id));
          // Write fresh results back so the next visit warm-starts.
          cacheFeedEvents("following_feed", result.posts);
        }
      }).catch(() => {});
    }
  }, [hasFollows, pubkey]);

  useEffect(() => {
    if (follows.length > 0) {
      if (followingSubRef.current) {
        followingSubRef.current.close();
      }
      const now = Math.floor(Date.now() / 1000);
      const batch = follows.slice(0, 200);
      const relays = getOptimalRelaysForFeed(batch);
      optimalRelaysRef.current = relays;
      followingSubRef.current = subscribeToFeed({
        kinds: feedKinds(),
        authors: batch,
        limit: PAGE_SIZE,
        since: now - 24 * 60 * 60,
      }, relays);
    }

    return () => {
      if (followingSubRef.current) {
        followingSubRef.current.close();
        followingSubRef.current = null;
      }
    };
  }, [follows]);

  // NOTE: We previously pre-warmed a relay subscription for *every* custom
  // feed on mount so switching feeds was instant. That fan-out was the
  // single biggest source of "too many concurrent REQs" on relays like
  // nos.lol — a user with N custom feeds opened N parallel filtered subs
  // in addition to the always-on live sub and the active-feed sub.
  //
  // We now subscribe only to the *active* feed (below). To preserve the
  // perceived snappiness of switching feeds, the active-feed effect seeds
  // the event store from a per-feed IndexedDB cache before opening the
  // network sub, and writes new results back to the cache on EOSE.

  useEffect(() => {
    if (!activeCustomFeed) return;
    if (activeCustomFeed.hashtags.length === 0 && activeCustomFeed.authorPubkeys.length === 0) return;

    let cancelled = false;
    const feedKey = `custom_feed:${activeCustomFeed.id}`;

    // Seed the event store from cache for instant render on feed-switch.
    // This runs in parallel with the network sub below; eventStore
    // dedupes by id so overlapping events are harmless.
    getCachedFeedEvents(feedKey).then((cached) => {
      if (cancelled || !cached || cached.length === 0) return;
      for (const e of cached) {
        try { eventStore.add(e); } catch {}
      }
      // Cached content is enough to drop the loading state — the live
      // sub will append fresher events as they arrive.
      setIsInitialLoading(false);
    });

    const now = Math.floor(Date.now() / 1000);
    // Combine authors and #t into a single NIP-01 filter so the relay ANDs
    // them together. Splitting them across two filters (or two subscriptions)
    // would OR them and let the firehose stream in unrelated hashtag matches
    // — which is exactly how onboarding starter feeds previously surfaced
    // porn tagged with #music.
    const filter: Record<string, any> = {
      kinds: feedKinds(),
      limit: PAGE_SIZE * 2,
      since: now - 24 * 60 * 60,
    };
    if (activeCustomFeed.hashtags.length > 0) {
      filter["#t"] = activeCustomFeed.hashtags;
    }
    if (activeCustomFeed.authorPubkeys.length > 0) {
      filter.authors = activeCustomFeed.authorPubkeys.slice(0, 200);
    }
    const sub = subscribeToFeed(filter, FAST_RELAYS, () => {
      if (cancelled) return;
      setIsInitialLoading(false);
      // Cache what we just streamed in so the next visit to this feed
      // renders instantly without waiting for relays.
      try {
        const events = Array.from(eventStore.getByFilters(filter) || []);
        if (events.length > 0) {
          // Sort newest-first and cap so the cache stays small.
          events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          cacheFeedEvents(feedKey, events.slice(0, 100));
        }
      } catch {}
    });

    return () => {
      cancelled = true;
      sub.close();
    };
  }, [activeCustomFeed]);

  useEffect(() => {
    if (!TIME_WINDOW_SORT_MODES.includes(feedSortMode) || !activeCustomFeed) {
      setTopWindowLoading(false);
      return;
    }
    const windowDef = TOP_TIME_WINDOWS.find(w => w.value === topTimeWindow);
    if (!windowDef) return;

    const feedKey = activeCustomFeed.id;
    if (!fetchedWindowsRef.current.has(feedKey)) {
      fetchedWindowsRef.current.set(feedKey, new Set(["1h"]));
    }
    const fetched = fetchedWindowsRef.current.get(feedKey)!;

    const windowOrder: TopTimeWindow[] = ["1h", "6h", "24h", "7d"];
    const targetIdx = windowOrder.indexOf(topTimeWindow);
    const alreadyCoveredIdx = Math.max(...windowOrder.map((w, i) => fetched.has(w) ? i : -1));
    if (targetIdx <= alreadyCoveredIdx) return;

    const now = Math.floor(Date.now() / 1000);
    const since = now - windowDef.seconds;
    const hasHashtags = activeCustomFeed.hashtags.length > 0;
    const hasAuthors = activeCustomFeed.authorPubkeys.length > 0;
    if (!hasHashtags && !hasAuthors) return;

    let cancelled = false;
    setTopWindowLoading(true);
    const filter: Record<string, any> = {
      kinds: feedKinds(),
      limit: PAGE_SIZE * 3,
      since,
    };
    // Combine both fields when present so the relay ANDs them — see the live
    // subscription above for why splitting them is unsafe for new users.
    if (hasHashtags) {
      filter["#t"] = activeCustomFeed.hashtags;
    }
    if (hasAuthors) {
      filter.authors = activeCustomFeed.authorPubkeys.slice(0, 200);
    }

    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        fetched.add(topTimeWindow);
        setTopWindowLoading(false);
      }
    }, 15000);

    const sub = subscribeToFeed(filter, FAST_RELAYS, () => {
      if (!cancelled) {
        clearTimeout(safetyTimeout);
        fetched.add(topTimeWindow);
        setTopWindowLoading(false);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
      sub.close();
      setTopWindowLoading(false);
    };
  }, [feedSortMode, topTimeWindow, activeCustomFeed]);

  const loadTrending = useCallback(async (selector: string, options?: { force?: boolean; background?: boolean }) => {
    const cacheKey = isArchivesSelector(selector) ? `${selector}_${archivesRange}` : selector;
    const cached = trendingCacheRef.current.get(cacheKey);
    const now = Date.now();
    const isStale = !cached || (now - cached.fetchedAt > TRENDING_CACHE_TTL);

    if (cached && !options?.force) {
      setTrendingPosts(cached.posts);
      if (cached.pollCounts) setPollResponseCounts(cached.pollCounts);
      if (!isStale) return;
    }

    if (!options?.background || !cached) {
      setTrendingLoading(true);
    }

    try {
      let posts: Event[];
      let pollCounts: Map<string, number> | undefined;

      const metric = getArchivesMetric(selector);
      if (metric) {
        const result = await fetchTopNotes({ metric, range: archivesRange, limit: 60 });
        const nowTs = Math.floor(Date.now() / 1000);
        posts = result.notes
          .filter(n => n.event && n.event.created_at <= nowTs)
          .map(n => ({
            id: n.event.id,
            pubkey: n.event.pubkey,
            kind: n.event.kind,
            content: n.event.content,
            tags: n.event.tags,
            created_at: n.event.created_at,
            sig: n.event.sig || "",
          } as Event));
        if (posts.length > 0) {
          await prefetchStatsImmediate(posts.map(p => p.id));
        }
      } else if (selector === "polls") {
        const result = await fetchPollsFeed();
        posts = result.polls;
        pollCounts = result.responseCounts;
      } else {
        posts = await fetchTrendingFeed(selector, pubkey || undefined, 40);
      }

      trendingCacheRef.current.set(cacheKey, { posts, fetchedAt: Date.now(), pollCounts });
      setTrendingPosts(posts);
      if (pollCounts) setPollResponseCounts(pollCounts);
    } catch (err) {
      console.error("Failed to fetch trending:", err);
    } finally {
      setTrendingLoading(false);
    }
  }, [pubkey, archivesRange]);

  useEffect(() => {
    if (!trendingPrefetchedRef.current) {
      trendingPrefetchedRef.current = true;
      loadTrending("arc_reactions", { background: true });
    }
  }, [loadTrending]);

  useEffect(() => {
    if (feedMode === "deep_scan") {
      const cacheKey = isArchivesSelector(trendingSelector) ? `${trendingSelector}_${archivesRange}` : trendingSelector;
      const cached = trendingCacheRef.current.get(cacheKey);
      if (cached) {
        setTrendingPosts(cached.posts);
        if (cached.pollCounts) setPollResponseCounts(cached.pollCounts);
        const isStale = Date.now() - cached.fetchedAt > TRENDING_CACHE_TTL;
        if (isStale) {
          loadTrending(trendingSelector, { background: true });
        }
      } else {
        loadTrending(trendingSelector);
      }
    }
  }, [feedMode, trendingSelector, archivesRange, loadTrending]);

  // Throttled mirror of the eventStore timeline. Subscribing reactively (use$)
  // re-derived the whole feed pipeline (filter → sort → render) on EVERY incoming
  // event (5–20/sec on a live feed), stuttering the scroll. We keep eventStore
  // ingesting at full speed but only push a new array into React state on a
  // trailing ~400ms timer (≤~2.5Hz). The first emit flushes immediately so cold
  // start stays instant; the cutoff/buffer logic still gates what's shown.
  // THE READ SIDE, and the one that actually decides what you see. The
  // subscription can ask relays for every kind in the world; if this query does
  // not name a kind, those events land in the store and are never looked at
  // again. Media kinds were fetched, stored, and ignored right here — a
  // diagnostic proved ZERO of them ever reached the feed filter, which is what
  // pointed at the read rather than at any of the gates downstream.
  const allTextNotesObs = useMemo(
    () => eventStore.timeline({
      kinds: discoverV2
        ? [KIND_TEXT_NOTE, KIND_POLL, KIND_LONG_FORM, ...MEDIA_EVENT_KINDS]
        : [KIND_TEXT_NOTE, KIND_POLL, ...MEDIA_EVENT_KINDS],
    }),
    [discoverV2],
  );
  const [allTextNotes, setAllTextNotes] = useState<Event[]>(() => {
    let initial: Event[] = [];
    const probe = allTextNotesObs.subscribe((e: Event[]) => { initial = e; });
    probe.unsubscribe();
    return initial;
  });
  useEffect(() => {
    let first = true;
    let latest: Event[] | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // First-seen ledger (account-age.ts): record earliest-evidence timestamps
    // at this existing chokepoint — a capped Map min-update per event, ≤~2.5Hz.
    const flush = () => { timer = null; if (latest) { recordEventsFirstSeen(latest); setAllTextNotes(latest); latest = null; } };
    const sub = allTextNotesObs.subscribe((events: Event[]) => {
      latest = events;
      if (first) { first = false; recordEventsFirstSeen(events); setAllTextNotes(events); latest = null; return; }
      if (!timer) timer = setTimeout(flush, 400);
    });
    return () => { sub.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [allTextNotesObs]);

  // ---- Media events: fetched separately, merged here ----
  // applesauce's eventStore.timeline() does not emit kinds 20/21/22 even when
  // the query names them, while getByFilters with the same kinds finds them.
  // Measured: 28 media events arrived, 28 round-tripped out of the store by id,
  // 24 were queryable by kind, ZERO reached the feed filter. So the timeline is
  // read for text and the store is read directly for media.
  const [mediaTick, setMediaTick] = useState(0);
  const [mediaNotes, setMediaNotes] = useState<Event[]>([]);
  // Relay-sourced text, held directly rather than read back from the store —
  // the store cannot tell a relay's kind-1 from Primal's, and counting Primal's
  // own posts as "independent supply" would defeat the point of the exercise.
  const supplementRef = useRef<Event[]>([]);
  const [supplementTick, setSupplementTick] = useState(0);
  const [supplementNotes, setSupplementNotes] = useState<Event[]>([]);
  useEffect(() => {
    if (supplementTick === 0) return;
    const timer = setTimeout(() => {
      const seen = new Set<string>();
      const deduped = supplementRef.current.filter((e) => {
        if (!e?.id || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      setSupplementNotes(deduped);
    }, 400);
    return () => clearTimeout(timer);
  }, [supplementTick]);
  useEffect(() => {
    if (mediaTick === 0) return;
    // Coalesced: a burst of arrivals costs one store read, not one per event.
    const timer = setTimeout(() => {
      try {
        const found = eventStore.getByFilters({ kinds: [...MEDIA_EVENT_KINDS] });
        setMediaNotes(found ? Array.from(found) : []);
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [mediaTick]);

  // ---- Global-feed profile floor support ----
  // The spam filter's hideNoProfile now fails CLOSED on "profile not fetched
  // yet" (see filterSpamEvents), so the For You feed never first-paints
  // raw-npub bot spam that used to flash and then vanish. Two obligations
  // fall out of that:
  //  1. A kind-0 arriving must be able to UN-hide its author's posts even when
  //     no new feed event flushes allTextNotes — otherwise legit authors whose
  //     profiles land after the last flush would stay hidden until the next
  //     one. profileVersion (debounced, global feed only) re-runs the filter.
  //  2. Hidden-unknown authors must actually get their profiles requested.
  //     The relay page prefetches at EOSE and Primal ships profiles inline,
  //     but the IDB-cached feed replay and the live stream add events with no
  //     profile fetch attached — prefetch the candidate window explicitly
  //     (fetchProfilesCached dedupes already-requested pubkeys).
  const isGlobalForYou = feedMode === "raw_signal" && !activeCustomFeed;
  // Trending gates its SUPPLEMENT through the same profile floor (see
  // tierFilteredTrending), so its held-in-grace authors need the same kind-0
  // re-run — without it a legit supplement author whose profile lands after
  // the memo runs stays held until the next unrelated recompute.
  const needsProfileReruns = isGlobalForYou || feedMode === "deep_scan";
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => {
    if (!needsProfileReruns) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = eventStore.insert$.subscribe((e: Event) => {
      if (e.kind !== 0 || timer) return; // trailing debounce: batches land in bursts
      timer = setTimeout(() => { timer = null; setProfileVersion((v) => v + 1); }, 300);
    });
    return () => { sub.unsubscribe(); if (timer) clearTimeout(timer); };
  }, [needsProfileReruns]);
  useEffect(() => {
    if (!isGlobalForYou || allTextNotes.length === 0) return;
    const pks = Array.from(new Set(allTextNotes.slice(0, 300).map((e) => e.pubkey)));
    fetchProfilesCached(pks);
  }, [isGlobalForYou, allTextNotes]);
  // Bounded loader grace: on a cold start every candidate can be
  // profile-unknown for a beat, which would flash the "no posts" empty state
  // between EOSE and the first profile batch. Hold the loader while the floor
  // resolves, but never past this cap (so an all-spam window can't spin
  // forever — the empty state's retry affordances take over).
  const [profileFloorGraceOver, setProfileFloorGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setProfileFloorGraceOver(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const mediaTestCacheRef = useRef<Map<string, boolean>>(new Map());
  const hasMediaUrl = useCallback((eventId: string, content: string): boolean => {
    const cached = mediaTestCacheRef.current.get(eventId);
    if (cached !== undefined) return cached;
    const result = /https?:\/\/\S+\.(jpg|jpeg|png|gif|webp|mp4|mov|webm|avi)/i.test(content);
    mediaTestCacheRef.current.set(eventId, result);
    if (mediaTestCacheRef.current.size > 5000) {
      const entries = Array.from(mediaTestCacheRef.current.entries());
      mediaTestCacheRef.current = new Map(entries.slice(-3000));
    }
    return result;
  }, []);

  const baseFilteredEvents = useMemo(() => {
    if (feedMode === "deep_scan") return [];
    let filtered = mergeSupplementIntoFeed(
      allTextNotes ?? [],
      splitSupplement(allTextNotes ?? [], mediaNotes, supplementNotes),
    );

    if (feedMode === "open_comms" && follows.length > 0) {
      filtered = filtered.filter((e) => {
        if (followSet.has(e.pubkey) || e.pubkey === pubkey) return true;
        const repostInfo = repostMapRef.current.get(e.id);
        if (repostInfo && (followSet.has(repostInfo.pubkey) || repostInfo.pubkey === pubkey)) return true;
        return false;
      });
    }

    // Posts / Replies / All content lens — applies to For You, Following (and,
    // via the trending path, Trending). A repost is never a reply, so it stays
    // visible under "posts" and is excluded under "replies".
    if ((feedMode === "raw_signal" || feedMode === "open_comms") && contentFilter !== "all") {
      filtered = filtered.filter((e) => {
        const repostInfo = repostMapRef.current.get(e.id);
        if (repostInfo) return contentFilter === "posts";
        return isReplyEvent(e.tags) ? contentFilter === "replies" : contentFilter === "posts";
      });
    }

    if (activeCustomFeed) {
      if (activeCustomFeed.authorPubkeys.length > 0) {
        const authorSet = new Set(activeCustomFeed.authorPubkeys);
        filtered = filtered.filter((e) => authorSet.has(e.pubkey));
      }
      if (activeCustomFeed.hashtags.length > 0) {
        const tagSet = new Set(activeCustomFeed.hashtags.map((t) => t.toLowerCase()));
        filtered = filtered.filter((e) =>
          e.tags.some((t) => t[0] === "t" && tagSet.has(t[1]?.toLowerCase()))
        );
      }
      if (activeCustomFeed.includeKeywords.length > 0) {
        const keywords = activeCustomFeed.includeKeywords.map((k) => k.toLowerCase());
        filtered = filtered.filter((e) => {
          const content = e.content.toLowerCase();
          return keywords.some((k) => content.includes(k));
        });
      }
      if (activeCustomFeed.excludeKeywords.length > 0) {
        const keywords = activeCustomFeed.excludeKeywords.map((k) => k.toLowerCase());
        filtered = filtered.filter((e) => {
          const content = e.content.toLowerCase();
          return !keywords.some((k) => content.includes(k));
        });
      }
      if (activeCustomFeed.contentType === "text_only") {
        filtered = filtered.filter((e) => !hasMediaUrl(e.id, e.content));
      } else if (activeCustomFeed.contentType === "media") {
        filtered = filtered.filter((e) => hasMediaUrl(e.id, e.content));
      } else if (activeCustomFeed.contentType === "links") {
        filtered = filtered.filter((e) =>
          /https?:\/\/\S+/i.test(e.content)
        );
      }
    }

    // Per-custom-feed "Feed style" chips — narrow to photos or video. The macro
    // Images/Videos feed (custom_all) renders the real ImagesFeed/VideoFeed
    // components instead, so it doesn't use this kind-1 URL filter.
    if (isCustomMode && feedMode !== "custom_all" && feedStyle !== "all") {
      const styleRe = feedStyle === "photos"
        ? /https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)/i
        : /https?:\/\/\S+\.(mp4|mov|webm|avi)/i;
      filtered = filtered.filter((e) => styleRe.test(e.content));
    }

    const isGlobalFeed = feedMode === "raw_signal" && !activeCustomFeed;

    const discoverFloor = discoverV2 && isGlobalFeed;
    filtered = spamFilter(filtered, {
      follows: followSet,
      followsOfFollows: fofSet,
      reachDepth: "off",
      allEvents: filtered,
      hideMachineReadable: isGlobalFeed,
      hideNoProfile: isGlobalFeed,
      profileGetter: isGlobalFeed ? profileGetter : undefined,
      // Three-state profile gate: settled-with-no-kind-0 authors are resolved
      // profile-less spam (drop); not-yet-settled authors are held in grace
      // and re-admitted by the profileVersion re-run when their kind-0 lands.
      profileSettledGetter: isGlobalFeed ? isProfileFetchSettled : undefined,
      minFollowers: isGlobalFeed ? MIN_FOLLOWERS_GLOBAL : 0,
      followerCountGetter: isGlobalFeed ? getCachedFollowerCount : undefined,
      // For You anti-spam floor: cross-author wave dedupe + new-account combo
      // gate (no score AND <48h old AND <20 followers → drop; any one earned
      // signal — a follow, a score, or 48 hours — restores distribution).
      // Global feed only; followed authors are exempt inside the filter.
      crossAuthorDedupe: isGlobalFeed,
      newAccountComboGate: isGlobalFeed,
      scoreGetter: isGlobalFeed ? (pk: string) => grapeRankScores?.get(pk) : undefined,
      firstSeenGetter: isGlobalFeed ? getFirstSeen : undefined,
      // Real engagement is an earned signal AND (per the combo seam) lets the
      // gate safely drop undatable zero-signal strangers in the broadened pool.
      engagementScoreGetter: isGlobalFeed
        ? (e: Event) => computeEngagementScore(primalStatsCache.get(e.id) ?? null)
        : undefined,
      // Discover safe floor (flag-gated): readable-kinds + your-languages + hide-flagged.
      ...(discoverFloor ? {
        readableKinds: DISCOVER_READABLE_KINDS,
        languageAllowed: (e: Event) => langAllowed(e.content, preferredLangs),
        flaggedPubkeys: flaggedPubkeys ?? undefined,
      } : {}),
    });

    const seen = new Set<string>();
    let deduped = Array.from(filtered).filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    // Preset-scaled stranger-quality floor (global For You only): an
    // out-of-network post is admitted only when it shows a real signal —
    // engagement at/above the preset floor, positive WoT, an established
    // first-seen age, or enough followers. In-network authors (followed, self,
    // or reposted by a follow) are exempt. This is what keeps the broadened
    // pool alive without letting cold posts from brand-new unknown strangers in.
    if (isGlobalFeed && discoverV2) {
      const cfg = getDiscoverPresetConfig(activePreset);
      const nowS = Math.floor(Date.now() / 1000);
      deduped = deduped.filter((e) => {
        const reposter = repostMapRef.current.get(e.id);
        const isInNetwork =
          followSet.has(e.pubkey) ||
          e.pubkey === pubkey ||
          (!!reposter && (followSet.has(reposter.pubkey) || reposter.pubkey === pubkey));
        return admitStranger({
          isInNetwork,
          wotScore: grapeRankScores?.get(e.pubkey),
          engagementScore: computeEngagementScore(primalStatsCache.get(e.id) ?? null),
          // NIP-13 PoW is derived from the event id/tags we already hold — no
          // network. It only ever ADMITS a stranger the other axes would drop.
          powDifficulty: effectivePow(e),
          firstSeen: getFirstSeen(e.pubkey),
          followerCount: getCachedFollowerCount(e.pubkey),
          nowSeconds: nowS,
          config: cfg,
        });
      });
    }

    return deduped;
    // followerVersion intentionally omitted: the throttled allTextNotes flush
    // re-runs this filter and re-reads the latest cached follower counts, so we
    // don't force a full recompute on every follower-count update.
    // profileVersion IS included: the profile floor hides unknown authors, so
    // kind-0 arrivals must re-run the filter to surface them (see above).
  }, [feedMode, follows, allTextNotes, mediaNotes, supplementNotes, spamFilter, followSet, activeCustomFeed, profileGetter, pubkey, contentFilter, hasMediaUrl, grapeRankScores, wotEnabled, isCustomMode, feedStyle, discoverV2, preferredLangs, flaggedPubkeys, fofSet, profileVersion, activePreset]);

  // ---- Custom-feed engagement sorts: make primalStatsCache reactive ----
  // The engagement sorts below (Hot / Top Signal / Most Discussed / Most
  // Zapped / Recently Active) rank events by primalStatsCache — a plain
  // non-reactive Map. Two holes made the sort dropdown look dead:
  //  1. Custom-feed events arrive from raw relay subs with NO stats attached
  //     (unlike the Primal-sourced For You/Following feeds); stats were only
  //     ever prefetched for the ~30 currently *displayed* events, so ranking
  //     the full candidate set compared mostly-missing scores (all 0/-1 →
  //     stable sort → order stayed newest-first, i.e. identical to Latest).
  //  2. When stats DID land moments later, nothing in sortedFiltered's deps
  //     changed, so the memo never re-sorted with the real numbers.
  // While a stats-based sort is active we (a) prefetch stats for the whole
  // candidate window and (b) bump statsVersion (debounced) on stats arrival
  // so the memo re-ranks.
  const statsSortActive = isCustomMode &&
    (TIME_WINDOW_SORT_MODES.includes(feedSortMode) || feedSortMode === "recently_active");
  const [statsVersion, setStatsVersion] = useState(0);
  useEffect(() => {
    if (!statsSortActive) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = primalStatsCache.subscribeAny(() => {
      if (timer) return; // trailing debounce: one re-sort per ~300ms burst
      timer = setTimeout(() => { timer = null; setStatsVersion((v) => v + 1); }, 300);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [statsSortActive]);
  useEffect(() => {
    if (!statsSortActive) return;
    // Newest-first already; cap the fetch so a huge backlog doesn't burst
    // Primal (prefetchStatsImmediate dedupes ids it has already fetched).
    const ids = baseFilteredEvents.slice(0, 300).map((e) => e.id);
    if (ids.length === 0) return;
    const t = setTimeout(() => { prefetchStatsImmediate(ids); }, 150);
    return () => clearTimeout(t);
  }, [statsSortActive, baseFilteredEvents, feedSortMode, topTimeWindow]);

  const sortedFiltered = useMemo(() => {
    if (feedMode === "deep_scan") return [];
    let deduped = baseFilteredEvents;

    if (feedMode === "raw_signal" && pubkey && effectiveReachDepth !== "off") {
      deduped = deduped.filter((e) => {
        if (followSet.has(e.pubkey)) return true;
        if (effectiveReachDepth === "1hop") return false;
        if (fofSet.has(e.pubkey)) return true;
        if (effectiveReachDepth === "2hops") return false;
        const score = grapeRankScores?.get(e.pubkey);
        if (effectiveReachDepth === "3hops") return score !== undefined;
        return score !== undefined && score > 0;
      });
    }

    // Discover v2 "interesting mix" (flag-gated, For You only): engagement +
    // recency + network proximity, with author diversity. "Latest" bypasses it.
    // Takes precedence over the custom-feed ranking settings for this feed.
    if (discoverV2 && (feedMode === "raw_signal" || feedMode === "open_comms") && !activeCustomFeed && discoverSort === "mix") {
      topFallbackRef.current = false;
      const nowSec = Math.floor(Date.now() / 1000);
      return rankDiscoverFeed(deduped, {
        now: nowSec,
        getEngagement: (id) => {
          const s = primalStatsCache.get(id);
          return s ? computeEngagementScore(s) : 0;
        },
        getProximity: pubkey
          ? (pk) => (followSet.has(pk) ? 1 : fofSet.has(pk) ? 0.5 : (grapeRankScores?.get(pk) ?? 0) > 0 ? 0.25 : 0)
          : undefined,
        diversityWindow: 3,
        // Burst cap (For You only): a single unfollowed author gets at most 3
        // posts in the ranked window — overflow dropped, not just spaced out.
        maxPerAuthor: 3,
        capExempt: (pk) => followSet.has(pk),
      });
    }

    // Feed ranking disabled (App Settings) → pure newest-first, ignore all
    // algorithmic sort modes. Reach/trust filtering above still applies.
    if (!rankingEnabled) {
      topFallbackRef.current = false;
      return [...deduped].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    if (isCustomMode && feedSortMode === "recently_active") {
      topFallbackRef.current = false;
      return [...deduped].sort((a, b) => {
        const aActivity = Math.max(getLastReplyTimestamp(a.id), a.created_at);
        const bActivity = Math.max(getLastReplyTimestamp(b.id), b.created_at);
        return bActivity - aActivity;
      });
    }

    if (isCustomMode && feedSortMode !== "latest" && feedSortMode !== "oldest") {
      let sortable = [...deduped];
      let fellBackToAll = false;

      if (TIME_WINDOW_SORT_MODES.includes(feedSortMode)) {
        const windowDef = TOP_TIME_WINDOWS.find(w => w.value === topTimeWindow);
        if (windowDef) {
          const cutoff = Math.floor(Date.now() / 1000) - windowDef.seconds;
          const inWindow = sortable.filter(e => e.created_at >= cutoff);
          if (inWindow.length > 0) {
            sortable = inWindow;
          } else {
            fellBackToAll = true;
          }
        }
      }

      const getScore = (eventId: string) => {
        const s = primalStatsCache.get(eventId);
        return s ? computeEngagementScore(s) : 0;
      };
      const hotnessOf = (e: Event) => {
        const score = getScore(e.id);
        if (score < 2) return -1;
        const age = Math.max((Date.now() / 1000 - e.created_at) / 3600, 0.1);
        return score / Math.pow(age + 2, 1.5);
      };
      const topSignalOf = (eventId: string) => {
        const s = primalStatsCache.get(eventId);
        if (!s) return 0;
        const base = computeEngagementScore(s);
        const cats = [s.replies > 0, s.reposts > 0, s.likes > 0, s.zaps > 0].filter(Boolean).length;
        return Math.round(base * (1 + (cats - 1) * 0.25));
      };

      const sorted = feedSortMode === "hottest"
        ? sortable.sort((a, b) => hotnessOf(b) - hotnessOf(a))
        : feedSortMode === "zap_ranked"
        ? sortable.sort((a, b) => {
            const aStats = primalStatsCache.get(a.id);
            const bStats = primalStatsCache.get(b.id);
            const aSats = aStats?.zapAmount ?? 0;
            const bSats = bStats?.zapAmount ?? 0;
            if (bSats !== aSats) return bSats - aSats;
            return (bStats?.zaps ?? 0) - (aStats?.zaps ?? 0);
          })
        : feedSortMode === "most_discussed"
        ? sortable.sort((a, b) => {
            const aReplies = primalStatsCache.get(a.id)?.replies ?? 0;
            const bReplies = primalStatsCache.get(b.id)?.replies ?? 0;
            if (bReplies !== aReplies) return bReplies - aReplies;
            return b.created_at - a.created_at;
          })
        : sortable.sort((a, b) => topSignalOf(b.id) - topSignalOf(a.id));

      topFallbackRef.current = fellBackToAll;
      return sorted;
    }

    topFallbackRef.current = false;
    if (isCustomMode && feedSortMode === "oldest") {
      return [...deduped].sort((a, b) => a.created_at - b.created_at);
    }
    return [...deduped].sort((a, b) => {
      const aTime = repostMapRef.current.get(a.id)?.timestamp ?? a.created_at;
      const bTime = repostMapRef.current.get(b.id)?.timestamp ?? b.created_at;
      return bTime - aTime;
    });
    // repostVersion intentionally omitted: addRepostToMap adds the original
    // event to eventStore, which drives the throttled allTextNotes flush →
    // baseFilteredEvents → this re-sort (picking up the new repost timestamp),
    // so reposts reorder within a throttle tick without per-repost resorts.
  }, [feedMode, baseFilteredEvents, effectiveReachDepth, followSet, pubkey, grapeRankScores, isCustomMode, feedSortMode, topTimeWindow, rankingEnabled, discoverV2, discoverSort, activeCustomFeed, fofSet, statsVersion]);

  useEffect(() => {
    setTopFallbackAll(topFallbackRef.current);
  }, [sortedFiltered]);

  useEffect(() => {
    if (isCustomMode && feedSortMode !== "latest" && feedSortMode !== "oldest") {
      setDisplayLimit(PAGE_SIZE);
    }
  }, [feedSortMode, topTimeWindow, isCustomMode, setDisplayLimit]);

  useEffect(() => {
    if (feedMode !== "raw_signal" || activeCustomFeed) return;
    const uniquePubkeys = Array.from(new Set(sortedFiltered.slice(0, 100).map((e) => e.pubkey)));
    if (uniquePubkeys.length > 0) requestFollowerCounts(uniquePubkeys);
  }, [feedMode, activeCustomFeed, sortedFiltered]);

  useEffect(() => {
    if (feedMode !== "raw_signal" || !pubkey || !allTextNotes || effectiveReachDepth === "off") return;
    const scores = grapeRankScores ?? new Map<string, number>();
    const unscoredAuthors = new Set<string>();
    const limit = Math.min(allTextNotes.length, 200);
    for (let i = 0; i < limit; i++) {
      const pk = allTextNotes[i].pubkey;
      if (!followSet.has(pk) && !scores.has(pk)) {
        unscoredAuthors.add(pk);
      }
    }
    if (unscoredAuthors.size > 0) requestScoresBulk(Array.from(unscoredAuthors));
  }, [feedMode, effectiveReachDepth, grapeRankScores, allTextNotes, followSet, requestScoresBulk, pubkey]);

  const applyTierFilter = useCallback((events: typeof sortedFiltered) => {
    // Inert until this observer has a COMPLETED calculation (wotReady) — a
    // never-calculated user would otherwise filter on phantom "none" tiers.
    if (excludedTiers.size === 0 || !wotEnabled || !wotReady) return events;
    return events.filter((e) => {
      const isFlagged = flaggedPubkeys?.has(e.pubkey) ?? false;
      const effectiveTier: SignalTier = isFlagged ? "flagged" : getAuthorTier(e.pubkey);
      return !excludedTiers.has(effectiveTier);
    });
  }, [excludedTiers, wotEnabled, wotReady, flaggedPubkeys, getAuthorTier]);

  const perStopPostCounts = useMemo(() => {
    if (feedMode !== "raw_signal" || !pubkey || !wotEnabled) return undefined;
    const counts: Record<ReachDepth, number> = { "1hop": 0, "2hops": 0, "3hops": 0, global: 0, off: 0 };
    const tierFilteredBase = applyTierFilter(baseFilteredEvents);
    counts.off = tierFilteredBase.length;
    for (const e of tierFilteredBase) {
      if (followSet.has(e.pubkey)) {
        counts["1hop"]++;
        counts["2hops"]++;
        counts["3hops"]++;
        counts.global++;
        continue;
      }
      if (fofSet.has(e.pubkey)) {
        counts["2hops"]++;
        counts["3hops"]++;
        counts.global++;
        continue;
      }
      const score = grapeRankScores?.get(e.pubkey);
      if (score !== undefined) {
        counts["3hops"]++;
        if (score > 0) counts.global++;
      }
    }
    return counts;
  }, [feedMode, pubkey, wotEnabled, baseFilteredEvents, followSet, fofSet, grapeRankScores, applyTierFilter]);

  const tierFilteredFeed = useMemo(() => {
    // Following (open_comms) is exempt from tier strictness: it's a hand-picked
    // list with no tier bar, so an engaged tier selection must not silently
    // filter it. Like Trending, only the flagged safety floor applies — and
    // exactly as applyTierFilter enforced it here before (hide flagged authors
    // iff the shared set excludes "flagged"), so safety behavior is unchanged.
    // Spam/mute enforcement happened upstream in baseFilteredEvents.
    if (feedMode === "open_comms") {
      if (!wotEnabled || !wotReady || !excludedTiers.has("flagged") || !flaggedPubkeys || flaggedPubkeys.size === 0) {
        return sortedFiltered;
      }
      return sortedFiltered.filter((e) => !flaggedPubkeys.has(e.pubkey));
    }
    return applyTierFilter(sortedFiltered);
  }, [feedMode, sortedFiltered, applyTierFilter, wotEnabled, wotReady, excludedTiers, flaggedPubkeys]);
  // Trending is a GLOBAL network chart — personal tier strictness doesn't map
  // onto it (most chart authors are unscored by your graph, so presets behave
  // erratically: Strict guts the chart, Open does nothing). Only the flagged
  // safety floor applies; the options sheet hides Strictness for Trending.
  const tierFilteredTrending = useMemo(() => {
    // Trending is the DEFAULT feed mode and it renders from its own list, which
    // is why every earlier layer of the media work was correct and invisible:
    // baseFilteredEvents returns [] in this mode before any of it runs. Media
    // has to be injected here too, or it only ever appears in a mode nobody
    // lands on.
    //
    // Trending is a RANKED list and these events carry no rank — they are
    // merged newest-first, which is the only ordering they have. That is a real
    // trade: unranked media sitting beside server-scored posts. It is capped so
    // media supplements the ranking rather than flooding past it.
    //
    // THE SUPPLEMENT MUST PASS THE SAME STRANGER GATES FOR YOU APPLIES. This
    // memo used to interleave the raw relay sample, and baseFilteredEvents
    // returns [] in deep_scan mode — so every gate that exists for exactly
    // this content (machine-readable, no-profile, spam) ran only on a lane
    // the supplement never rode. Owner screenshot: a profileless bot
    // publishing a JSON "zone_presence" heartbeat every two minutes sat at
    // the top of Trending — splitSupplement picks NEWEST, so an every-2-min
    // publisher owns "newest" permanently. The gates below are the For You
    // stranger floor, applied to the UNRANKED additions only; Primal's ranked
    // list is deliberately untouched (chart authors are mostly unscored by
    // the viewer's graph — see the preset note above).
    const gate = (events: Event[]) => spamFilter(events, {
      follows: followSet,
      followsOfFollows: fofSet,
      reachDepth: "off",
      allEvents: events,
      hideMachineReadable: true,
      hideNoProfile: true,
      profileGetter,
      profileSettledGetter: isProfileFetchSettled,
      minFollowers: 0,
    });
    const withMedia = interleaveSupplement(
      trendingPosts,
      splitSupplement(trendingPosts, gate(mediaNotes), gate(supplementNotes)),
    );
    if (!wotEnabled || !flaggedPubkeys || flaggedPubkeys.size === 0) return withMedia;
    return withMedia.filter((e) => !flaggedPubkeys.has(e.pubkey));
  }, [trendingPosts, mediaNotes, supplementNotes, wotEnabled, flaggedPubkeys, spamFilter, followSet, fofSet, profileGetter, profileVersion]);

  // Trending has its own lens (Most Replied / Zapped / etc.), so the
  // Posts/Replies/All content filter doesn't apply here — Trending always shows
  // its full ranked set. Two things DO get applied.
  //
  // Fragments: a reply whose parent no relay will serve is unreadable on its
  // own — "Yeah, on small stuff sure…" with nothing to attach it to. The post
  // itself reports this once the lookup settles (ParentUnresolvedContext), and
  // the row comes out. Only replies can enter this set, and only after a
  // finished lookup, so a slow relay never costs anyone a post.
  //
  // Author runs: ranking scores each event alone, so a good hour from one
  // person takes three or four slots in a row and Trending reads as their
  // timeline. Reported live: three consecutive replies from the same author,
  // all three of them fragments.
  const contentFilteredTrending = useMemo(() => {
    const withoutFragments = unresolvedParents.size === 0
      ? tierFilteredTrending
      : tierFilteredTrending.filter((e) => !unresolvedParents.has(e.id));
    return spreadAuthors(withoutFragments);
  }, [tierFilteredTrending, unresolvedParents]);

  const orderedTrending = useMemo(() => {
    if (trendingSelector !== "polls") return contentFilteredTrending;

    const getExp = (e: Event): number | null => {
      const tag = e.tags.find(t => t[0] === "expiration" && t[1]);
      if (!tag) return null;
      const ts = parseInt(tag[1], 10);
      return isNaN(ts) ? null : ts;
    };

    const arr = contentFilteredTrending.slice();
    if (pollSort === "trending") {
      // Hot-score: engagement weighted by recency.
      const nowSec = Math.floor(Date.now() / 1000);
      const score = (e: Event) => {
        const votes = pollResponseCounts.get(e.id) || 0;
        const hours = Math.max((nowSec - e.created_at) / 3600, 0.5);
        return (votes + 1) / Math.pow(hours + 2, 1.5);
      };
      arr.sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        if (sa !== sb) return sb - sa;
        return b.created_at - a.created_at;
      });
    } else if (pollSort === "expiring") {
      arr.sort((a, b) => {
        const expA = getExp(a);
        const expB = getExp(b);
        if (expA === null && expB === null) return b.created_at - a.created_at;
        if (expA === null) return 1;
        if (expB === null) return -1;
        return expA - expB;
      });
    }
    return arr;
  }, [contentFilteredTrending, trendingSelector, pollSort, pollResponseCounts]);

  const tierHiddenCount = useMemo(() => {
    if (excludedTiers.size === 0 || !wotEnabled) return 0;
    if (feedMode === "deep_scan") return trendingPosts.length - tierFilteredTrending.length;
    return sortedFiltered.length - tierFilteredFeed.length;
  }, [feedMode, excludedTiers, wotEnabled, sortedFiltered, tierFilteredFeed, trendingPosts, tierFilteredTrending]);

  // ---- "New posts" pill: live-mode gating + reveal ordering ----
  // The pill (and its buffer bookkeeping) exists only on feed modes that
  // genuinely receive live inserts through THIS pipeline — see isLiveFeedMode.
  // The raw_signal consent gate renders a gate screen instead of the feed, so
  // it's excluded too. Static surfaces (Trending archives, Saved macro media
  // feeds, empty states) must never show a count.
  const isLiveFeed = isLiveFeedMode(feedMode) && !(feedMode === "raw_signal" && showRawGate);

  // Posts revealed by a pill tap (or the at-top auto-merge). On ranked feeds
  // (Discover "mix", engagement sorts) a just-arrived post has no engagement
  // yet and would rank below the fold — a plain cutoff bump would change
  // nothing above the viewport and the tap would read as dead. Revealed posts
  // are pinned newest-first ahead of the ranked remainder until the next
  // refresh / feed-key change. On chronological feeds this ordering is
  // identical to the natural one.
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Reveal-first ordering would contradict an explicit "Oldest" sort.
  const revealOrderingRef = useRef(true);
  revealOrderingRef.current = !(isCustomMode && feedSortMode === "oldest");

  const freshDisplayedEvents = useMemo(() => {
    if (feedMode === "deep_scan") return orderedTrending;
    // Same fragment rule as Trending: a reply whose parent no relay will serve
    // is unreadable wherever it appears, so it comes out of the chronological
    // feeds too. Author spacing does NOT apply here — these feeds are ordered by
    // time, and reordering them would break the one promise they make.
    const visible = tierFilteredFeed.filter(
      (e) => e.created_at <= cutoffTimestamp && !unresolvedParents.has(e.id),
    );
    return orderRevealedFirst(visible, revealedIds).slice(0, displayLimit);
  }, [feedMode, tierFilteredFeed, orderedTrending, cutoffTimestamp, displayLimit, revealedIds, unresolvedParents]);

  // ---- Feed stability: pin the rendered order while the reader is in it ----
  // freshDisplayedEvents recomputes continuously (live inserts, engagement
  // re-ranks, profile un-hides, repost resorts) and every recompute used to be
  // rendered immediately — inserting/reordering rows ABOVE the viewport and
  // shoving the post the user was reading. X-style fix: while the user is NOT
  // at the top, the rendered list is frozen (same ids, same order); fresh items
  // that sort AFTER the current tail still append (infinite scroll), everything
  // else is silently held (`pendingCount` — re-ranks, un-hides, backfill; NOT
  // shown in the pill, which counts only genuinely-new live posts). Scrolling
  // to top or tapping the pill adopts the fresh list in one commit.
  //
  // The pin only breaks on USER view changes (tab/sort/filter — the feedKey),
  // never on data arrival.
  const feedKey = [
    feedMode,
    activeCustomFeed?.id ?? "",
    feedSortMode,
    topTimeWindow,
    contentFilter,
    feedStyle,
    trendingSelector,
    pollSort,
    discoverSort,
    effectiveReachDepth,
    rankingEnabled ? "1" : "0",
    wotEnabled ? "1" : "0",
    Array.from(excludedTiers).sort().join(","),
  ].join("|");
  const pinnedRef = useRef<Event[] | null>(null);
  const pinnedKeyRef = useRef<string | null>(null);
  const snapshotConsumedRef = useRef(false);
  const [mergeEpoch, setMergeEpoch] = useState(0);

  // A USER view change (tab/sort/filter) is a fresh context — drop the
  // reveal-first pinning from the previous one.
  useEffect(() => {
    setRevealedIds((prev) => (prev.size > 0 ? new Set() : prev));
  }, [feedKey]);

  const { events: displayedEvents } = useMemo(() => {
    // One-time snapshot adoption on a back-navigation remount: render the SAME
    // items the user left, so the restored scroll offset lands on identical
    // pixels (no refetch reshuffle, no auto-merge of what arrived meanwhile).
    if (!snapshotConsumedRef.current) {
      snapshotConsumedRef.current = true;
      if (restoringOnMountRef.current && _savedFeedSnapshot && _savedFeedSnapshot.key === feedKey) {
        pinnedRef.current = _savedFeedSnapshot.events;
        pinnedKeyRef.current = feedKey;
      }
    }
    const fresh = freshDisplayedEvents;
    const pinned = pinnedRef.current;
    if (isAtTop || pinnedKeyRef.current !== feedKey || !pinned || pinned.length === 0) {
      pinnedRef.current = fresh;
      pinnedKeyRef.current = feedKey;
      return { events: fresh, pendingCount: 0 };
    }
    const pinnedIds = new Set<string>();
    for (const e of pinned) pinnedIds.add(e.id);
    let lastPinnedIdx = -1;
    for (let i = 0; i < fresh.length; i++) {
      if (pinnedIds.has(fresh[i].id)) lastPinnedIdx = i;
    }
    let pending = 0;
    const appended: Event[] = [];
    if (lastPinnedIdx === -1) {
      // No overlap with the pinned window (e.g. everything shown has fallen
      // out of the fresh slice) — nothing can safely append; hold it all.
      pending = fresh.length;
    } else {
      for (let i = 0; i < fresh.length; i++) {
        const e = fresh[i];
        if (pinnedIds.has(e.id)) continue;
        if (i > lastPinnedIdx) appended.push(e);
        else pending++;
      }
    }
    if (appended.length === 0) return { events: pinned, pendingCount: pending };
    const merged = [...pinned, ...appended];
    pinnedRef.current = merged;
    return { events: merged, pendingCount: pending };
    // mergeEpoch: bumped by mergeAllNew after clearing the pin, forcing a
    // re-adopt of the fresh list in the same commit as the cutoff bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshDisplayedEvents, isAtTop, feedKey, mergeEpoch]);

  // Keep the back-navigation snapshot current with what's actually rendered.
  useEffect(() => {
    if (displayedEvents.length === 0) return;
    _savedFeedSnapshot = { key: feedKey, events: displayedEvents, savedAt: Date.now() };
  }, [displayedEvents, feedKey]);

  // Guest taste-then-wall (lib/guest-limits.ts): a signed-out visitor sees the
  // first few posts — a shared link into the feed still shows value — and the
  // wall card ends the scroll. Signed-in passes through untouched.
  const guestCapped = useMemo(() => capForGuest(displayedEvents, !!pubkey), [displayedEvents, pubkey]);

  useEffect(() => {
    resetVisibleWindowRef.current = () => {
      if (feedMode !== "raw_signal") return;
      // Cutoff jumps past everything buffered — those posts are now visible,
      // so drain them into `seen` instead of leaving a stale pill count.
      bufferedIdsRef.current.forEach((id) => seenEventIdsRef.current.add(id));
      bufferedIdsRef.current.clear();
      setBufferedVersion((v) => v + 1);
      setCutoffTimestamp(Math.floor(Date.now() / 1000) + 60);
      setDisplayLimit(PAGE_SIZE);
    };
  }, [feedMode, setCutoffTimestamp, setDisplayLimit]);

  const visibleUnscoredCount = useMemo(() => {
    if (feedMode !== "raw_signal" || !pubkey || effectiveReachDepth === "off") return 0;
    const seen = new Set<string>();
    let count = 0;
    const windowSize = Math.max(displayLimit, PAGE_SIZE);
    let scanned = 0;
    for (const e of baseFilteredEvents) {
      if (e.created_at > cutoffTimestamp) continue;
      if (seen.has(e.pubkey)) continue;
      seen.add(e.pubkey);
      scanned++;
      if (!followSet.has(e.pubkey) && !grapeRankScores?.has(e.pubkey)) count++;
      if (scanned >= windowSize) break;
    }
    return count;
  }, [feedMode, pubkey, effectiveReachDepth, baseFilteredEvents, cutoffTimestamp, displayLimit, followSet, grapeRankScores]);

  const [showScoreLoadingHint, setShowScoreLoadingHint] = useState(false);
  useEffect(() => {
    if (tierChangeAt === 0) return;
    if (effectiveReachDepth === "off") { setShowScoreLoadingHint(false); return; }
    if (visibleUnscoredCount === 0) { setShowScoreLoadingHint(false); return; }
    setShowScoreLoadingHint(true);
    const t = setTimeout(() => setShowScoreLoadingHint(false), 4000);
    return () => clearTimeout(t);
  }, [tierChangeAt, visibleUnscoredCount, effectiveReachDepth]);

  const debugSnapshotRef = useRef({ baseFilteredEvents, sortedFiltered, tierFilteredFeed, displayedEvents, followSet, grapeRankScores, effectiveReachDepth });
  useEffect(() => {
    debugSnapshotRef.current = { baseFilteredEvents, sortedFiltered, tierFilteredFeed, displayedEvents, followSet, grapeRankScores, effectiveReachDepth };
  });
  const lastLoggedTierChangeAtRef = useRef(0);
  useEffect(() => {
    if (tierChangeAt === 0) return;
    if (lastLoggedTierChangeAtRef.current === tierChangeAt) return;
    let enabled = false;
    try { enabled = localStorage.getItem("debug-reach-depth") === "true"; } catch {}
    if (!enabled) return;
    if (feedMode !== "raw_signal") return;
    lastLoggedTierChangeAtRef.current = tierChangeAt;
    const snap = debugSnapshotRef.current;
    let follows = 0, scoredFoF = 0, unscored = 0;
    const seen = new Set<string>();
    for (const e of snap.displayedEvents) {
      if (seen.has(e.pubkey)) continue;
      seen.add(e.pubkey);
      if (snap.followSet.has(e.pubkey)) follows++;
      else if (snap.grapeRankScores?.has(e.pubkey)) scoredFoF++;
      else unscored++;
    }
    console.log(
      `[ReachDepth] tier=${snap.effectiveReachDepth}` +
      ` base=${snap.baseFilteredEvents.length}` +
      ` reach=${snap.sortedFiltered.length}` +
      ` tier_filtered=${snap.tierFilteredFeed.length}` +
      ` visible=${snap.displayedEvents.length}` +
      ` authors: follows=${follows} scoredFoF=${scoredFoF} unscored=${unscored}`
    );
  }, [tierChangeAt, feedMode]);

  const seenSeededRef = useRef(false);
  useEffect(() => {
    // Buffer bookkeeping only where live inserts genuinely flow through this
    // pipeline (For You / Following / saved custom feeds). Static surfaces
    // (Trending, macro media feeds, empty/gate states) never grow a count.
    if (!isLiveFeed) return;
    if (!initialLoadDoneRef.current) return;

    if (!seenSeededRef.current) {
      for (const e of tierFilteredFeed) {
        seenEventIdsRef.current.add(e.id);
      }
      seenSeededRef.current = true;
      return;
    }

    let changed = false;
    const currentCutoff = cutoffTimestampRef.current;
    // tierFilteredFeed (NOT sortedFiltered): count exactly what the feed can
    // display. Buffering pre-tier-filter events counted posts the merge could
    // never show — a pill tap that visibly does nothing.
    for (const e of tierFilteredFeed) {
      if (!seenEventIdsRef.current.has(e.id)) {
        if (e.created_at > currentCutoff) {
          bufferedIdsRef.current.add(e.id);
          changed = true;
        } else {
          seenEventIdsRef.current.add(e.id);
        }
      }
    }
    if (changed) {
      setBufferedVersion((v) => v + 1);
    }
  }, [tierFilteredFeed, isLiveFeed]);

  const stableBufferedCount = useMemo(() => {
    void bufferedVersion;
    return bufferedIdsRef.current.size;
  }, [bufferedVersion]);

  // Drain the buffer into `seen`, returning the drained ids; optionally pin
  // them reveal-first so ranked feeds surface them at the top (skipped under
  // an explicit "Oldest" sort, where gluing newest-first on top is wrong).
  const drainBufferForReveal = useCallback((): string[] => {
    const revealed = Array.from(bufferedIdsRef.current);
    for (const id of revealed) seenEventIdsRef.current.add(id);
    bufferedIdsRef.current.clear();
    return revealed;
  }, []);
  const applyReveal = useCallback((revealed: string[]) => {
    if (revealed.length === 0 || !revealOrderingRef.current) return;
    setRevealedIds((prev) => {
      const next = new Set(prev);
      for (const id of revealed) next.add(id);
      return next;
    });
  }, []);

  const showBuffered = useCallback(() => {
    const revealed = drainBufferForReveal();
    flushSync(() => {
      applyReveal(revealed);
      setCutoffTimestamp(Math.floor(Date.now() / 1000) + 60);
      setDisplayLimit((prev) => Math.max(prev, PAGE_SIZE));
      setBufferedVersion((v) => v + 1);
    });
  }, [drainBufferForReveal, applyReveal]);

  // The pill counts ONLY genuinely-new live posts (the cutoff buffer).
  // pendingCount — pin-held re-ranks / un-hides / pagination backfill — is
  // old content reshuffling; counting it inflated the pill on every feed and
  // made the tap read as "nothing loaded". Held reshuffles still merge
  // silently at top / on tap.
  const totalNewCount = isLiveFeed ? stableBufferedCount : 0;

  // Pill tap / rocket tap: merge EVERYTHING in one committed state change —
  // cutoff bump reveals the buffered live events (pinned reveal-first so they
  // are visible even on ranked feeds), dropping the pin adopts the fresh
  // order — then jump to top. flushSync keeps it a single commit so the
  // virtualizer never renders a half-merged list.
  const mergeAllNew = useCallback(() => {
    const revealed = drainBufferForReveal();
    pinnedRef.current = null;
    // Jump BEFORE the merge commit (the pinned list's height is stable, so
    // this lands exactly at 0) …
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "instant" });
    flushSync(() => {
      applyReveal(revealed);
      setCutoffTimestamp(Math.floor(Date.now() / 1000) + 60);
      setDisplayLimit((prev) => Math.max(prev, PAGE_SIZE));
      setBufferedVersion((v) => v + 1);
      setMergeEpoch((v) => v + 1);
      setIsAtTop(true);
    });
    // … and re-assert AFTER it: the virtualizer's re-measure of the merged
    // list (and browser scroll anchoring) can otherwise drag the offset back
    // down, leaving the reader mid-feed staring at "nothing happened".
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [setCutoffTimestamp, setDisplayLimit, drainBufferForReveal, applyReveal]);

  // Reader parked AT the top: merge new arrivals automatically (X-style) — no
  // pill tap needed when there's nothing to push around. Small delay so a
  // burst settles into one merge. Never during a back-navigation restore.
  useEffect(() => {
    if (!isAtTop || !isLiveFeed) return;
    if (stableBufferedCount === 0) return;
    const t = setTimeout(() => showBuffered(), 1500);
    return () => clearTimeout(t);
  }, [isAtTop, stableBufferedCount, isLiveFeed, showBuffered]);

  // Broadcast the pending count so the global rocket FAB can yield to the
  // pill (one adaptive control — see ScrollToTopButton). `source` keys the
  // count so this page's 0s can't clobber another dispatcher's live count.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("new-posts-update", {
      detail: { source: "home", count: totalNewCount }
    }));
  }, [totalNewCount]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("new-posts-update", {
        detail: { source: "home", count: 0 }
      }));
    };
  }, []);

  const loadMoreCtxRef = useRef<{
    feedMode: FeedMode;
    follows: string[];
    activeCustomFeed: typeof activeCustomFeed;
    excludedTiers: Set<SignalTier>;
    wotEnabled: boolean;
    flaggedPubkeys: Set<string> | null;
    getAuthorTier: (pk: string) => SignalTier;
    retries: number;
    untilTs: number;
    reveal: boolean;
  } | null>(null);
  const tierSearchFloorRef = useRef(0);
  const MAX_TIER_RETRIES = 4;

  const doLoadMoreBatch = useCallback(() => {
    const ctx = loadMoreCtxRef.current;
    if (!ctx) return;
    const untilTs = ctx.untilTs;

    const olderFilter: any = {
      kinds: feedKinds(),
      until: untilTs,
      since: untilTs - 12 * 60 * 60,
      limit: PAGE_SIZE,
    };

    if (ctx.feedMode === "open_comms" && ctx.follows.length > 0) {
      olderFilter.authors = ctx.follows.slice(0, 200);
    }

    if (ctx.activeCustomFeed) {
      if (ctx.activeCustomFeed.authorPubkeys.length > 0) {
        olderFilter.authors = ctx.activeCustomFeed.authorPubkeys.slice(0, 200);
      }
      if (ctx.activeCustomFeed.hashtags.length > 0) {
        olderFilter["#t"] = ctx.activeCustomFeed.hashtags;
      }
    }

    let receivedCount = 0;
    let passedTierCount = 0;
    const unresolvedReposts: Event[] = [];
    const moreEventIds: string[] = [];
    const morePubkeys: string[] = [];
    olderFilter.kinds = withDiscoverKinds([KIND_TEXT_NOTE, KIND_REPOST, KIND_POLL]);
    // Media's own REQ for this page too — same reason as the first page.
    const olderMediaSub = throttledPoolSubscribe(
      withDiscoverRelays(FAST_RELAYS),
      { ...olderFilter, kinds: [...MEDIA_EVENT_KINDS], limit: mediaPageLimit(olderFilter.limit ?? PAGE_SIZE) },
      {
        onevent(event) { eventStore.add(event); moreEventIds.push(event.id); morePubkeys.push(event.pubkey); },
        oneose() { olderMediaSub.close(); },
      },
    );
    const sub = throttledPoolSubscribe(withDiscoverRelays(FAST_RELAYS), olderFilter, {
      onevent(event) {
        if (event.kind === KIND_REPOST) {
          let parsed = false;
          if (event.content && event.content.trim().startsWith("{")) {
            try {
              const originalEvent = JSON.parse(event.content) as Event;
              if (originalEvent && originalEvent.id && (originalEvent.kind === KIND_TEXT_NOTE || originalEvent.kind === KIND_POLL)) {
                addRepostToMap(originalEvent, event);
                moreEventIds.push(originalEvent.id);
                morePubkeys.push(originalEvent.pubkey);
                parsed = true;
              }
            } catch {}
          }
          if (!parsed) {
            const eTag = event.tags.find((t) => t[0] === "e");
            if (eTag && eTag[1]) {
              const cachedSet = eventStore.getByFilters({ ids: [eTag[1]] });
              const cached = cachedSet ? [...cachedSet].find((e) => e.id === eTag[1]) : undefined;
              if (cached) {
                addRepostToMap(cached, event);
                moreEventIds.push(cached.id);
                morePubkeys.push(cached.pubkey);
              } else {
                unresolvedReposts.push(event);
              }
            }
          }
        } else {
          receivedCount++;
          eventStore.add(event);
          moreEventIds.push(event.id);
          morePubkeys.push(event.pubkey);
          if (ctx.excludedTiers.size > 0 && ctx.wotEnabled) {
            const isFlagged = ctx.flaggedPubkeys?.has(event.pubkey) ?? false;
            const effectiveTier: SignalTier = isFlagged ? "flagged" : ctx.getAuthorTier(event.pubkey);
            if (!ctx.excludedTiers.has(effectiveTier)) passedTierCount++;
          } else {
            passedTierCount++;
          }
        }
      },
      oneose() {
        sub.close();

        fetchProfilesCached(Array.from(new Set(morePubkeys)));
        prefetchStatsImmediate(moreEventIds);

        if (unresolvedReposts.length > 0) {
          const missingIds = unresolvedReposts
            .map((r) => r.tags.find((t) => t[0] === "e")?.[1])
            .filter(Boolean) as string[];
          const uniqueIds = Array.from(new Set(missingIds));
          const resolvedMoreIds: string[] = [];
          const resolvedMorePks: string[] = [];
          const batchSub = throttledPoolSubscribe(FAST_RELAYS, { kinds: feedKinds(), ids: uniqueIds }, {
            onevent(original) {
              const matchingReposts = unresolvedReposts.filter(
                (r) => r.tags.some((t) => t[0] === "e" && t[1] === original.id)
              );
              for (const rp of matchingReposts) {
                addRepostToMap(original, rp);
              }
              resolvedMoreIds.push(original.id);
              resolvedMorePks.push(original.pubkey);
            },
            oneose() {
              batchSub.close();
              if (resolvedMorePks.length > 0) {
                fetchProfilesCached(resolvedMorePks);
              }
              if (resolvedMoreIds.length > 0) {
                prefetchStatsImmediate(resolvedMoreIds);
              }
            },
          });
        }
        tierSearchFloorRef.current = untilTs - 12 * 60 * 60;
        if (receivedCount === 0) {
          setHasMore(false);
          setIsLoadingMore(false);
          loadingMoreRef.current = false;
          loadMoreCtxRef.current = null;
        } else if (passedTierCount === 0 && ctx.excludedTiers.size > 0 && ctx.retries < MAX_TIER_RETRIES) {
          ctx.retries++;
          ctx.untilTs = untilTs - 12 * 60 * 60;
          if (ctx.reveal) setDisplayLimit((prev) => prev + PAGE_SIZE);
          doLoadMoreBatch();
        } else if (passedTierCount === 0 && ctx.excludedTiers.size > 0) {
          setHasMore(false);
          if (ctx.reveal) setDisplayLimit((prev) => prev + PAGE_SIZE);
          setIsLoadingMore(false);
          loadingMoreRef.current = false;
          loadMoreCtxRef.current = null;
        } else {
          if (ctx.reveal) setDisplayLimit((prev) => prev + PAGE_SIZE);
          setIsLoadingMore(false);
          loadingMoreRef.current = false;
          loadMoreCtxRef.current = null;
        }
      },
    });
  }, [addRepostToMap]);

  // Kick off a relay fetch for older events. reveal=true grows the visible
  // window when they arrive (the buffer was empty); reveal=false just deepens
  // the in-memory buffer in the background so subsequent reveals stay instant.
  const startOlderFetch = useCallback((reveal: boolean, cursorTs: number) => {
    if (loadingMoreRef.current || !hasMore || feedMode === "deep_scan") return;
    loadingMoreRef.current = true;
    if (reveal) setIsLoadingMore(true);
    const startTs = (excludedTiers.size > 0 && tierSearchFloorRef.current > 0 && tierSearchFloorRef.current < cursorTs)
      ? tierSearchFloorRef.current
      : cursorTs;
    loadMoreCtxRef.current = {
      feedMode,
      follows,
      activeCustomFeed,
      excludedTiers,
      wotEnabled,
      flaggedPubkeys: flaggedPubkeys ?? null,
      getAuthorTier,
      retries: 0,
      untilTs: startTs,
      reveal,
    };
    doLoadMoreBatch();
  }, [feedMode, follows, hasMore, activeCustomFeed, excludedTiers, wotEnabled, flaggedPubkeys, getAuthorTier, doLoadMoreBatch]);

  const loadMore = useCallback(() => {
    if (feedMode === "deep_scan") return;

    // We keep a buffer of older events ahead of the visible window (see the
    // prefetch effect below). Reveal the next page from that buffer INSTANTLY —
    // no network, no spinner — so the scroll stays continuous. Only block on the
    // network in the rare case the buffer is fully dry.
    const buffered = tierFilteredFeed.filter((e) => e.created_at <= cutoffTimestamp);
    if (buffered.length > displayLimit) {
      setDisplayLimit((prev) => prev + PAGE_SIZE);
      return;
    }
    const cursorTs = buffered.length > 0
      ? buffered[buffered.length - 1].created_at
      : Math.floor(Date.now() / 1000) - 6 * 60 * 60;
    startOlderFetch(true, cursorTs);
  }, [feedMode, tierFilteredFeed, cutoffTimestamp, displayLimit, setDisplayLimit, startOlderFetch]);

  // Event ids that already ran their entrance animation this mount — a
  // virtualized row remounting on scroll-back must render steady-state.
  const animatedIdsRef = useRef<Set<string>>(new Set());

  // One feed row (post or poll), shared by the plain and virtualized render
  // paths so they stay identical. `i` is the absolute index in displayedEvents.
  const renderFeedRow = (event: Event, i: number) => {
    const isRawUnfiltered = feedMode === "raw_signal" && effectiveReachDepth === "off" && pubkey;
    const isFlagged = isRawUnfiltered && isAuthorFlagged(event.pubkey);
    // Trust is signalled per-author by the TrustTierDot in each post header (No-
    // Signal icon for unknown/unscored authors, a red flag icon for flagged ones)
    // — never by dimming the post. A wrapper opacity (previously opacity-50 for
    // unknown / opacity-40 for flagged) multiplied the alpha of the body copy,
    // pushing its contrast below WCAG AA, and it did so ONLY on For You, so the
    // same post read crisp on Following/Saved/threads. We keep a thin red rule as
    // a non-text marker for flagged authors; body text now renders at the full,
    // contrast-token-driven foreground on every feed (and the Boost-contrast
    // accessibility setting can raise it further instead of fighting a fixed opacity).
    const deEmphasis = isFlagged ? "border-l-2 border-red-500/50 pl-1" : "";
    // No entrance animation when re-rendering a restored snapshot — replaying
    // the staggered fade reads as a refetch flash on back-navigation. And a
    // row only ever animates its FIRST appearance: virtualization unmounts
    // rows that leave the viewport, so without the seen-set a post would
    // replay its fade-in (staggered, up to 300ms at opacity 0) every time the
    // user scrolls back to it — the "washed-out ghosts" effect.
    const seenIds = animatedIdsRef.current;
    const skipAnim = restoringOnMountRef.current || (isMobile && i >= PAGE_SIZE) || seenIds.has(event.id);
    if (!skipAnim) seenIds.add(event.id);
    const enterClass = skipAnim ? "post-enter-skip" : "post-enter";
    return (
      <PrefetchPostWrapper key={event.id} pubkey={event.pubkey} className={`${enterClass} ${deEmphasis}`} style={!skipAnim ? { animationDelay: `${Math.min(i * 30, 300)}ms` } : undefined}>
        <ErrorBoundary key={event.id} fallback={<div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-muted-foreground" data-testid="error-post-fallback">This note couldn't be displayed</div>}>
          {isPollEvent(event) ? (
            <PollPost event={event} />
          ) : event.kind === KIND_LONG_FORM ? (
            <ArticleFeedCard event={event} />
          ) : (
            <NostrPost event={event} repostedBy={repostMapRef.current.get(event.id) || null} priority={i === 0} />
          )}
        </ErrorBoundary>
      </PrefetchPostWrapper>
    );
  };

  // Proactively keep ~2 pages of older events buffered AHEAD of what's shown, so
  // reaching the bottom reveals instantly instead of waiting on a relay round-
  // trip. Runs whenever the buffer/window changes; the cursor guard stops it
  // re-fetching the same window (and doLoadMoreBatch sets hasMore=false at the
  // end of the feed), so it self-limits.
  const lastBgCursorRef = useRef<number>(0);
  useEffect(() => {
    if (feedMode === "deep_scan" || !hasMore || loadingMoreRef.current) return;
    const buffered = tierFilteredFeed.filter((e) => e.created_at <= cutoffTimestamp);
    if (buffered.length === 0) return;
    if (buffered.length - displayLimit >= PAGE_SIZE * 2) return; // enough runway
    const cursorTs = buffered[buffered.length - 1].created_at;
    if (cursorTs === lastBgCursorRef.current) return; // already fetched this depth
    lastBgCursorRef.current = cursorTs;
    startOlderFetch(false, cursorTs);
  }, [feedMode, hasMore, tierFilteredFeed, displayLimit, cutoffTimestamp, startOlderFetch]);

  useEffect(() => {
    // Debounced so rapid scrolls / displayLimit bumps / throttled ingest don't
    // re-burst the whole window's metadata fetch. The fetchers are already
    // deduped, so the trailing call only requests what's genuinely new.
    const sourceEvents = displayedEvents;
    const t = setTimeout(() => {
      const authors = Array.from(new Set(sourceEvents.map((e) => e.pubkey)));
      fetchProfilesCached(authors);
      const eventIds = sourceEvents.map((e) => e.id);
      fetchInteractionsCached(eventIds);
      prefetchStatsImmediate(eventIds);
    }, 250);
    return () => clearTimeout(t);
  }, [displayedEvents]);

  // Reset the visible window when the user CHANGES feed mode — but not on
  // mount. Running on mount clobbered the cutoff/displayLimit that were
  // deliberately restored (module save + sessionStorage) for back-navigation:
  // the feed would truncate to page 1 and re-cut at "now", so the row the
  // scroll restorer was looking for no longer existed and the user was dumped
  // at the top of a reshuffled feed.
  const feedModeMountedRef = useRef(false);
  useEffect(() => {
    if (!feedModeMountedRef.current) {
      feedModeMountedRef.current = true;
      return;
    }
    setCutoffTimestamp(Math.floor(Date.now() / 1000));
    setDisplayLimit(PAGE_SIZE);
    setHasMore(true);
    // A buffered count belongs to the mode it accumulated on — never carry it
    // across a tab switch (it used to surface as a phantom pill on Trending /
    // macro feeds, whose merge can't show those posts). Runs AFTER the seen
    // effect in this commit (definition order), so it also swallows any ids
    // spuriously buffered against the pre-switch cutoff.
    bufferedIdsRef.current.forEach((id) => seenEventIdsRef.current.add(id));
    bufferedIdsRef.current.clear();
    setBufferedVersion((v) => v + 1);
  }, [feedMode]);

  useEffect(() => {
    const handleSoftRefresh = () => {
      // The refresh bumps the cutoff past every buffered event; drain them
      // into `seen` (they're about to be visible) so the pill count doesn't
      // survive the refresh as a stale number.
      bufferedIdsRef.current.forEach((id) => seenEventIdsRef.current.add(id));
      bufferedIdsRef.current.clear();
      setBufferedVersion((v) => v + 1);
      setRevealedIds((prev) => (prev.size > 0 ? new Set() : prev));
      setCutoffTimestamp(Math.floor(Date.now() / 1000) + 60);
      setDisplayLimit(PAGE_SIZE);
      setHasMore(true);
      if (feedMode === "deep_scan") {
        loadTrending(trendingSelector, { force: true });
      }
    };
    window.addEventListener("nostr-soft-refresh", handleSoftRefresh);
    return () => window.removeEventListener("nostr-soft-refresh", handleSoftRefresh);
  }, [feedMode, trendingSelector, loadTrending]);

  const isFollowsEmpty = feedMode === "open_comms" && follows.length === 0;
  const isFollowsLoading = feedMode === "open_comms" && follows.length > 0 && displayedEvents.length === 0 && isInitialLoading;
  // Global feed: keep the loader up (bounded — see grace timer) while raw
  // candidates exist but none have resolved profiles yet, instead of flashing
  // the empty state between EOSE and the first profile batch landing.
  const isGlobalLoading = feedMode === "raw_signal" && displayedEvents.length === 0 &&
    (isInitialLoading || (allTextNotes.length > 0 && !profileFloorGraceOver));
  // Gated on displayedEvents too: on a back-navigation remount the pinned
  // snapshot renders instantly while trending refetches — swapping it for a
  // skeleton would collapse the feed under the restored scroll offset.
  const isTrendingLoading = feedMode === "deep_scan" && trendingLoading && trendingPosts.length === 0 && displayedEvents.length === 0;
  const isCustomLoading = !!activeCustomFeed && displayedEvents.length === 0 && isInitialLoading;

  const currentSelector = TRENDING_SELECTORS.find((s) => s.value === trendingSelector);
  const currentSelectorLabel = currentSelector?.label ?? "Most Replied";

  const visibleTabs = useMemo(() => {
    return [
      { id: "raw_signal" as FeedMode, label: "For you", requiresAuth: false, hint: "Popular posts from across the network" },
      { id: "open_comms" as FeedMode, label: "Following", requiresAuth: true, hint: "Posts from the people you follow" },
      { id: "saved" as FeedMode, label: "Saved", requiresAuth: true, hint: "Your saved custom feeds" },
    ];
  }, []);

  // Saved pill shows its VALUE while that lane is active ("Images ▾",
  // "#naturestr ▾"); plain "Saved" otherwise. Derivation (incl. the
  // deleted-feed fallback) lives in helpers.getSavedTabLabel.
  const savedTabLabel = getSavedTabLabel(feedMode, feedStyle, customFeeds);

  const handleSaveFeed = async (feed: { name: string; hashtags: string[]; authorPubkeys: string[]; includeKeywords: string[]; excludeKeywords: string[]; contentType: string; icon?: FeedIconKey }) => {
    setIsSavingFeed(true);
    try {
      if (editingFeed) {
        await updateFeed(editingFeed.id, feed);
        setEditingFeed(null);
      } else {
        const newFeed = await createFeed({ ...feed, source: "custom" });
        if (newFeed) {
          setFeedMode(`custom_${newFeed.id}`);
        }
      }
      setTuneDialogOpen(false);
    } finally {
      setIsSavingFeed(false);
    }
  };

  const generateShareCode = useCallback((feed: NostrCustomFeed): string => {
    const payload = {
      n: feed.name,
      h: feed.hashtags.length > 0 ? feed.hashtags : undefined,
      a: feed.authorPubkeys.length > 0 ? feed.authorPubkeys : undefined,
      ik: feed.includeKeywords.length > 0 ? feed.includeKeywords : undefined,
      ek: feed.excludeKeywords.length > 0 ? feed.excludeKeywords : undefined,
      ct: feed.contentType !== "all" ? feed.contentType : undefined,
      s: feed.source,
      ic: feed.icon || undefined,
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }, []);

  const feedToShare = sharingFeed || activeCustomFeed;

  const handleCopyShareCode = useCallback(async () => {
    if (!feedToShare) return;
    const code = generateShareCode(feedToShare);
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: "Copied", description: "Feed config copied to clipboard. Share it with others!" });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [feedToShare, generateShareCode, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (!feedToShare) return;
    const code = generateShareCode(feedToShare);
    const url = `${window.location.origin}/?importFeed=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Copied", description: "Share link copied to clipboard." });
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  }, [feedToShare, generateShareCode, toast]);

  const handleNativeShare = useCallback(async () => {
    if (!feedToShare) return;
    const code = generateShareCode(feedToShare);
    const url = `${window.location.origin}/?importFeed=${encodeURIComponent(code)}`;
    const filterParts: string[] = [];
    if (feedToShare.hashtags.length > 0) filterParts.push(feedToShare.hashtags.map(t => `#${t}`).join(" "));
    if (feedToShare.includeKeywords.length > 0) filterParts.push(feedToShare.includeKeywords.join(", "));
    if (feedToShare.authorPubkeys.length > 0) filterParts.push(`${feedToShare.authorPubkeys.length} people`);
    const description = filterParts.length > 0 ? `Filters: ${filterParts.join(" · ")}` : "Custom Nostr feed";
    try {
      await navigator.share({
        title: `${feedToShare.name} — Relay Outpost Feed`,
        text: description,
        url,
      });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        try {
          await navigator.clipboard.writeText(url);
          toast({ title: "Copied", description: "Share link copied to clipboard." });
        } catch {
          toast({ title: "Error", description: "Failed to share.", variant: "destructive" });
        }
      }
    }
  }, [feedToShare, generateShareCode, toast]);

  const openShareDialog = useCallback((feed: NostrCustomFeed) => {
    setSharingFeed(feed);
    setShareDialogOpen(true);
  }, []);

  const handleConfirmDeleteFeed = useCallback(async () => {
    const cf = deletingFeed;
    if (!cf) return;
    setDeletingFeed(null);
    await deleteFeed(cf.id);
    if (feedMode === `custom_${cf.id}`) {
      const remaining = customFeeds.filter((f) => f.id !== cf.id);
      if (remaining.length > 0) setFeedMode(`custom_${remaining[0].id}`);
      else { setFeedMode("custom_all"); setFeedStyle("photos"); }
    }
  }, [deletingFeed, deleteFeed, feedMode, customFeeds]);

  const handleImportFeed = useCallback(async (input: string) => {
    if (!pubkey) {
      toast({ title: "Sign in required", description: "Log in to import feeds.", variant: "destructive" });
      return;
    }
    setIsImporting(true);
    try {
      let raw = input.trim();
      if (raw.includes("importFeed=")) {
        try {
          const url = new URL(raw, window.location.origin);
          raw = url.searchParams.get("importFeed") || raw;
        } catch {
          const match = raw.match(/importFeed=([^&]+)/);
          if (match) raw = decodeURIComponent(match[1]);
        }
      }
      const decoded = JSON.parse(decodeURIComponent(escape(atob(raw))));
      const ensureArray = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      const feedData = {
        name: typeof decoded.n === "string" ? decoded.n : "Imported Feed",
        hashtags: ensureArray(decoded.h),
        authorPubkeys: ensureArray(decoded.a),
        includeKeywords: ensureArray(decoded.ik),
        excludeKeywords: ensureArray(decoded.ek),
        contentType: typeof decoded.ct === "string" && ["all", "text_only", "media", "links"].includes(decoded.ct) ? decoded.ct : "all",
        source: (decoded.s === "pack" ? "pack" : "custom") as "pack" | "custom",
        icon: isValidFeedIconKey(decoded.ic) ? decoded.ic : undefined,
      };
      const newFeed = await createFeed(feedData);
      if (newFeed) {
        setFeedMode(`custom_${newFeed.id}`);
        toast({ title: "Feed imported", description: `"${feedData.name}" has been added to your feeds.` });
      }
      setImportDialogOpen(false);
      setImportText("");
    } catch {
      toast({ title: "Invalid feed data", description: "Could not parse the feed config. Make sure you pasted the full code.", variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  }, [pubkey, createFeed, toast, setFeedMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const importCode = params.get("importFeed");
    if (importCode && pubkey) {
      setImportText(importCode);
      setImportDialogOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [pubkey]);

  // Posts / Replies / All now lives in the FeedOptionsSheet (Show group).

  return (
    <ParentUnresolvedContext.Provider value={markUnresolvedParent}>
    <div className="px-3 sm:px-4 py-3 sm:py-4" data-testid="page-home">
      <HomeCoachmarks />
      {/* X-style "new posts" pill: only while the reader is down in the feed —
          at the top new arrivals auto-merge, so the pill would be noise — and
          only on modes that receive live inserts (isLiveFeed). */}
      {!isAtTop && isLiveFeed && <NewPostsPill count={totalNewCount} onClick={mergeAllNew} />}
      <div className="max-w-2xl mx-auto">
        <div className="mb-3 sm:mb-4 space-y-2">
          <PageTabs
            testId="container-feed-toggle"
            activeTabRef={feedTabAnchorRef}
            active={isCustomMode ? "saved" : feedMode === "deep_scan" ? "raw_signal" : feedMode}
            tabs={visibleTabs.map((tab) => {
              const needsAuth = tab.requiresAuth && !pubkey;
              const isActive = tab.id === "raw_signal"
                ? (feedMode === "raw_signal" || feedMode === "deep_scan")
                : tab.id === "saved"
                  ? isCustomMode
                  : feedMode === tab.id;
              return {
                key: tab.id,
                // Saved is a value-displaying selector: active feed's name while
                // the lane is active, "Saved" otherwise. The fixed max-width
                // (~14ch) + truncate keeps long custom-feed names from ever
                // reflowing the tab bar at 320px; chevron/testids unchanged.
                label: tab.id === "saved"
                  ? <span className="inline-block max-w-[7em] truncate align-bottom">{savedTabLabel}</span>
                  : tab.label,
                title: tab.hint,
                dimmed: needsAuth,
                testId: `button-feed-${tab.id}`,
                badge: (
                  <>
                    {needsAuth && (
                      <Lock className="w-2.5 h-2.5 shrink-0" />
                    )}
                    {/* Chevron on EVERY selectable pill, not just the active
                        one: a tap now always opens that lane's options (owner
                        call — "users select what settings they want each
                        time"), so the affordance must say so on every pill.
                        A ⌄ that only appeared after you'd already switched
                        advertised the menu exactly one tap too late. */}
                    {!needsAuth && (tab.id === "raw_signal" || tab.id === "open_comms" || tab.id === "saved") && (
                      <ChevronDown
                        className={`w-3 h-3 shrink-0 ${isActive ? "opacity-80" : "opacity-40"}`}
                        data-testid={`indicator-feed-options-${tab.id}`}
                        aria-hidden="true"
                      />
                    )}
                  </>
                ),
              };
            })}
            onChange={(key) => {
              const tab = visibleTabs.find((t) => t.id === key);
              if (!tab) return;
              const needsAuth = tab.requiresAuth && !pubkey;
              const isActive = tab.id === "raw_signal"
                ? (feedMode === "raw_signal" || feedMode === "deep_scan")
                : tab.id === "saved"
                  ? isCustomMode
                  : feedMode === tab.id;
              // EVERY tap on a selectable pill opens that lane's options sheet
              // (owner call: "the menu should open every time — users select
              // what settings they want each time"). An inactive pill still
              // switches the lane FIRST — the content changes behind the sheet
              // immediately, so dismissing the sheet costs one swipe and never
              // undoes the switch. The chevron on every pill (above) is this
              // rule's affordance.
              if (needsAuth) {
                navigate("/login");
              } else if (tab.id === "raw_signal") {
                if (!isActive) handleForYouClick();
                setOptionsSheetOpen(true);
              } else if (tab.id === "open_comms") {
                if (!isActive) setFeedMode(tab.id);
                setOptionsSheetOpen(true);
              } else if (tab.id === "saved") {
                if (!isActive) {
                  if (customFeeds.length === 0) {
                    // No custom feeds yet — land on the Images macro feed so
                    // the tab always has content. Images/Videos + "Tune New
                    // Feed" stay reachable from the pill's dropdown.
                    setFeedMode("custom_all"); setFeedStyle("photos");
                  } else {
                    const lastCustom = customFeeds.find(f => feedMode === `custom_${f.id}`);
                    setFeedMode(`custom_${lastCustom?.id || customFeeds[0]?.id}`);
                  }
                }
                // Re-running the mode switch when already active would reset a
                // Videos/Polls pick to Images — hence the isActive guard above.
                setSavedMenuOpen(true);
              } else {
                setFeedMode(tab.id);
              }
            }}
          />

          {/* The Sort · Show · Strictness summary row was removed to keep the
              area under the mode pills clean — the active pill's ⌄ (tap it
              again) remains the entry point to the options sheet. */}

          {/* The All/Photos/Video feed-style chips and the per-feed sort picker
              live in the SavedOptionsSheet (tap the active Saved pill) — saved
              feeds render no control row under the pills, matching the other
              feed modes. */}
        </div>

        {/* The condensed saved-feed control row (sort · style chips · badges ·
            count · share · settings) was removed — saved feeds show only the
            mode pills, like every other feed mode. Sort and the All/Photos/Video
            lens now live in the SavedOptionsSheet (tap the active Saved pill);
            per-feed Share/Tune were already there. Only the transient
            time-window feedback lines below survive. */}
        {activeCustomFeed && TIME_WINDOW_SORT_MODES.includes(feedSortMode) && (topWindowLoading || topFallbackAll) && (
          <div className="mb-3">
            {topWindowLoading ? (
              <p className="text-[11px] text-brand/70 italic flex items-center gap-1.5" data-testid="text-top-window-loading">
                <RelayOutpostInlineLoader className="text-brand/60" />
                Loading posts from the last {topTimeWindow}...
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground/50 italic" data-testid="text-top-fallback">
                No posts in the last {topTimeWindow} — showing all time
              </p>
            )}
          </div>
        )}

        {/* Strictness (Open/Balanced/Strict) moved into the FeedOptionsSheet;
            the granular reach/tier controls live on the Trust & Safety page. */}
        {feedMode === "raw_signal" && !pubkey && (
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] text-muted-foreground/50 italic leading-tight" data-testid="text-raw-disclaimer">
              Unfiltered global feed · sign in to enable trust filtering
            </span>
          </div>
        )}

        {/* The Trending metric dropdown + time-range/poll-sort chip rows and the
            Refresh button moved into FeedOptionsSheet (tap the active For you
            pill) — Trending renders no control row under the tabs, matching
            every other feed mode. Only this transient loading feedback line
            survives (posts already on screen, a new chart on its way). */}
        {feedMode === "deep_scan" && trendingLoading && trendingPosts.length > 0 && (
          <div className="mb-3">
            <p className="text-[11px] text-brand/70 italic flex items-center gap-1.5" data-testid="text-trending-loading">
              <RelayOutpostInlineLoader className="text-brand/60" />
              Loading {currentSelectorLabel}...
            </p>
          </div>
        )}

        {/* Tier filter bar shows on For You + Saved feeds only. Those surface
            content from accounts the user doesn't follow, where tier filtering
            is meaningful; Following is a hand-picked list, so the bar is
            clutter there (and tierFilteredFeed exempts Following from tier
            strictness to match — no bar, no hidden filtering). It also stays
            hidden on Trending (deep_scan): a global chart where only the
            flagged safety floor applies, so the toggles would be dead
            controls. The Saved macro media feeds honor the shared set via
            useTierContentFilter, so the bar shows for every custom mode. */}
        {pubkey && wotEnabled && wotReady && tierFilterExpanded && (feedMode === "raw_signal" || isCustomMode) && (
          <FeedTierFilter
            excludedTiers={excludedTiers}
            onToggle={toggleTierFilter}
            onClear={clearTierFilters}
          />
        )}

        {/* Getting-started checklist removed — the feed opens clean for new
            users; guides live in Help & Guides only. */}

        {/* FeedErrorBoundary: a render crash inside any feed lane (post card,
            virtualizer, media mosaic) must never unmount the tabs/menu/nav
            above — it collapses to a compact "Reload feed" card instead. */}
        <FeedErrorBoundary label="home">
        {feedMode === "custom_all" ? (
          <Suspense fallback={<FeedSkeletonList count={5} />}>
            {feedStyle === "video" ? <VideoFeedLazy embedded sort={mediaSort} /> : feedStyle === "polls" ? <PollsFeedLazy embedded sort={savedPollSort} show={savedPollShow} /> : <ImagesFeedLazy embedded sort={mediaSort} />}
          </Suspense>
        ) : showRawGate && feedMode === "raw_signal" ? (
          <div className="relative min-h-[420px] sm:min-h-[480px] rounded-xl overflow-hidden" data-testid="container-raw-gate">
            <div className="absolute inset-0 bg-gradient-to-b from-brand/80 via-white/90 to-white dark:from-brand/40 dark:via-black/70 dark:to-black/90" />
            <div className="absolute inset-0 backdrop-blur-sm" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-brand/10 blur-[80px] animate-pulse" style={{ animationDuration: "4s" }} />
            <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120px] h-[120px] rounded-full bg-brand/15 blur-[40px]" />

            <div className="relative z-10 flex flex-col items-center justify-center text-center px-5 py-12 sm:py-16">
              <div className="relative mb-5">
                <div className="absolute inset-0 rounded-full bg-brand/15 dark:bg-brand/20 blur-xl scale-150" />
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-brand/30 bg-brand/10 backdrop-blur-sm flex items-center justify-center">
                  <Antenna className="w-7 h-7 sm:w-8 sm:h-8 text-brand" />
                </div>
              </div>

              <h3 className="text-lg sm:text-xl font-bold tracking-tight text-[#1f1b4b] dark:text-white mb-2">Global feed</h3>
              <p className="text-sm text-[#1f1b4b]/50 dark:text-white/50 max-w-[280px] leading-relaxed mb-8">
                The global feed shows recent posts from every connected relay, with no filtering applied.
              </p>

              <div className="flex flex-col gap-3 w-full max-w-[300px]">
                <button
                  className="group relative w-full py-2.5 px-4 rounded-lg bg-[#1a1040] hover:bg-[#241458] dark:bg-[#0d0a1f]/90 dark:hover:bg-[#1a1040]/90 border border-brand/20 hover:border-brand/40 text-brand hover:text-white text-[13px] font-medium transition-all duration-200 shadow-md shadow-brand/30 dark:shadow-brand/50 hover:shadow-[0_0_16px_rgba(139,92,246,0.2)] flex items-center justify-center gap-2"
                  onClick={() => acknowledgeRaw(true)}
                  data-testid="button-raw-gate-trust"
                >
                  <ShieldCheck className="w-4.5 h-4.5 text-brand" />
                  Enter with Trust Filter (2 Hops)
                </button>
                <button
                  className="w-full py-2 px-5 text-[13px] text-[#1f1b4b]/50 hover:text-[#1f1b4b]/80 dark:text-white/45 dark:hover:text-white/70 font-medium transition-colors duration-200 flex items-center justify-center gap-1.5 underline underline-offset-2 decoration-[#1f1b4b]/15 hover:decoration-[#1f1b4b]/35 dark:decoration-white/15 dark:hover:decoration-white/35"
                  onClick={() => acknowledgeRaw(false)}
                  data-testid="button-raw-gate-unfiltered"
                >
                  or enter unfiltered
                </button>
              </div>

              <p className="text-[11px] text-[#1f1b4b]/25 dark:text-white/25 mt-6 max-w-[260px] leading-relaxed">
                Trust filter controls how far beyond your follows you'll see posts from. Slide it to widen or narrow your circle.
              </p>
            </div>
          </div>
        ) : feedMode === "custom_empty" ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-frequencies"
          >
            <TuneAntennaIllustration className="text-brand/70 mb-3" />
            <p className="text-sm font-medium mb-1">No feeds tuned yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Create a custom feed to filter posts by hashtags, keywords, or specific people.
            </p>
            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  if (!pubkey) { navigate("/login"); return; }
                  setEditingFeed(null); setTuneDialogOpen(true);
                }}
                data-testid="button-tune-first-frequency-empty"
              >
                <Plus className="w-3.5 h-3.5" />
                Tune New Feed
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-brand/30 text-brand"
                onClick={() => {
                  if (!pubkey) { navigate("/login"); return; }
                  setBrowsePacksOpen(true);
                }}
                data-testid="button-browse-packs-empty"
              >
                <Package className="w-3.5 h-3.5" />
                Browse Packs
              </Button>
            </div>
          </div>
        ) : isFollowsEmpty ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-following"
          >
            <NoSignalIllustration className="text-brand/70 mb-3" />
            <p className="text-sm font-medium mb-1">Follow people to build your feed</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Posts from people you follow will appear here. Find people to follow using search or starter packs.
            </p>
            <SuggestedFollowsStrip className="mt-6" />
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-brand/30 text-brand"
                onClick={() => navigate("/search")}
                data-testid="button-search-follows-empty"
              >
                <Search className="w-3.5 h-3.5" />
                Find People
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-brand/30 text-brand"
                onClick={() => {
                  if (!pubkey) { navigate("/login"); return; }
                  setBrowsePacksOpen(true);
                }}
                data-testid="button-browse-packs-follows-empty"
              >
                <Package className="w-3.5 h-3.5" />
                Starter Packs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setFeedMode("deep_scan")}
                data-testid="button-switch-scan"
              >
                <Radar className="w-3.5 h-3.5" />
                Explore Trending
              </Button>
            </div>
          </div>
        ) : isFollowsLoading || isGlobalLoading || isTrendingLoading || isCustomLoading ? (
          <FeedSkeletonList count={5} />
        ) : displayedEvents.length === 0 && feedMode === "deep_scan" ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-trending"
          >
            <RadarSweepIllustration className="text-brand/70 mb-3" />
            <p className="text-sm font-medium mb-1">Deep scan returned empty</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Try a different time range or check back later.
            </p>
          </div>
        ) : displayedEvents.length === 0 && excludedTiers.size > 0 && tierHiddenCount > 0 ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-tier-filtered"
          >
            <ShieldCheck className="w-10 h-10 text-brand/40 mb-3" />
            <p className="text-sm font-medium mb-1">All posts filtered out</p>
            <p className="text-xs text-muted-foreground max-w-xs mb-3">
              Your trust tier filters are hiding all {tierHiddenCount} post{tierHiddenCount !== 1 ? "s" : ""} in this feed.
            </p>
            <button
              onClick={clearTierFilters}
              className="text-xs text-brand hover:text-brand/80 dark:hover:text-brand transition-colors"
            >
              Show all posts
            </button>
          </div>
        ) : displayedEvents.length === 0 && activeCustomFeed ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-custom"
          >
            <StaticNoiseIllustration className="text-brand/70 mb-3" />
            <p className="text-sm font-medium mb-1">No signals on this feed</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Try adjusting your filters or check back later.
            </p>
          </div>
        ) : displayedEvents.length === 0 ? (
          <div
            className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
            data-testid="container-empty-feed"
          >
            <StaticNoiseIllustration className="text-brand/70 mb-3" />
            <p className="text-sm font-medium mb-1">Your feed is filling up</p>
            <p className="text-xs text-muted-foreground max-w-xs mb-3">
              Posts from the people you follow will show up here. Give it a moment — or explore trending and find more people to follow.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-brand/30 text-brand"
                onClick={() => setFeedMode("deep_scan")}
                data-testid="button-empty-explore"
              >
                <Radar className="w-3.5 h-3.5" />
                Explore Trending
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => navigate("/search?tab=people")}
                data-testid="button-empty-find-people"
              >
                <Users className="w-3.5 h-3.5" />
                Find People
              </Button>
            </div>
          </div>
        ) : (
          <>
            {isCustomMode && activeCustomFeed && (feedStyle === "photos" || feedStyle === "video") ? (
              // Photos/Video style chip on a saved feed → Instagram-Explore
              // media mosaic instead of post cards. Consumes the same
              // filtered+sorted displayedEvents (spam/mute/trust + sort mode
              // still apply) and keeps the same infinite-scroll sentinel.
              <>
                <MediaGridGallery events={displayedEvents} mode={feedStyle} />
                <InfiniteScrollSentinel
                  onLoadMore={loadMore}
                  isLoading={isLoadingMore}
                  hasMore={hasMore}
                />
              </>
            ) : useVirtualFeed ? (
              <>
                <VirtualFeed
                  items={guestCapped.shown}
                  getKey={(event) => event.id}
                  estimateSize={isMobile ? 360 : 320}
                  onReachEnd={feedMode !== "deep_scan" && !guestCapped.walled ? loadMore : undefined}
                  renderItem={(event, i) => renderFeedRow(event, i)}
                />
                {guestCapped.walled && <GuestWall context="Keep exploring the feed" className="mt-4" />}
              </>
            ) : (
              <>
                <div className="space-y-3 cv-list" data-testid="container-feed">
                  {guestCapped.shown.map((event, i) => renderFeedRow(event, i))}
                </div>
                {guestCapped.walled && <GuestWall context="Keep exploring the feed" className="mt-4" />}
                {feedMode !== "deep_scan" && !guestCapped.walled && (
                  <InfiniteScrollSentinel
                    onLoadMore={loadMore}
                    isLoading={isLoadingMore}
                    hasMore={hasMore}
                  />
                )}
              </>
            )}
          </>
        )}
        </FeedErrorBoundary>
      </div>

      <SavedOptionsSheet
        open={savedMenuOpen}
        onOpenChange={setSavedMenuOpen}
        anchorRef={feedTabAnchorRef}
        feedMode={feedMode}
        feedStyle={feedStyle}
        mediaSort={mediaSort}
        onPickMacro={(style) => { setFeedMode("custom_all"); setFeedStyle(style); }}
        onPickSort={setMediaSort}
        pollSort={savedPollSort}
        onPollSort={setSavedPollSort}
        pollShow={savedPollShow}
        onPollShow={setSavedPollShow}
        activeFeed={activeCustomFeed}
        feedSortMode={feedSortMode}
        onFeedSort={(v) => activeCustomFeed && setFeedSortMode(v, activeCustomFeed.id)}
        topTimeWindow={topTimeWindow}
        onTimeWindow={(v) => activeCustomFeed && setTopTimeWindow(v, activeCustomFeed.id)}
        onPickStyle={setFeedStyle}
        customFeeds={customFeeds}
        onSelectFeed={(id) => { setFeedMode(`custom_${id}`); setFeedStyle("all"); }}
        onReorder={reorderFeeds}
        onShare={openShareDialog}
        onEdit={(cf) => { setEditingFeed(cf); setTuneDialogOpen(true); }}
        onDelete={(cf) => setDeletingFeed(cf)}
        onTuneNew={() => { setEditingFeed(null); setTuneDialogOpen(true); }}
        onBrowsePacks={() => setBrowsePacksOpen(true)}
        onImport={() => setImportDialogOpen(true)}
      />
      <FeedOptionsSheet
        open={optionsSheetOpen}
        onOpenChange={setOptionsSheetOpen}
        anchorRef={feedTabAnchorRef}
        tab={feedMode === "open_comms" ? "following" : "foryou"}
        currentSort={currentSort}
        onSort={handleSortChange}
        contentFilter={contentFilter}
        onContentFilter={handleContentFilterChange}
        showStrictness={!!pubkey && wotEnabled && wotReady}
        activePreset={activePreset}
        onPreset={handlePresetChange}
        onAdvanced={() => navigate("/account?tab=shield")}
        trendingSelector={trendingSelector}
        onTrendingMetric={handleTrendingMetric}
        trendingTime={trendingTime}
        onTrendingTime={handleTrendingTime}
        pollSort={pollSort}
        onPollSort={handlePollSort}
        onPickPolls={handlePickPolls}
        onRefreshTrending={() => loadTrending(trendingSelector, { force: true })}
      />

      <TuneFrequencyDialog
        open={tuneDialogOpen}
        onOpenChange={setTuneDialogOpen}
        onSave={handleSaveFeed}
        isSaving={isSavingFeed}
        editFeed={editingFeed}
      />

      <AlertDialog open={!!deletingFeed} onOpenChange={(open) => { if (!open) setDeletingFeed(null); }}>
        <AlertDialogContent className="glass-dialog-card border-red-500/20 max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-brand tracking-wide">Delete "{deletingFeed?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground/70">
              This removes the feed from your list. You can always tune or import it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteFeed}
              className="h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
              data-testid="button-confirm-delete-feed"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BrowsePacksDialog
        open={browsePacksOpen}
        onOpenChange={setBrowsePacksOpen}
        onFeedCreated={(feedId) => {
          setFeedMode(`custom_${feedId}`);
        }}
      />

      {isMobile ? (
        <Drawer open={shareDialogOpen} onOpenChange={(open) => { setShareDialogOpen(open); if (!open) setSharingFeed(null); }}>
          <DrawerContent className="glass-dialog-card border-border dark:border-brand/15">
            <DrawerHeader className="pb-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
                  <Share2 className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <DrawerTitle className="text-sm font-semibold text-foreground">Share Feed</DrawerTitle>
                  <p className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">Let others import your feed config</p>
                </div>
              </div>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-4">
              {feedToShare && (
                <>
                  <div className="rounded-lg border border-border dark:border-brand/15 bg-accent/40 dark:bg-brand/[0.03] p-3.5 space-y-2.5">
                    <div className="flex items-center gap-2">
                      {isValidFeedIconKey(feedToShare.icon) ? <FeedIconSvg iconKey={feedToShare.icon} className="w-5 h-5 text-brand" /> : <Radio className="w-5 h-5 text-brand/70" />}
                      <span className="text-sm font-semibold text-foreground truncate">{feedToShare.name}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {feedToShare.hashtags.map(t => <Badge key={t} variant="secondary" className="text-[11px] bg-accent text-brand border-brand/20 dark:bg-brand/10">#{t}</Badge>)}
                      {feedToShare.includeKeywords.map(k => <Badge key={k} variant="outline" className="text-[11px] border-emerald-500/20 text-emerald-800 dark:text-emerald-400">{k}</Badge>)}
                      {feedToShare.excludeKeywords.map(k => <Badge key={k} variant="outline" className="text-[11px] border-red-500/20 text-red-700 dark:text-red-400 line-through">{k}</Badge>)}
                      {feedToShare.authorPubkeys.length > 0 && <Badge variant="outline" className="text-[11px] border-blue-500/20 text-blue-700 dark:text-blue-400"><Users className="w-3 h-3 mr-1" />{feedToShare.authorPubkeys.length} {feedToShare.authorPubkeys.length === 1 ? "person" : "people"}</Badge>}
                      {feedToShare.contentType !== "all" && <Badge variant="outline" className="text-[11px] border-brand/20 text-brand">{feedToShare.contentType === "text_only" ? "Text" : feedToShare.contentType === "media" ? "Media" : "Links"}</Badge>}
                    </div>
                  </div>
                  {typeof navigator.share === "function" && (
                    <Button className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white" onClick={handleNativeShare} data-testid="button-native-share">
                      <Share2 className="w-4 h-4" />
                      Share
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1 gap-2 border-border hover:bg-accent dark:border-brand/20 dark:hover:bg-brand/10" onClick={handleCopyShareLink} data-testid="button-copy-share-link">
                      <Copy className="w-4 h-4" />
                      Copy Link
                    </Button>
                    <Button variant="outline" className="flex-1 gap-2 border-border hover:bg-accent dark:border-brand/20 dark:hover:bg-brand/10" onClick={handleCopyShareCode} data-testid="button-copy-share-code">
                      <Copy className="w-4 h-4" />
                      Copy Code
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/50 text-center leading-relaxed">
                    Anyone with the link or code can import this feed into their Relay Outpost
                  </p>
                </>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={shareDialogOpen} onOpenChange={(open) => { setShareDialogOpen(open); if (!open) setSharingFeed(null); }}>
          <DialogContent className="glass-dialog-card sm:max-w-md border-border dark:border-brand/15">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
                  <Share2 className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-semibold">Share Feed</DialogTitle>
                  <DialogDescription className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">
                    Let others import your feed config
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            {feedToShare && (
              <div className="space-y-4 pt-1">
                <div className="rounded-lg border border-border dark:border-brand/15 bg-accent/40 dark:bg-brand/[0.03] p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    {isValidFeedIconKey(feedToShare.icon) ? <FeedIconSvg iconKey={feedToShare.icon} className="w-5 h-5 text-brand" /> : <Radio className="w-5 h-5 text-brand/70" />}
                    <span className="text-sm font-semibold text-foreground truncate">{feedToShare.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {feedToShare.hashtags.map(t => <Badge key={t} variant="secondary" className="text-[11px] bg-accent text-brand border-brand/20 dark:bg-brand/10">#{t}</Badge>)}
                    {feedToShare.includeKeywords.map(k => <Badge key={k} variant="outline" className="text-[11px] border-emerald-500/20 text-emerald-800 dark:text-emerald-400">{k}</Badge>)}
                    {feedToShare.excludeKeywords.map(k => <Badge key={k} variant="outline" className="text-[11px] border-red-500/20 text-red-700 dark:text-red-400 line-through">{k}</Badge>)}
                    {feedToShare.authorPubkeys.length > 0 && <Badge variant="outline" className="text-[11px] border-blue-500/20 text-blue-700 dark:text-blue-400"><Users className="w-3 h-3 mr-1" />{feedToShare.authorPubkeys.length} {feedToShare.authorPubkeys.length === 1 ? "person" : "people"}</Badge>}
                    {feedToShare.contentType !== "all" && <Badge variant="outline" className="text-[11px] border-brand/20 text-brand">{feedToShare.contentType === "text_only" ? "Text" : feedToShare.contentType === "media" ? "Media" : "Links"}</Badge>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {typeof navigator.share === "function" ? (
                    <>
                      <Button className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white" onClick={handleNativeShare} data-testid="button-native-share">
                        <Share2 className="w-4 h-4" />
                        Share
                      </Button>
                      <Button variant="outline" className="gap-2 border-border hover:bg-accent dark:border-brand/20 dark:hover:bg-brand/10" onClick={handleCopyShareLink} data-testid="button-copy-share-link">
                        <Copy className="w-4 h-4" />
                        Copy Link
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white" onClick={handleCopyShareLink} data-testid="button-copy-share-link">
                        <Share2 className="w-4 h-4" />
                        Copy Share Link
                      </Button>
                      <Button variant="outline" className="gap-2 border-border hover:bg-accent dark:border-brand/20 dark:hover:bg-brand/10" onClick={handleCopyShareCode} data-testid="button-copy-share-code">
                        <Copy className="w-4 h-4" />
                        Code
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/50 text-center leading-relaxed">
                  Anyone with the link or code can import this feed into their Relay Outpost
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {isMobile ? (
        <Drawer open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DrawerContent className="glass-dialog-card border-border dark:border-brand/15">
            <DrawerHeader className="pb-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
                  <Download className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <DrawerTitle className="text-sm font-semibold text-foreground">Import Feed</DrawerTitle>
                  <p className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">Paste a share link or code from another user</p>
                </div>
              </div>
            </DrawerHeader>
            <div className="px-4 pb-6 space-y-4">
              <Input
                placeholder="Paste feed code or link..."
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="text-base bg-accent/40 dark:bg-white/[0.03] border-border dark:border-brand/20 focus-visible:border-brand/40 placeholder:text-muted-foreground/30"
                data-testid="input-import-feed"
              />
              <Button
                className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white"
                onClick={() => handleImportFeed(importText)}
                disabled={!importText.trim() || isImporting}
                data-testid="button-confirm-import"
              >
                {isImporting ? <RelayOutpostInlineLoader /> : <Download className="w-4 h-4" />}
                {isImporting ? "Importing..." : "Import Feed"}
              </Button>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="glass-dialog-card sm:max-w-md border-border dark:border-brand/15">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-accent dark:bg-brand/10">
                  <Download className="w-4 h-4 text-brand" />
                </div>
                <div>
                  <DialogTitle className="text-sm font-semibold">Import Feed</DialogTitle>
                  <DialogDescription className="text-[11px] text-brand/60 dark:text-brand/40 mt-0.5">
                    Paste a share link or code from another user
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <Input
                placeholder="Paste feed code or link..."
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className="bg-accent/40 dark:bg-white/[0.03] border-border dark:border-brand/20 focus-visible:border-brand/40 placeholder:text-muted-foreground/30"
                data-testid="input-import-feed"
              />
            </div>
            <DialogFooter>
              <Button
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground dark:bg-brand dark:hover:bg-brand dark:text-white"
                onClick={() => handleImportFeed(importText)}
                disabled={!importText.trim() || isImporting}
                data-testid="button-confirm-import"
              >
                {isImporting ? <RelayOutpostInlineLoader /> : <Download className="w-4 h-4" />}
                {isImporting ? "Importing..." : "Import Feed"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
    </ParentUnresolvedContext.Provider>
  );
}
