import { useWiderNetwork } from "@/lib/network-mode";
import { OttoEmpty } from "@/components/OttoEmpty";
import { WiderNetworkDoor } from "@/components/wider-network/WiderNetworkDoor";
import React, { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { SEARCH_RELAYS } from "@/lib/relay-constants";
import { useLocation, useSearch, Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { NostrPost } from "@/components/NostrPost";
import { PostBoundary } from "@/components/PostBoundary";
import { Nip05Badge } from "@/components/Nip05Badge";
import { MissionBriefing, LIVE_STREAMS_BRIEFING } from "@/components/MissionBriefing";
import { SuggestedFollowsStrip } from "@/components/SuggestedFollowsStrip";
import { VirtualFeed } from "@/components/VirtualFeed";
import { SearchPill } from "@/components/SearchPill";
import { NewsIcon } from "@/components/icons/NewsIcon";
import { searchUsersWithStatus, getLastBrainstormWotScores, fetchTrendingHashtags, fetchTrendingFeed, searchNostr, searchNostrPaginated, type TrendingHashtag, type SearchUsersStatus, primalStatsCache } from "@/lib/primal-cache";
import { discoverByTopic } from "@/lib/brainstorm-search";
import { lookupProfileDirect } from "@/lib/profile-direct";
import { searchArchivesEvents, fetchTopNotes, type ArchivesSortOption, type ArchivesEvent, type TopNoteMetric, type TopNoteRange } from "@/lib/nostr-archives";
import { getRelaysForPurpose, pool, DEFAULT_RELAYS, fetchProfilesCached, eventStore, publishEvent, verifySignedEventKind } from "@/lib/nostr";
import { queryAnswered } from "@/lib/relay-reach";
import { getDisplayName, getAvatarUrl, getProfileContent, formatNpub, shortenNpub, KIND_LIVE_EVENT, KIND_METADATA, KIND_FOLLOW_LIST, LIVE_STREAM_RELAYS } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { GuestWall } from "@/components/GuestWall";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { getSignalTier, getSignalTierRingColor, type SignalTier } from "@/lib/graperank";
import { getTrustPhrase, getTrustMark } from "@/lib/trust-words";
import { TrustMark, TrustPhrase, useTrustTierOf } from "@/components/TrustMark";
import { TrustTierGlyph } from "@/components/nostr-post/trust-tier-glyph";
import { isMutedPubkey, isReportedPubkey, isReportedEvent } from "@/lib/spam-filter";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { useNostrMuteList } from "@/hooks/use-nostr-mute-list";

import { useNostrFeeds } from "@/hooks/use-nostr-feeds";
import { useFollowedHashtags } from "@/hooks/use-followed-hashtags";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Segment } from "@/components/Segment";
import {
  Search as SearchIcon,
  Users,
  FileText,
  Hash,
  X,
  Radio,
  Globe,
  Zap,
  TrendingUp,
  Signal,
  Activity,
  Eye,
  Bookmark,
  Check,
  Play,
  Coffee,
  Palette,
  Code2,
  Compass,
  ShieldCheck,
  Brain,
  BookOpen,
  Heart,
  Lock,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageCircle,
  Calendar as CalendarIcon,
  ChevronRight,
  User as UserIcon,
  Music,
  Image as ImageIcon,
  Video,
  Film,
} from "lucide-react";
import {
  searchCalendarEvents,
  getCalendarEventDate,
  safeString,
  type CalendarEventData,
} from "@/lib/calendar-events";
import { EventCard } from "@/components/EventCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ShareEventDialog } from "@/components/ShareEventDialog";
import { searchUsers as searchUsersNip50 } from "@/lib/primal-cache";
import { searchCachedProfiles } from "@/lib/nostr";
import { BtcZapIcon } from "@/components/nostr-post/author-hover";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopOptionsPopover } from "@/components/DesktopOptionsPopover";
import { PageTabs } from "@/components/PageTabs";
import { ActivityIndicator, activityCache } from "@/components/ActivityIndicator";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useStreamLiveness } from "@/hooks/use-stream-liveness";
import { useToast } from "@/hooks/use-toast";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { lazyRetry } from "@/lib/lazy-retry";
import {
  queryWithTimeout,
  getSessionCache, setSessionCache,
} from "@/lib/follow-packs";

class ProfileCardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

type SearchTab = "people" | "posts" | "hashtags" | "media" | "live" | "events" | "vouches";

// Media sub-types live under the "Media" primary tab (?tab=media&type=…).
// Articles/Images/Videos reuse the standalone feed pages (rendered embedded);
// Audio/News reuse the in-page AudioTab/RssTab below.
type MediaType = "articles" | "images" | "videos" | "audio" | "news";
const MEDIA_TYPES: { key: MediaType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  // Images leads — it's the default view and the most visual entry point.
  { key: "images", label: "Photos", icon: ImageIcon },
  { key: "articles", label: "Articles", icon: BookOpen },
  { key: "audio", label: "Audio", icon: Music },
  { key: "videos", label: "Videos", icon: Video },
  // News stays in this list so ?type=news still resolves (the sidebar News link),
  // but it is intentionally NOT rendered as a hub chip and the sub-tab row is
  // hidden entirely on News — News is its own standalone reader, not a media tab.
  { key: "news", label: "News", icon: NewsIcon },
];
// Lazy so the heavy feed bundles only load when the Media tab opens. Every
// sub-type renders the FULL standalone page in embedded mode — so Audio gets
// Wavlake browsing / artist+album/podcasts and News gets the whole feed
// directory, identical to the old dedicated pages.
const ArticlesFeedLazy = lazy(() => lazyRetry(() => import("./ArticlesFeed")));
const ImagesFeedLazy = lazy(() => lazyRetry(() => import("./ImagesFeed")));
const VideoFeedLazy = lazy(() => lazyRetry(() => import("./VideoFeed")));
const AudioFeedLazy = lazy(() => lazyRetry(() => import("./AudioFeed")));
const RSSFeedLazy = lazy(() => lazyRetry(() => import("./RSSFeed")));

const LIVE_EVENT_RELAYS = [
  "wss://relay.zap.stream",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
  "wss://nos.lol",
];



interface LiveEventInfo {
  id: string;
  title: string;
  summary?: string;
  image?: string;
  status: "live" | "planned" | "ended";
  host?: string;
  hostPubkey?: string;
  starts?: number;
  streaming?: string;
  participants?: number;
  tags: string[];
  event: Event;
}

function parseLiveEvent(event: Event): LiveEventInfo | null {
  const dTag = event.tags.find(t => t[0] === "d")?.[1];
  if (!dTag) return null;
  const title = event.tags.find(t => t[0] === "title")?.[1] || "Untitled Stream";
  const summary = event.tags.find(t => t[0] === "summary")?.[1];
  const image = event.tags.find(t => t[0] === "image")?.[1];
  const statusTag = event.tags.find(t => t[0] === "status")?.[1];
  const status = statusTag === "live" ? "live" : statusTag === "planned" ? "planned" : "ended";
  const host = event.tags.find(t => t[0] === "p" && t[3] === "host")?.[1];
  const streaming = event.tags.find(t => t[0] === "streaming")?.[1];
  const starts = event.tags.find(t => t[0] === "starts")?.[1];
  const currentParticipants = event.tags.find(t => t[0] === "current_participants")?.[1];
  const participants = currentParticipants ? parseInt(currentParticipants, 10) : undefined;
  const tags = event.tags.filter(t => t[0] === "t").map(t => t[1]).filter(Boolean);
  return {
    id: event.id, title, summary, image, status,
    host, hostPubkey: event.pubkey,
    starts: starts ? parseInt(starts) : undefined,
    streaming, participants: participants && !isNaN(participants) ? participants : undefined, tags, event,
  };
}

const TAB_CONFIG: { key: SearchTab; label: string; icon: typeof FileText }[] = [
  { key: "people", label: "People", icon: Users },
  { key: "posts", label: "Posts", icon: FileText },
  { key: "media", label: "Media", icon: Film },
  { key: "live", label: "Live", icon: Radio },
  { key: "hashtags", label: "Hashtags", icon: Hash },
  { key: "events", label: "Events", icon: CalendarIcon },
  // "Vouches" is hidden for public beta — the tab/card only had a "Coming Soon"
  // placeholder. The SearchTab type, URL alias, and VouchesTab component are
  // left in place so it's a one-line re-enable once the feature ships.
];

const SEARCH_PAGE_SIZE = 30;

const LEGACY_FILTER_TO_TAB: Record<string, SearchTab> = {
  hashtags: "hashtags",
  posts: "posts",
  people: "people",
  users: "people",
  live: "live",
  events: "events",
  vouches: "vouches",
};

// Old standalone media routes (and the former rss/audio primary tabs) now resolve
// to the Media hub with a specific sub-type.
const LEGACY_TAB_TO_MEDIA: Record<string, MediaType> = {
  rss: "news",
  news: "news",
  audio: "audio",
  music: "audio",
  images: "images",
  videos: "videos",
  articles: "articles",
};

function parseTabParam(raw: string | null, filters?: string | null): SearchTab {
  if (raw && TAB_CONFIG.some(t => t.key === raw)) return raw as SearchTab;
  if (filters) {
    const mapped = LEGACY_FILTER_TO_TAB[filters.toLowerCase()];
    if (mapped) return mapped;
  }
  return "people";
}

function parseMediaType(raw: string | null): MediaType {
  // Media is a visual hub, so it opens on Images (a grid) when no explicit ?type=
  // is set — instantly reads as "media" and differentiates from the News list.
  // ?type=news still resolves and renders for the sidebar News link.
  return raw && MEDIA_TYPES.some(m => m.key === raw) ? (raw as MediaType) : "images";
}

// Resolve the active primary tab + media sub-type from the URL params, mapping
// legacy single-tab media values (?tab=rss, ?tab=audio, ?tab=images, …) into the
// Media hub so old links keep working.
function resolveTabAndType(params: URLSearchParams): { tab: SearchTab; type: MediaType } {
  const rawTab = params.get("tab");
  if (rawTab && rawTab in LEGACY_TAB_TO_MEDIA) {
    const legacy = LEGACY_TAB_TO_MEDIA[rawTab];
    // Prefer an explicit ?type= when present (e.g. /search?tab=media&type=images).
    const explicit = params.get("type");
    return { tab: "media", type: explicit && MEDIA_TYPES.some(m => m.key === explicit) ? (explicit as MediaType) : legacy };
  }
  return { tab: parseTabParam(rawTab, params.get("filters")), type: parseMediaType(params.get("type")) };
}

function useSearchUrl() {
  const searchStr = useSearch();
  const [, setLocation] = useLocation();

  const updateUrl = useCallback((updates: { tab?: SearchTab; q?: string | null; type?: MediaType | null; replace?: boolean }) => {
    const p = new URLSearchParams(searchStr);
    if (updates.tab) p.set("tab", updates.tab);
    if (updates.q !== undefined) {
      if (updates.q) p.set("q", updates.q);
      else p.delete("q");
    }
    if (updates.type !== undefined) {
      if (updates.type) p.set("type", updates.type);
      else p.delete("type");
    }
    const shouldReplace = updates.replace ?? false;
    setLocation(`/search?${p.toString()}`, { replace: shouldReplace });
  }, [searchStr, setLocation]);

  const params = new URLSearchParams(searchStr);
  return { searchStr, params, updateUrl };
}

export default function Search() {
  const { searchStr, params, updateUrl } = useSearchUrl();
  const { pubkey: viewerPubkey } = useNostrAuth();
  const searchWiderNetworkOn = useWiderNetwork(viewerPubkey);
  useDocumentTitle("Search");
  const urlQuery = params.get("q") || "";
  const { tab: initialTab, type: mediaType } = resolveTabAndType(params);

  const [activeTab, setActiveTab] = useState<SearchTab>(initialTab);

  // The Media hub is its own focused destination (reached via the sidebar's
  // Media/News entries), so it drops the generic Discover chrome (heading +
  // primary-tab selector) and lets MediaTab own its header — the sub-type chips
  // ARE the tabs. People/Posts/etc. are reached via the Search entry instead.
  const isMediaHub = activeTab === "media";

  const handleTabChange = useCallback((tab: SearchTab) => {
    setActiveTab(tab);
    // Leaving Media drops the lingering ?type= so other tabs' URLs stay clean.
    updateUrl({ tab, type: tab === "media" ? undefined : null });
  }, [updateUrl]);

  useEffect(() => {
    const { tab } = resolveTabAndType(new URLSearchParams(searchStr));
    setActiveTab(tab);
  }, [searchStr]);

  // Search is the one purely-exploratory surface, so guests meet the wall
  // outright (the legacy-social model: the linked content renders, the browse
  // is membership). All hooks above have already run — this gates the RENDER,
  // never the rules of hooks. Guest previews of rooms/threads/articles are
  // separate routes and stay open.
  if (!viewerPubkey) {
    return (
      <div className="px-3 sm:px-4 py-4 sm:py-6" data-testid="page-search">
        <div className="max-w-2xl mx-auto pt-8">
          <GuestWall context="Search is for members" />
        </div>
      </div>
    );
  }

  // overflow-x-CLIP (not hidden): hidden promotes the page root into a scroll
  // container on both axes, which clips the absolutely-positioned people
  // typeahead on iOS; clip crops the x-axis without creating a scroller.
  return (
    <div className="px-3 sm:px-4 py-4 sm:py-6 overflow-x-clip" data-testid="page-search">
      <div className="max-w-2xl mx-auto">
        {/* No page title — the tab selector + search box ARE the page; content
            starts immediately (same declutter as Feed/Outposts/Alerts). */}
        {/* Media is reached via the sidebar (its own focused hub), not from the
            Search tab selector — ?tab=media still resolves for those links.
            ONE PageTabs row now serves both breakpoints (the old mobile
            dropdown is gone). */}
        {!isMediaHub && (
        <PageTabs
          className="mb-4"
          testId="container-search-tabs"
          ariaLabel="Search sections"
          active={activeTab}
          onChange={(key) => handleTabChange(key as SearchTab)}
          tabs={TAB_CONFIG.filter(tab => tab.key !== "media" && tab.key !== "posts").map(tab => ({
            key: tab.key,
            label: tab.label,
            icon: tab.icon,
          }))}
        />
        )}

        {/* Finding a person is your space (a friend to follow); every other
            kind of result is the wider network and stands behind its door
            while that is off (owner, 2026-10-10; lib/network-mode.ts). */}
        {activeTab === "people" && <PeopleTab urlQuery={urlQuery} updateUrl={updateUrl} />}
        {activeTab !== "people" && !searchWiderNetworkOn && <div className="pt-2"><WiderNetworkDoor testId="wider-network-door-search" /></div>}
        {searchWiderNetworkOn && activeTab === "posts" && <PostsTab urlQuery={urlQuery} updateUrl={updateUrl} />}
        {searchWiderNetworkOn && activeTab === "hashtags" && <HashtagsTab urlQuery={urlQuery} updateUrl={updateUrl} />}
        {searchWiderNetworkOn && activeTab === "media" && <MediaTab mediaType={mediaType} urlQuery={urlQuery} updateUrl={updateUrl} />}
        {searchWiderNetworkOn && activeTab === "live" && <LiveTab urlQuery={urlQuery} updateUrl={updateUrl} />}
        {searchWiderNetworkOn && activeTab === "events" && <EventsTab urlQuery={urlQuery} updateUrl={updateUrl} />}
        {activeTab === "vouches" && <VouchesTab urlQuery={urlQuery} updateUrl={updateUrl} />}
      </div>
    </div>
  );
}

// The "Media hub": one primary tab that reveals Articles / Images / Videos /
// Audio / News. Articles/Images/Videos reuse the standalone feed pages rendered
// in embedded mode; Audio/News reuse the in-page AudioTab/RssTab. Sub-type is in
// the URL as ?type= so it deep-links and survives reload.
function MediaTab({ mediaType, urlQuery, updateUrl }: TabProps & { mediaType: MediaType }) {
  // Sort is owned HERE so the hub stays one row: passing `sort` to the embedded
  // Images/Videos feeds hides their internal "Trending ▾" chip row entirely
  // (same externally-controlled mechanism the Home feed macro uses). Tapping the
  // active Images/Videos pill (the one showing ⌄) opens the sort sheet —
  // uniform with the Home feed pills.
  const [mediaSort, setMediaSort] = useState<"trending" | "latest">("trending");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const sortableTypes: MediaType[] = ["images", "videos"];
  const isMobile = useIsMobile();
  // Attached to the active media sub-tab pill so the desktop sort popover drops
  // from it (mobile keeps the bottom sheet).
  const mediaTabAnchorRef = useRef<HTMLButtonElement>(null);
  const sortOptionsBody = (
    <Segment
      label="Sort"
      options={[{ value: "trending", label: "Trending" }, { value: "latest", label: "Latest" }]}
      value={mediaSort}
      onChange={(v) => { setMediaSort(v); setSortSheetOpen(false); }}
      testPrefix="media-sort"
    />
  );
  return (
    <div data-testid="media-hub">
      {/* News is its own destination (sidebar → ?type=news): render it as a clean
          reader with just its search + feed — no media sub-tab row. The hub row
          shows for the other media types only, and no longer lists News as a chip. */}
      {mediaType !== "news" && (
      <PageTabs
        className="mb-4"
        testId="container-media-subtypes"
        ariaLabel="Media types"
        activeTabRef={mediaTabAnchorRef}
        active={mediaType}
        onChange={(key) => {
          const k = key as MediaType;
          if (k === mediaType && sortableTypes.includes(k)) setSortSheetOpen(true);
          else updateUrl({ type: k });
        }}
        tabs={MEDIA_TYPES.filter(m => m.key !== "news").map(m => ({
          key: m.key,
          label: m.label,
          icon: m.icon,
          testId: `media-type-${m.key}`,
          badge: mediaType === m.key && sortableTypes.includes(m.key) ? (
            <ChevronDown className="w-3 h-3 shrink-0 opacity-80" aria-hidden="true" />
          ) : undefined,
        }))}
      />
      )}
      {isMobile ? (
        <Sheet open={sortSheetOpen} onOpenChange={setSortSheetOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]" data-testid="media-sort-sheet">
            <SheetTitle className="text-sm mb-4 font-medium">
              {mediaType === "videos" ? "Videos" : "Photos"} options
            </SheetTitle>
            {sortOptionsBody}
          </SheetContent>
        </Sheet>
      ) : (
        <DesktopOptionsPopover
          open={sortSheetOpen}
          onOpenChange={setSortSheetOpen}
          anchorRef={mediaTabAnchorRef}
          align="start"
          title={`${mediaType === "videos" ? "Videos" : "Photos"} options`}
          testId="media-sort-sheet"
          width="w-[300px]"
        >
          {sortOptionsBody}
        </DesktopOptionsPopover>
      )}
      <Suspense fallback={<div className="flex justify-center py-16"><RelayOutpostInlineLoader className="w-6 h-6" /></div>}>
        {mediaType === "news" && <RSSFeedLazy embedded />}
        {mediaType === "articles" && <ArticlesFeedLazy embedded />}
        {mediaType === "images" && <ImagesFeedLazy embedded sort={mediaSort} />}
        {mediaType === "audio" && <AudioFeedLazy embedded />}
        {mediaType === "videos" && <VideoFeedLazy embedded sort={mediaSort} />}
      </Suspense>
    </div>
  );
}

function TabSearchBar({ query, setQuery, onSubmit, onClear, loading, placeholder, autoFocus }: {
  query: string;
  setQuery: (q: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  loading: boolean;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    // Focus on mount: on iOS the keyboard was primed in the search-icon tap, so
    // this hands it off; on desktop it just places the cursor. rAF lets the
    // lazy-loaded page finish mounting first.
    const id = requestAnimationFrame(() => {
      try { inputRef.current?.focus({ preventScroll: true }); } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  // No detached submit button — Enter submits (implicit form submission) and
  // live typeahead covers the rest; loading/clear live in the trailing slot.
  return (
    <form onSubmit={handleSubmit} className="mb-4" data-testid="form-tab-search">
      <SearchPill
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="input-tab-search"
        trailing={(query || loading) ? (
          <span className="flex items-center">
            {loading && <RelayOutpostInlineLoader className="w-4 h-4 mr-1 text-brand" />}
            <button
              type="button"
              onClick={onClear}
              className="p-2 rounded-full hover:bg-muted/50 transition-colors"
              data-testid="button-tab-search-clear"
            >
              <X className="w-4 h-4 text-muted-foreground/80 hover:text-foreground" />
            </button>
          </span>
        ) : undefined}
      />
    </form>
  );
}

type TabProps = { urlQuery: string; updateUrl: (u: { tab?: SearchTab; q?: string | null; type?: MediaType | null; replace?: boolean }) => void };

function detectNostrIdentifier(input: string): { type: "npub" | "hex" | "nprofile" | "nip05"; pubkey: string | null } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return { type: "npub", pubkey: (decoded.data as string).toLowerCase() };
    } catch {}
    return null;
  }

  if (trimmed.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "nprofile") {
        const profileData = decoded.data as { pubkey: string; relays?: string[] };
        if (profileData.pubkey && /^[0-9a-f]{64}$/i.test(profileData.pubkey)) {
          return { type: "nprofile", pubkey: profileData.pubkey.toLowerCase() };
        }
      }
    } catch {}
    return null;
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return { type: "hex", pubkey: trimmed.toLowerCase() };
  }

  if (trimmed.includes("@") && !trimmed.startsWith("@") && trimmed.indexOf("@") < trimmed.length - 1) {
    const parts = trimmed.split("@");
    if (parts.length === 2 && parts[1].includes(".")) {
      return { type: "nip05", pubkey: null };
    }
  }

  return null;
}

const DOMAIN_REGEX = /^(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function isBareDomainQuery(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.includes(" ") || trimmed.includes("@") || trimmed.includes("/")) return false;
  if (!trimmed.includes(".")) return false;
  return DOMAIN_REGEX.test(trimmed);
}

export type Nip05ResolveFailureReason =
  | "invalid_identifier"
  | "safety_rejection"
  | "dns_failure"
  | "unreachable"
  | "timeout"
  | "no_wellknown"
  | "no_default_entry"
  | "no_entry"
  | "invalid_json"
  | "server_error"
  | "network_error";

export interface Nip05ResolveResult {
  pubkey: string | null;
  reason?: Nip05ResolveFailureReason;
  domain?: string;
}

function nip05ReasonMessage(reason: Nip05ResolveFailureReason | undefined, domain?: string): string | null {
  if (!reason) return null;
  const d = domain ? ` (${domain})` : "";
  switch (reason) {
    case "dns_failure": return `Domain did not resolve${d}.`;
    case "safety_rejection": return `Domain blocked by safety check${d}.`;
    case "unreachable": return `Domain is unreachable${d}.`;
    case "timeout": return `Domain timed out${d}.`;
    case "no_wellknown": return `No .well-known/nostr.json at${d || " domain"}.`;
    case "no_default_entry": return `No default (_) entry in the domain's NIP-05 file${d}.`;
    case "no_entry": return `NIP-05 file has no matching entry${d}.`;
    case "invalid_json": return `Domain's NIP-05 file is malformed${d}.`;
    case "invalid_identifier": return `Not a valid NIP-05 identifier.`;
    case "server_error": return `NIP-05 resolver hit an internal error.`;
    case "network_error": return `Could not reach NIP-05 service.`;
    default: return null;
  }
}

async function resolveNip05ToPubkey(identifier: string): Promise<Nip05ResolveResult> {
  try {
    const res = await fetch(`/api/nip05/resolve?identifier=${encodeURIComponent(identifier)}`, {
      signal: AbortSignal.timeout(6000),
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    if (res.ok && data?.pubkey) {
      return { pubkey: data.pubkey };
    }
    const reason = (data?.reason as Nip05ResolveFailureReason | undefined) || "network_error";
    return { pubkey: null, reason, domain: data?.domain };
  } catch {
    return { pubkey: null, reason: "network_error" };
  }
}

function PeopleTab({ urlQuery, updateUrl }: TabProps) {
  const tierOf = useTrustTierOf();
  const { pubkey, follows } = useNostrAuth();
  const { scores, loading: scoresLoading, wotEnabled, wotReady, requestScoresBulk, injectScores, followedByPubkeys, flaggedPubkeys } = useGrapeRankScores();
  const [query, setQuery] = useState(urlQuery);
  const [searchResults, setSearchResults] = useState<Event[]>([]);
  const [searched, setSearched] = useState(!!urlQuery);
  const [loading, setLoading] = useState(false);
  const [directMatch, setDirectMatch] = useState<{ event: Event; tier: SignalTier; influence: number | null } | null>(null);
  const [nip05Failure, setNip05Failure] = useState<{ reason: Nip05ResolveFailureReason; domain?: string } | null>(null);
  const [backendFailed, setBackendFailed] = useState(false);
  const [trendingProfiles, setTrendingProfiles] = useState<Event[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const trendingLoadedRef = useRef(false);
  const searchRequestRef = useRef(0);
  const [, setPeopleLocation] = useLocation();
  // Lightweight people typeahead (mirrors the EventsTab creator suggester):
  // instant local matches, then one debounced remote call with stale-cancel.
  const [peopleSuggest, setPeopleSuggest] = useState<Event[]>([]);
  const [showPeopleSuggest, setShowPeopleSuggest] = useState(false);
  const [peopleSuggestLoading, setPeopleSuggestLoading] = useState(false);
  const peopleSuggestSeq = useRef(0);
  const peopleSuggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peopleSearchWrapRef = useRef<HTMLDivElement>(null);
  // Keyboard-aware dropdown height: on iOS the software keyboard covers the
  // lower half of the layout viewport, so a fixed max-h-[300px] paints mostly
  // behind it. Cap the dropdown to the space between the input and the visual
  // viewport's bottom edge instead (min 160px so it never collapses to a sliver).
  const [suggestMaxH, setSuggestMaxH] = useState(300);
  const suggestScrolledRef = useRef(false);

  const followSet = useMemo(() => new Set(follows || []), [follows]);
  const [stalePubkeys, setStalePubkeys] = useState<Set<string>>(new Set());
  const staleCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setQuery(urlQuery);
    if (urlQuery) {
      setSearched(true);
    }
  }, [urlQuery]);

  // Live people typeahead: show instant cached matches as the user types, then
  // augment with one debounced remote search. Skips identifiers (npub/hex/NIP-05)
  // which resolve directly on submit instead.
  useEffect(() => {
    if (peopleSuggestDebounce.current) { clearTimeout(peopleSuggestDebounce.current); peopleSuggestDebounce.current = null; }
    const trimmed = query.trim();
    const looksLikeId = /^(npub1|nprofile1|nsec1)/i.test(trimmed) || /^[0-9a-f]{64}$/i.test(trimmed) || trimmed.includes("@");
    if (trimmed.length < 2 || looksLikeId) {
      setPeopleSuggest([]); setShowPeopleSuggest(false); setPeopleSuggestLoading(false);
      return;
    }
    const cached = searchCachedProfiles(trimmed, 6) as Event[];
    if (cached.length > 0) { setPeopleSuggest(cached); setShowPeopleSuggest(true); }
    setPeopleSuggestLoading(true);
    const seq = ++peopleSuggestSeq.current;
    peopleSuggestDebounce.current = setTimeout(async () => {
      try {
        const remote = await searchUsersNip50(trimmed, 6);
        if (seq !== peopleSuggestSeq.current) return;
        const seen = new Set<string>();
        const merged: Event[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) { seen.add(e.pubkey); merged.push(e); }
        }
        setPeopleSuggest(merged.slice(0, 6));
        if (merged.length > 0) setShowPeopleSuggest(true);
      } catch { /* keep cached results */ } finally {
        if (seq === peopleSuggestSeq.current) setPeopleSuggestLoading(false);
      }
    }, 280);
    return () => { if (peopleSuggestDebounce.current) clearTimeout(peopleSuggestDebounce.current); };
  }, [query]);

  // Close the dropdown on an outside click/touch (mousedown alone is unreliable
  // on iOS when the tap lands on a scrollable region).
  useEffect(() => {
    if (!showPeopleSuggest) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (peopleSearchWrapRef.current && !peopleSearchWrapRef.current.contains(e.target as Node)) {
        setShowPeopleSuggest(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [showPeopleSuggest]);

  // Size the open dropdown to the visible viewport (above the iOS keyboard) and,
  // if the input sits too low to leave usable room, scroll it to the top once.
  useEffect(() => {
    if (!showPeopleSuggest) { suggestScrolledRef.current = false; return; }
    const vv = window.visualViewport;
    const measure = () => {
      const wrap = peopleSearchWrapRef.current;
      if (!wrap) return;
      const inputBottom = wrap.getBoundingClientRect().bottom;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const room = Math.round(visibleBottom - inputBottom - 8);
      if (room < 160 && !suggestScrolledRef.current && window.innerWidth < 768) {
        // One nudge per open: bring the search bar to the top so the dropdown
        // gets the full strip above the keyboard.
        suggestScrolledRef.current = true;
        try { wrap.scrollIntoView({ block: "start", behavior: "smooth" }); } catch {}
      }
      setSuggestMaxH(Math.max(160, Math.min(300, room)));
    };
    measure();
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [showPeopleSuggest]);

  // Scroll-to-dismiss, gesture-safe: blur on the SCROLL event (capture phase
  // catches any scroll container). Blurring on touchmove collapsed the keyboard
  // mid-gesture, which made iOS cancel the pan — the page read as unscrollable.
  useEffect(() => {
    // NOTE: `Event` in this file is the Nostr event type — use EventListener.
    const onScroll: EventListener = (e) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement)) return;
      if (!peopleSearchWrapRef.current?.contains(active)) return;
      if (e.target instanceof Node && peopleSearchWrapRef.current?.contains(e.target)) return;
      active.blur();
    };
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  }, []);

  const pickPersonSuggestion = useCallback((ev: Event) => {
    setShowPeopleSuggest(false);
    try { setPeopleLocation(`/profile/${formatNpub(ev.pubkey)}`); } catch {}
  }, [setPeopleLocation]);

  useEffect(() => {
    if (trendingLoadedRef.current) return;
    trendingLoadedRef.current = true;

    const cached = getSessionCache<Event[]>("search_trending_profiles_v1");
    if (cached) {
      setTrendingProfiles(cached);
      setTrendingLoading(false);
      return;
    }

    (async () => {
      try {
        const posts = await fetchTrendingFeed("trending_4h", undefined, 100);
        const uniqueAuthors = new Set<string>();
        const authorList: string[] = [];
        for (const p of posts) {
          if (!uniqueAuthors.has(p.pubkey)) {
            uniqueAuthors.add(p.pubkey);
            authorList.push(p.pubkey);
          }
        }
        const profilePks = authorList.slice(0, 60);
        if (profilePks.length > 0) await fetchProfilesCached(profilePks);

        await new Promise(r => setTimeout(r, 500));

        const profileEvents: Event[] = [];
        for (const pk of profilePks) {
          const profile = eventStore.getReplaceable(KIND_METADATA, pk);
          if (profile) profileEvents.push(profile);
        }

        setTrendingProfiles(profileEvents);
        setSessionCache("search_trending_profiles_v1", profileEvents);
      } catch {
      } finally {
        setTrendingLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (wotEnabled && scores && trendingProfiles.length > 0) {
      const pks = trendingProfiles.map(p => p.pubkey).filter(pk => !scores.has(pk));
      if (pks.length > 0) requestScoresBulk(pks);
    }
  }, [wotEnabled, scores, trendingProfiles, requestScoresBulk]);

  useEffect(() => {
    if (wotEnabled && scores && searchResults.length > 0) {
      const pks = searchResults.map(p => p.pubkey).filter(pk => !scores.has(pk));
      if (pks.length > 0) requestScoresBulk(pks);
    }
  }, [wotEnabled, scores, searchResults, requestScoresBulk]);

  const applyBrainstormScores = useCallback(() => {
    const brainstormScores = getLastBrainstormWotScores();
    if (brainstormScores && brainstormScores.size > 0) {
      injectScores(brainstormScores);
    }
  }, [injectScores]);

  const handleDirectMatchResolved = useCallback((event: Event | null, inf: number | null) => {
    if (!event) return;
    const tier: SignalTier = flaggedPubkeys?.has(event.pubkey) ? "flagged" : getSignalTier(inf);
    setDirectMatch({ event, tier, influence: inf });
    if (inf !== null) {
      const wotMap = new Map<string, number | null>();
      wotMap.set(event.pubkey, inf);
      injectScores(wotMap);
    }
  }, [flaggedPubkeys, injectScores]);

  const executeSearch = useCallback(async (q?: string, fromUrl = false) => {
    const searchQuery = q ?? query;
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    const requestId = ++searchRequestRef.current;
    setLoading(true);
    setSearched(true);
    setDirectMatch(null);
    setNip05Failure(null);
    setBackendFailed(false);
    if (!fromUrl) updateUrl({ q: trimmed });

    const identifier = detectNostrIdentifier(trimmed);
    const bareDomain = !identifier && isBareDomainQuery(trimmed);

    if (identifier) {
      try {
        let textSearchFailed = false;
        const textSearchPromise = searchUsersWithStatus(trimmed, 100)
          .catch(() => {
            textSearchFailed = true;
            return { events: [], attempted: 0, reachable: 0, allBackendsFailed: true } as SearchUsersStatus;
          });

        let resolvedPubkey = identifier.pubkey;
        let nip05Result: Nip05ResolveResult | null = null;

        if (identifier.type === "nip05" && !resolvedPubkey) {
          const [nip05] = await Promise.all([
            resolveNip05ToPubkey(trimmed),
            textSearchPromise.then(() => undefined),
          ]);
          nip05Result = nip05;
          resolvedPubkey = nip05Result.pubkey;
        }

        if (searchRequestRef.current !== requestId) return;

        if (resolvedPubkey) {
          const [directResult, status] = await Promise.all([
            lookupProfileDirect(resolvedPubkey),
            textSearchPromise,
          ]);
          if (searchRequestRef.current !== requestId) return;
          handleDirectMatchResolved(directResult.event, directResult.wotScore);
          const filtered = status.events.filter(e => e.pubkey !== resolvedPubkey);
          setSearchResults(filtered);
          applyBrainstormScores();
          if ((textSearchFailed || status.allBackendsFailed) && !directResult.event) setBackendFailed(true);
        } else {
          const status = await textSearchPromise;
          if (searchRequestRef.current !== requestId) return;
          setSearchResults(status.events);
          applyBrainstormScores();
          if (nip05Result?.reason) {
            setNip05Failure({ reason: nip05Result.reason, domain: nip05Result.domain });
          }
          if (textSearchFailed || status.allBackendsFailed) setBackendFailed(true);
        }
      } catch {
        if (searchRequestRef.current === requestId) {
          setSearchResults([]);
          setBackendFailed(true);
        }
      } finally {
        if (searchRequestRef.current === requestId) setLoading(false);
      }
    } else if (bareDomain) {
      try {
        let textSearchFailed = false;
        const [nip05Result, status] = await Promise.all([
          resolveNip05ToPubkey(trimmed),
          searchUsersWithStatus(trimmed, 100).catch(() => {
            textSearchFailed = true;
            return { events: [], attempted: 0, reachable: 0, allBackendsFailed: true } as SearchUsersStatus;
          }),
        ]);

        if (searchRequestRef.current !== requestId) return;

        if (nip05Result.pubkey) {
          const directResult = await lookupProfileDirect(nip05Result.pubkey);
          if (searchRequestRef.current !== requestId) return;
          handleDirectMatchResolved(directResult.event, directResult.wotScore);
          const filtered = status.events.filter(e => e.pubkey !== nip05Result.pubkey);
          setSearchResults(filtered);
        } else {
          setSearchResults(status.events);
          if (nip05Result.reason) {
            setNip05Failure({ reason: nip05Result.reason, domain: nip05Result.domain || trimmed });
          }
        }
        applyBrainstormScores();
        if (textSearchFailed || status.allBackendsFailed) setBackendFailed(true);
      } catch {
        if (searchRequestRef.current === requestId) {
          setSearchResults([]);
          setBackendFailed(true);
        }
      } finally {
        if (searchRequestRef.current === requestId) setLoading(false);
      }
    } else {
      try {
        const status = await searchUsersWithStatus(trimmed, 100);
        if (searchRequestRef.current !== requestId) return;
        setSearchResults(status.events);
        applyBrainstormScores();
        if (status.allBackendsFailed) setBackendFailed(true);
      } catch {
        if (searchRequestRef.current === requestId) {
          setSearchResults([]);
          setBackendFailed(true);
        }
      } finally {
        if (searchRequestRef.current === requestId) setLoading(false);
      }
    }
  }, [query, updateUrl, applyBrainstormScores, handleDirectMatchResolved]);

  const handleClear = () => {
    ++searchRequestRef.current;
    setQuery("");
    setSearched(false);
    setSearchResults([]);
    setDirectMatch(null);
    setLoading(false);
    updateUrl({ q: null });
  };


  const prevUrlQueryRef = useRef("");
  useEffect(() => {
    if (urlQuery !== prevUrlQueryRef.current) {
      if (urlQuery) {
        executeSearch(urlQuery, true);
      } else {
        setQuery("");
        setSearched(false);
        setSearchResults([]);
      }
    }
    prevUrlQueryRef.current = urlQuery;
  }, [urlQuery]);

  const [profilesFetched, setProfilesFetched] = useState(false);

  const scoredPubkeysLive = useMemo(() => {
    if (!wotEnabled || !scores || scores.size === 0) return [];
    const buckets: Record<string, { pk: string; influence: number }[]> = {
      strong: [], moderate: [], low: [], weak: [], flagged: [],
    };
    const seen = new Set<string>();
    for (const [pk, influence] of scores) {
      if (followSet.has(pk) || pk === pubkey) continue;
      seen.add(pk);
      if (flaggedPubkeys?.has(pk)) {
        buckets.flagged.push({ pk, influence });
        continue;
      }
      const tier = getSignalTier(influence);
      if (tier === "none" || !buckets[tier]) continue;
      buckets[tier].push({ pk, influence });
    }
    if (flaggedPubkeys) {
      for (const pk of flaggedPubkeys) {
        if (seen.has(pk) || followSet.has(pk) || pk === pubkey) continue;
        buckets.flagged.push({ pk, influence: 0 });
      }
    }
    // Deterministic: take the top of each tier by influence (stable pubkey
    // tie-break). No Math.random — the list must not reshuffle every time a new
    // WoT score streams in, or the suggestions visibly churn under the reader.
    const limits: [string, number][] = [["strong", 30], ["moderate", 30], ["low", 25], ["weak", 15], ["flagged", 10]];
    const tierArrays: { pk: string; influence: number }[][] = [];
    let overflow = 0;
    for (const [key, base] of limits) {
      const cap = base + overflow;
      const taken = buckets[key]
        .slice()
        .sort((a, b) => b.influence - a.influence || (a.pk < b.pk ? -1 : 1))
        .slice(0, cap);
      tierArrays.push(taken);
      overflow = cap - taken.length;
    }
    const result: { pk: string; influence: number }[] = [];
    const indices = tierArrays.map(() => 0);
    let added = true;
    while (added) {
      added = false;
      for (let t = 0; t < tierArrays.length; t++) {
        if (indices[t] < tierArrays[t].length) {
          result.push(tierArrays[t][indices[t]]);
          indices[t]++;
          added = true;
        }
      }
    }
    return result;
  }, [scores, wotEnabled, followSet, pubkey, flaggedPubkeys]);

  // Freeze the suggestion membership + order once it's meaningfully populated, so
  // continued WoT-score streaming (and the periodic stale-check) stop swapping
  // users in and out under the reader. Influence/tier still refine for badges.
  const [frozenSuggestionPks, setFrozenSuggestionPks] = useState<string[] | null>(null);
  useEffect(() => {
    if (frozenSuggestionPks || !wotEnabled) return;
    if (scoredPubkeysLive.length >= 12 || (!scoresLoading && scoredPubkeysLive.length > 0)) {
      setFrozenSuggestionPks(scoredPubkeysLive.map((s) => s.pk));
    }
  }, [scoredPubkeysLive, frozenSuggestionPks, wotEnabled, scoresLoading]);

  const scoredPubkeys = useMemo(() => {
    if (!frozenSuggestionPks) return scoredPubkeysLive;
    const inf = new Map(scoredPubkeysLive.map((s) => [s.pk, s.influence]));
    return frozenSuggestionPks
      .filter((pk) => !followSet.has(pk))
      .map((pk) => ({ pk, influence: inf.get(pk) ?? scores?.get(pk) ?? 0 }));
  }, [frozenSuggestionPks, scoredPubkeysLive, followSet, scores]);

  useEffect(() => {
    if (scoredPubkeys.length === 0) return;
    let cancelled = false;
    const pksToFetch = scoredPubkeys.map(s => s.pk);
    fetchProfilesCached(pksToFetch);
    let attempt = 0;
    const poll = () => {
      if (cancelled) return;
      attempt++;
      const loaded = pksToFetch.some(pk => eventStore.getReplaceable(KIND_METADATA, pk));
      if (loaded || attempt >= 6) {
        setProfilesFetched(prev => !prev);
      } else {
        setTimeout(poll, 500);
      }
    };
    setTimeout(poll, 400);
    return () => { cancelled = true; };
  }, [scoredPubkeys]);

  const ACTIVITY_CUTOFF_SECONDS = 90 * 24 * 60 * 60;

  const discoveryProfiles = useMemo(() => {
    const hasPicture = (p: Event) => {
      try {
        const c = getProfileContent(p);
        return typeof c?.picture === "string" && c.picture.startsWith("http");
      } catch {
        return false;
      }
    };

    if (!wotEnabled || !scores || scores.size === 0) {
      // Stable order (trending order) — no random shuffle that churns on re-render.
      return trendingProfiles.filter(p => !followSet.has(p.pubkey) && p.pubkey !== pubkey && hasPicture(p) && !stalePubkeys.has(p.pubkey));
    }

    const scored: { event: Event; influence: number; tier: SignalTier }[] = [];
    for (const { pk, influence } of scoredPubkeys) {
      if (stalePubkeys.has(pk)) continue;
      const tier = getSignalTier(influence);
      const profile = eventStore.getReplaceable(KIND_METADATA, pk);
      if (profile && hasPicture(profile)) {
        scored.push({ event: profile, influence, tier });
      }
    }

    if (scored.length === 0) {
      return trendingProfiles.filter(p => !followSet.has(p.pubkey) && p.pubkey !== pubkey && hasPicture(p) && !stalePubkeys.has(p.pubkey));
    }

    return scored.map(s => s.event);
  }, [scores, wotEnabled, followSet, pubkey, trendingProfiles, scoredPubkeys, profilesFetched, stalePubkeys]);

  useEffect(() => {
    if (staleCheckRef.current) clearInterval(staleCheckRef.current);
    let runs = 0;
    const check = () => {
      runs++;
      const now = Math.floor(Date.now() / 1000);
      const newStale = new Set<string>();
      for (const [pk, data] of activityCache) {
        if (!data.lastSeen || (now - data.lastSeen) > ACTIVITY_CUTOFF_SECONDS) {
          newStale.add(pk);
        }
      }
      if (newStale.size !== stalePubkeys.size || [...newStale].some(pk => !stalePubkeys.has(pk))) {
        setStalePubkeys(newStale);
      }
      if (runs >= 20) {
        if (staleCheckRef.current) clearInterval(staleCheckRef.current);
      }
    };
    staleCheckRef.current = setInterval(check, 2000);
    const t = setTimeout(check, 800);
    return () => {
      clearTimeout(t);
      if (staleCheckRef.current) {
        clearInterval(staleCheckRef.current);
        staleCheckRef.current = null;
      }
    };
  }, [discoveryProfiles.length]);

  const groupedByTier = useMemo(() => {
    // wotReady: no tiered discovery until the observer's own calculation exists —
    // pre-ready scores misgroup everyone and left the caption over a blank list.
    if (!wotEnabled || !wotReady || !scores || scores.size === 0) return null;

    const groups: Record<string, { event: Event; influence: number }[]> = {
      strong: [],
      moderate: [],
      low: [],
      weak: [],
      flagged: [],
    };

    for (const profile of discoveryProfiles) {
      const influence = scores.get(profile.pubkey) ?? null;
      if (flaggedPubkeys?.has(profile.pubkey)) {
        groups.flagged.push({ event: profile, influence: influence ?? 0 });
        continue;
      }
      const tier = getSignalTier(influence);
      if (tier !== "none" && groups[tier]) {
        groups[tier].push({ event: profile, influence: influence ?? 0 });
      }
    }

    return groups;
  }, [discoveryProfiles, scores, wotEnabled, wotReady, flaggedPubkeys]);

  // Total rows the tiered view would actually render. When discoveryProfiles
  // fell back to trending (whose authors carry no tier score) every bucket is
  // empty even though discoveryProfiles is non-empty — the old render gated its
  // EmptyState on discoveryProfiles.length and showed a caption over blank space.
  const tieredCount = useMemo(() => {
    if (!groupedByTier) return 0;
    return Object.values(groupedByTier).reduce((n, arr) => n + arr.length, 0);
  }, [groupedByTier]);

  const searchProfilesWithTier = useMemo(() => {
    return searchResults.map(profile => {
      const influence = scores?.get(profile.pubkey) ?? null;
      const tier: SignalTier = flaggedPubkeys?.has(profile.pubkey) ? "flagged" : getSignalTier(influence);
      return { event: profile, tier, influence };
    });
  }, [searchResults, scores, flaggedPubkeys]);

  return (
    <div>
      <div ref={peopleSearchWrapRef} className="relative">
        <TabSearchBar
          query={query}
          setQuery={setQuery}
          onSubmit={() => { setShowPeopleSuggest(false); executeSearch(); }}
          onClear={handleClear}
          loading={loading}
          placeholder="Search by name or handle…"
          autoFocus={!urlQuery}
        />
        {showPeopleSuggest && peopleSuggest.length > 0 && (
          <div
            className="absolute z-50 left-0 right-0 -mt-2.5 rounded-lg shadow-lg border border-border/30 overflow-y-auto overscroll-contain bg-popover"
            style={{ maxHeight: suggestMaxH, WebkitOverflowScrolling: "touch" }}
            data-testid="dropdown-people-suggestions"
          >
            {peopleSuggest.map((ev) => {
              const name = getDisplayName(ev) || `npub1…${ev.pubkey.slice(-6)}`;
              const picture = getAvatarUrl(ev);
              let nip05 = "";
              try { nip05 = getProfileContent(ev)?.nip05 || ""; } catch {}
              return (
                <button
                  key={ev.pubkey}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickPersonSuggestion(ev)}
                  className="w-full flex min-h-11 items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/10 active:bg-primary/15 transition-colors"
                  data-testid={`suggest-person-${ev.pubkey.slice(0, 8)}`}
                >
                  <Avatar className="w-9 h-9 shrink-0 border border-border/30">
                    <AvatarImage src={picture} alt={name} />
                    <AvatarFallback className="bg-muted text-foreground/60">
                      <UserIcon className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{name}</div>
                    {nip05 && <div className="text-xs text-muted-foreground truncate">{nip05}</div>}
                  </div>
                </button>
              );
            })}
            <div className="px-3 py-1.5 text-[13px] text-muted-foreground text-center border-t border-border/20 font-medium">
              {peopleSuggestLoading ? "Searching…" : "Tap a person to open their profile"}
            </div>
          </div>
        )}
      </div>

      {searched ? (
        loading ? (
          <LoadingState message="Searching people..." />
        ) : !directMatch && searchProfilesWithTier.length === 0 ? (
          backendFailed ? (
            <div className="flex flex-col items-center justify-center py-14 text-center" data-testid="container-backend-failed">
              <OttoEmpty mood="looking" size={88} className="mb-3 text-foreground" />
              <p className="text-sm font-medium mb-1">Search backends unreachable</p>
              <p className="text-xs text-muted-foreground max-w-xs mb-3">
                We couldn't reach the search sources. Check your connection and try again.
              </p>
              {nip05Failure && (
                <p className="text-xs text-warning max-w-xs mb-3">
                  {nip05ReasonMessage(nip05Failure.reason, nip05Failure.domain)}
                </p>
              )}
              <button
                onClick={() => executeSearch(query, false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand/10 hover:bg-brand/15 border border-brand/20 text-xs font-medium text-brand transition-colors"
                data-testid="button-retry-search"
              >
                Retry search
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 text-center" data-testid="container-empty-results">
              <OttoEmpty mood="looking" size={88} className="mb-3 text-foreground" />
              <p className="text-sm font-medium mb-1">No people found</p>
              <p className="text-[13px] text-muted-foreground max-w-xs">
                Try different search terms or check the spelling.
              </p>
              {nip05Failure && (
                <p className="text-xs text-warning max-w-xs mt-3">
                  NIP-05 lookup: {nip05ReasonMessage(nip05Failure.reason, nip05Failure.domain)}
                </p>
              )}
              {/* Not a dead end for new users: a no-results people search still
                  offers a few accounts to follow (self-hides once you follow some). */}
              <SuggestedFollowsStrip className="mt-6" />
            </div>
          )
        ) : (
          <div className="space-y-6" data-testid="container-people-results">
            {directMatch && (
              <div data-testid="direct-match-section">
                <div className="flex items-center gap-1.5 mb-2">
                  <Signal className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-[14px] font-semibold text-foreground">Direct match</span>
                </div>
                <div className="rounded-[16px] border border-border/60 bg-card p-1.5">
                  <ProfileCardErrorBoundary>
                    <ProfileCard
                      profile={directMatch.event}
                      tier={directMatch.tier}
                      isFollowed={followSet.has(directMatch.event.pubkey)}
                      followsYou={followedByPubkeys?.has(directMatch.event.pubkey) ?? false}
                    />
                  </ProfileCardErrorBoundary>
                </div>
              </div>
            )}
            {searchProfilesWithTier.length > 0 && (
              <PeopleSearchResults
                profiles={searchProfilesWithTier}
                followSet={followSet}
                followedByPubkeys={followedByPubkeys}
              />
            )}
          </div>
        )
      ) : (
        <div data-testid="container-people-discovery">
          {/* "Explore by Topic" chips removed — discovery leads straight with
              the trusted-people list; topic search still works via the box. */}
          {(scoresLoading || trendingLoading) ? (
            <PeopleDiscoverySkeleton />
          ) : wotEnabled && groupedByTier && tieredCount > 0 ? (
            <div className="space-y-6">
              <p className="text-[13px] text-muted-foreground">People your network trusts that you haven't followed yet</p>
              {(["strong", "moderate", "low", "weak", "flagged"] as const).map(tierKey => {
                const items = groupedByTier[tierKey];
                if (!items || items.length === 0) return null;
                const tierLabel = getTrustPhrase(tierKey);
                return (
                  <TierSection
                    key={tierKey}
                    tierKey={tierKey}
                    tierLabel={tierLabel}
                    profiles={items}
                    followSet={followSet}
                    followedByPubkeys={followedByPubkeys}
                  />
                );
              })}
            </div>
          ) : (
            // Fallback for everyone the tiered view can't serve: WoT off, trust
            // network still calculating (wotEnabled && !wotReady), or ready but
            // zero tiered rows. Never a caption over blank space.
            <div className="space-y-4">
              {wotEnabled && !wotReady && (
                <p className="text-[13px] text-muted-foreground" data-testid="text-wot-building">
                  Building your trust network — personalized suggestions arrive when it's ready. Meanwhile, here's who's active:
                </p>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-semibold">Active now</h3>
              </div>
              {discoveryProfiles.length === 0 ? (
                <div className="space-y-4">
                  <EmptyState icon={Users} message="No profiles to show yet" hint="Search above to find people by name." />
                  {/* Curated starter accounts so a brand-new account is never
                      staring at an empty page (self-hides once they follow some). */}
                  <SuggestedFollowsStrip />
                </div>
              ) : (
                <div className="space-y-6">
                  {discoveryProfiles.slice(0, 20).map(profile => {
                    const influence = wotReady ? (scores?.get(profile.pubkey) ?? null) : null;
                    const tier = wotReady ? (tierOf(profile.pubkey, influence) ?? "none") : "none";
                    return (
                      <ProfileCardErrorBoundary key={profile.pubkey}>
                        <ProfileCard profile={profile} tier={tier} isFollowed={followSet.has(profile.pubkey)} followsYou={followedByPubkeys?.has(profile.pubkey) ?? false} />
                      </ProfileCardErrorBoundary>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Shape-of-content placeholder for the People discovery list (avatar + two
// text lines per row) — reads as "profiles are coming" rather than a bare spinner.
function PeopleDiscoverySkeleton() {
  return (
    <div className="space-y-4 pt-1" data-testid="skeleton-people-discovery" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/20 p-3 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-muted/60 shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3 rounded bg-muted/60" style={{ width: `${55 - i * 6}%` }} />
            <div className="h-2.5 rounded bg-muted/40" style={{ width: `${75 - i * 5}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TierSection({ tierKey, tierLabel, profiles, followSet, followedByPubkeys }: {
  tierKey: string;
  tierLabel: string;
  profiles: { event: Event; influence: number }[];
  followSet: Set<string>;
  followedByPubkeys: Set<string> | null;
}) {
  const [expanded, setExpanded] = useState(tierKey === "strong");
  const displayCount = expanded ? Math.min(profiles.length, 12) : 0;
  const [showAll, setShowAll] = useState(false);
  const visibleProfiles = showAll ? profiles : profiles.slice(0, displayCount);

  return (
    <section data-testid={`section-tier-${tierKey}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full min-h-11 text-left mb-1 group"
      >
        {/* The glyph carries the tier's colour (TIER_GLYPH); the heading stays ink. */}
        <TrustTierGlyph tier={tierKey as SignalTier} size={tierKey === "flagged" ? "w-3.5 h-3.5" : "w-2.5 h-2.5"} decorative />
        <span className="text-[14px] font-semibold text-foreground" data-testid={`heading-tier-${tierKey}`}>{tierLabel}</span>
        <span className="text-[13px] text-muted-foreground tabular-nums">{profiles.length}</span>
        <ChevronDown className={`ml-auto w-4 h-4 text-muted-foreground group-hover:text-foreground transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="space-y-6">
          {visibleProfiles.map(({ event: profile, influence }) => {
            const tier: SignalTier = tierKey === "flagged" ? "flagged" : getSignalTier(influence);
            return (
              <ProfileCardErrorBoundary key={profile.pubkey}>
                <ProfileCard profile={profile} tier={tier} grouped isFollowed={followSet.has(profile.pubkey)} followsYou={followedByPubkeys?.has(profile.pubkey) ?? false} />
              </ProfileCardErrorBoundary>
            );
          })}
          {!showAll && profiles.length > displayCount && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-center py-2 text-[12px] text-brand transition-colors font-medium"
            >
              Show {profiles.length - displayCount} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const RESULTS_PAGE_SIZE = 20;

function PeopleSearchResults({ profiles, followSet, followedByPubkeys }: {
  profiles: { event: Event; tier: SignalTier; influence: number | null }[];
  followSet: Set<string>;
  followedByPubkeys: Set<string> | null;
}) {
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [profiles]);

  const visible = profiles.slice(0, visibleCount);
  const hasMore = visibleCount < profiles.length;

  return (
    <div className="space-y-6" data-testid="container-people-results">
      <p className="text-[13px] text-muted-foreground mb-2">{profiles.length} result{profiles.length !== 1 ? "s" : ""}</p>
      {visible.map(({ event: profile, tier, influence }) => (
        <ProfileCardErrorBoundary key={profile.pubkey}>
          <ProfileCard profile={profile} tier={tier} isFollowed={followSet.has(profile.pubkey)} followsYou={followedByPubkeys?.has(profile.pubkey) ?? false} />
        </ProfileCardErrorBoundary>
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          className="w-full min-h-11 text-[13px] text-muted-foreground hover:text-foreground"
          onClick={() => setVisibleCount(c => c + RESULTS_PAGE_SIZE)}
        >
          Show more ({profiles.length - visibleCount} remaining)
        </Button>
      )}
    </div>
  );
}

function ProfileCard({ profile, tier, isFollowed, followsYou, grouped = false }: {
  profile: Event;
  tier: SignalTier;
  isFollowed: boolean;
  followsYou: boolean;
  /** Inside a tier section the heading already says it — the card stays quiet. */
  grouped?: boolean;
}) {
  let content: ReturnType<typeof getProfileContent> | null = null;
  try {
    content = getProfileContent(profile);
  } catch {
    content = null;
  }
  const npub = formatNpub(profile.pubkey);
  const ringColor = getSignalTierRingColor(tier);
  const hasLightning = !!(content?.lud16 || content?.lud06);
  const nip05 = content?.nip05;
  const nip05Display = nip05 ? (nip05.startsWith("_@") ? nip05.slice(2) : nip05) : null;
  const relationship = isFollowed && followsYou ? "mutual" : followsYou ? "follows-you" : isFollowed ? "following" : null;

  return (
    <Link key={profile.pubkey} href={`/profile/${npub}`}>
      <Card className="glass-card cursor-pointer group/card overflow-hidden relative" data-testid={`card-user-${profile.pubkey.slice(0, 8)}`}>
        <CardContent className="relative z-10 p-3 sm:p-4 flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar className={`w-12 h-12 ring-2 ${ringColor} border-2 border-background`}>
              <AvatarImage src={content?.picture} alt={content?.display_name || content?.name || "User"} />
              <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-xs font-bold">
                {(content?.display_name || content?.name || "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {hasLightning && (
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center ring-2 ring-background">
                <Zap className="w-2.5 h-2.5 text-white fill-white" />
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold truncate">{content?.display_name || content?.name || shortenNpub(npub)}</p>
              {!grouped && <TrustMark tier={tier} />}
              <ActivityIndicator pubkey={profile.pubkey} />
              {relationship === "mutual" && (
                <span className="text-[12px] font-medium text-brand">Mutual</span>
              )}
              {relationship === "follows-you" && (
                <span className="text-[12px] font-medium text-brand">Follows you</span>
              )}
              {relationship === "following" && (
                <span className="text-[12px] text-muted-foreground">Following</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {nip05Display && (
                <Nip05Badge nip05={nip05!} pubkey={profile.pubkey} className="truncate max-w-[160px]" textClassName="text-[12px] text-success" iconClassName="w-3 h-3" />
              )}
              {!nip05Display && (
                <span className="text-[12px] text-muted-foreground truncate">{shortenNpub(npub)}</span>
              )}
              {!grouped && <TrustPhrase tier={tier} />}
            </div>
            {content?.about && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{content.about}</p>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}


type PostSortOption = "recent" | "reactions" | "zaps" | "replies";
type PostTimeFilter = "all" | "24h" | "7d" | "30d" | "1y";

const POST_SORT_OPTIONS: { value: PostSortOption; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "recent", label: "Recent", icon: Clock },
  { value: "reactions", label: "Most Reacted", icon: Heart },
  { value: "zaps", label: "Most Zapped", icon: BtcZapIcon },
  { value: "replies", label: "Most Replied", icon: MessageCircle },
];

const POST_TIME_FILTERS: { value: PostTimeFilter; label: string; seconds: number | null; topRange: TopNoteRange }[] = [
  { value: "24h", label: "24h", seconds: 86400, topRange: "today" },
  { value: "7d", label: "7d", seconds: 604800, topRange: "7d" },
  { value: "30d", label: "30d", seconds: 2592000, topRange: "30d" },
  { value: "1y", label: "1y", seconds: 31536000, topRange: "1y" },
  { value: "all", label: "All", seconds: null, topRange: "all" },
];

const SORT_MAP: Record<PostSortOption, ArchivesSortOption> = {
  recent: "created_at",
  reactions: "reactions",
  zaps: "zaps",
  replies: "replies",
};

const METRIC_MAP: Record<PostSortOption, TopNoteMetric> = {
  recent: "reactions",
  reactions: "reactions",
  zaps: "zaps",
  replies: "replies",
};

function archivesToEvents(archiveEvents: ArchivesEvent[]): Event[] {
  const now = Math.floor(Date.now() / 1000);
  const statsUpdate: Record<string, { replies: number; reposts: number; likes: number; zaps: number; zapAmount: number }> = {};
  const events = archiveEvents.filter(ae => ae.created_at <= now).map(ae => {
    const reactions = ae.reactions ?? ae.reactions_count ?? 0;
    const replies = ae.replies ?? ae.replies_count ?? 0;
    const zapSats = ae.zap_sats ?? ae.zaps_total ?? 0;
    const zapCount = ae.zaps_count ?? (zapSats > 0 ? 1 : 0);
    const reposts = ae.reposts ?? ae.reposts_count ?? 0;
    if (reactions || replies || zapCount || reposts) {
      statsUpdate[ae.id] = {
        replies,
        reposts,
        likes: reactions,
        zaps: zapCount,
        zapAmount: zapSats,
      };
    }
    return {
      id: ae.id,
      pubkey: ae.pubkey,
      kind: ae.kind,
      content: ae.content,
      tags: ae.tags,
      created_at: ae.created_at,
      sig: ae.sig || "",
    } as Event;
  });
  if (Object.keys(statsUpdate).length > 0) {
    primalStatsCache.update(statsUpdate);
  }
  return events;
}

function topNotesToEvents(notes: import("@/lib/nostr-archives").TopNote[]): Event[] {
  const now = Math.floor(Date.now() / 1000);
  const statsUpdate: Record<string, { replies: number; reposts: number; likes: number; zaps: number; zapAmount: number }> = {};
  const events = notes.filter(note => note.event.created_at <= now).map(note => {
    const ev = note.event;
    if (note.reactions || note.replies || note.zap_sats || note.reposts) {
      statsUpdate[ev.id] = {
        replies: note.replies || 0,
        reposts: note.reposts || 0,
        likes: note.reactions || 0,
        zaps: note.zap_sats > 0 ? 1 : 0,
        zapAmount: note.zap_sats || 0,
      };
    }
    return {
      id: ev.id,
      pubkey: ev.pubkey,
      kind: ev.kind,
      content: ev.content,
      tags: ev.tags || [],
      created_at: ev.created_at,
      sig: ev.sig || "",
    } as Event;
  });
  if (Object.keys(statsUpdate).length > 0) {
    primalStatsCache.update(statsUpdate);
  }
  return events;
}

function TrendingChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M21.5 2.5H2.5V21.5H21.5V2.5Z" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="square" />
      <path d="M14.11 10.9502L11.17 14.8202L8.23001 12.8802L2.95001 19.6002" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="square" />
      <path d="M11.13 10.5798L14.83 9.7998L15.61 13.4998" stroke="currentColor" strokeWidth="1.5" strokeMiterlimit="10" strokeLinecap="square" />
    </svg>
  );
}

function PostsTab(_props: TabProps) {
  const { pubkey } = useNostrAuth();

  const [feedPosts, setFeedPosts] = useState<Event[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const feedLoadedKeyRef = useRef<string>("");
  const feedIdsRef = useRef(new Set<string>());
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const feedLoadingMoreRef = useRef(false);

  const [sortOption, setSortOption] = useState<PostSortOption>("replies");
  const [timeFilter, setTimeFilter] = useState<PostTimeFilter>("24h");

  // Keyword search across posts. Backend = searchNostr() (Primal's ranked
  // search + NIP-50 relay fallback, already integrated). Manual submit keeps it
  // light for old devices. Results are then re-ranked by the user's Web of
  // Trust ("Trusted first") — gracefully falling back to relevance order when
  // WoT is off or the user is logged out.
  const { scores: wotScores, wotEnabled, requestScoresBulk, flaggedPubkeys, loading: scoresLoading } = useGrapeRankScores();
  // Reactively track the logged-in user's mute list (NIP-51 + local). We never
  // surface content from people the user has muted/blocked or reported.
  const { mutedPubkeys } = useNostrMuteList();
  const mutedSet = useMemo(() => new Set(mutedPubkeys), [mutedPubkeys]);
  const isModerated = useCallback(
    (e: Event) =>
      mutedSet.has(e.pubkey) ||
      isMutedPubkey(e.pubkey) ||
      isReportedPubkey(e.pubkey) ||
      isReportedEvent(e.id),
    [mutedSet],
  );
  const [postsMode, setPostsMode] = useState<"trending" | "search">("trending");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Event[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [trustedFirst, setTrustedFirst] = useState(true);
  // Paginated keyword search: load the first page large, then append more as the
  // user scrolls (mirrors the trending feed's ScrollSentinel). seenIds dedupes
  // across pages; activeQueryRef pins the query the pages belong to.
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const searchLoadingMoreRef = useRef(false);
  const searchSeenIdsRef = useRef(new Set<string>());
  const activeQueryRef = useRef("");
  const SEARCH_FIRST_PAGE = 60;

  const runPostSearch = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (!query) { setSearchResults([]); setSearched(false); setSearchHasMore(false); return; }
    setSearchLoading(true);
    setSearched(true);
    activeQueryRef.current = query;
    searchSeenIdsRef.current = new Set<string>();
    try {
      const events = await searchNostr(query, SEARCH_FIRST_PAGE, pubkey || undefined);
      const seen = searchSeenIdsRef.current;
      const deduped = events.filter((e) => {
        if (e.kind !== 1 || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      // Keep the backend's relevance order (NIP-50/Primal rank by relevance, not
      // recency) — the WoT re-rank is applied at render time.
      setSearchResults(deduped);
      // A full first page implies there may be more to fetch on scroll.
      setSearchHasMore(deduped.length >= SEARCH_FIRST_PAGE);
      const pks = Array.from(new Set(deduped.map((e) => e.pubkey))).slice(0, 50);
      if (pks.length > 0) { fetchProfilesCached(pks); requestScoresBulk(pks); }
    } catch {
      setSearchResults([]);
      setSearchHasMore(false);
    } finally {
      setSearchLoading(false);
    }
  }, [pubkey, requestScoresBulk]);

  // Load the next page of search results when the sentinel scrolls into view.
  // Pages older than the current tail (by created_at) and dedupes via seenIds;
  // a short page means the backend is exhausted, so we stop.
  const loadMoreSearch = useCallback(async () => {
    if (searchLoadingMoreRef.current || !searchHasMore) return;
    const query = activeQueryRef.current;
    if (!query) return;
    searchLoadingMoreRef.current = true;
    setSearchLoadingMore(true);
    try {
      const oldest = searchResults.reduce(
        (min, e) => (e.created_at < min ? e.created_at : min),
        Number.MAX_SAFE_INTEGER,
      );
      const until = oldest === Number.MAX_SAFE_INTEGER ? undefined : oldest - 1;
      const PAGE = 30;
      const more = await searchNostrPaginated(query, PAGE, until, searchSeenIdsRef.current, pubkey || undefined);
      // The query changed underneath us — discard this stale page.
      if (activeQueryRef.current !== query) return;
      const seen = searchSeenIdsRef.current;
      const fresh = more.filter((e) => {
        if (e.kind !== 1 || seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      if (fresh.length > 0) {
        setSearchResults((prev) => [...prev, ...fresh]);
        const pks = Array.from(new Set(fresh.map((e) => e.pubkey))).slice(0, 50);
        if (pks.length > 0) { fetchProfilesCached(pks); requestScoresBulk(pks); }
      }
      // Fewer than a full page back (after dedupe) means we've hit the tail.
      if (more.length < PAGE) setSearchHasMore(false);
    } catch {
      setSearchHasMore(false);
    } finally {
      searchLoadingMoreRef.current = false;
      setSearchLoadingMore(false);
    }
  }, [searchHasMore, searchResults, pubkey, requestScoresBulk]);

  // Stage 1 — the user's own moderation ALWAYS applies, in both toggle modes:
  // drop anything from muted/blocked/reported authors (and reported events).
  const moderatedResults = useMemo(
    () => searchResults.filter((e) => !isModerated(e)),
    [searchResults, isModerated],
  );

  // Stage 2 — "Trusted first" is a soft RANK, not a gate: show ALL matching posts
  // and sort trusted / higher-influence authors to the top; only drop flagged
  // (abuse-reported) authors. Off / WoT off / logged out → relevance order. This
  // keeps search results full (like Primal/Damus) while still surfacing trusted
  // voices first.
  const trustGated = wotEnabled && trustedFirst && !!wotScores;
  const displayedResults = useMemo(() => {
    if (!trustGated || !wotScores) return moderatedResults;
    return moderatedResults
      .filter((e) => !flaggedPubkeys?.has(e.pubkey))
      .sort((a, b) => (wotScores.get(b.pubkey) ?? 0) - (wotScores.get(a.pubkey) ?? 0));
  }, [moderatedResults, trustGated, wotScores, flaggedPubkeys]);

  // True when the trust gate has emptied a non-empty result set because we're
  // still fetching WoT scores for these authors — show a ranking state rather
  // than a misleading "no posts".
  const trustRanking =
    trustGated && scoresLoading && displayedResults.length === 0 && moderatedResults.length > 0;

  // The trending/sorted feed honors the same moderation: muted/blocked/reported
  // authors never appear here either.
  const moderatedFeedPosts = useMemo(
    () => feedPosts.filter((e) => !isModerated(e)),
    [feedPosts, isModerated],
  );

  const isDefaultFeed = sortOption === "recent" && timeFilter === "all";
  const feedKey = `${sortOption}_${timeFilter}`;

  useEffect(() => {
    if (feedLoadedKeyRef.current === feedKey) return;
    feedLoadedKeyRef.current = feedKey;
    feedIdsRef.current.clear();
    setFeedHasMore(true);

    const cacheKey = `posts_feed_v2_${feedKey}`;
    const cached = getSessionCache<Event[]>(cacheKey);
    if (cached && cached.length > 0) {
      setFeedPosts(cached);
      for (const p of cached) feedIdsRef.current.add(p.id);
      setFeedLoading(false);
      setFeedHasMore(sortOption === "recent" && cached.length >= SEARCH_PAGE_SIZE);
      return;
    }

    setFeedLoading(true);
    (async () => {
      try {
        if (isDefaultFeed) {
          const posts = await fetchTrendingFeed("trending_4h", pubkey || undefined, 40);
          if (feedLoadedKeyRef.current !== feedKey) return;
          for (const p of posts) feedIdsRef.current.add(p.id);
          setFeedPosts(posts);
          setSessionCache(cacheKey, posts);
          setFeedHasMore(false);
        } else {
          const timeConfig = POST_TIME_FILTERS.find(t => t.value === timeFilter);
          const topRange = timeConfig?.topRange || "today";
          const metric = METRIC_MAP[sortOption];
          const isEngagementSort = sortOption !== "recent";
          let posts: Event[];
          if (isEngagementSort) {
            const { notes } = await fetchTopNotes({ metric, range: topRange, limit: 50 });
            if (feedLoadedKeyRef.current !== feedKey) return;
            posts = topNotesToEvents(notes);
          } else {
            const since = timeConfig?.seconds ? Math.floor(Date.now() / 1000) - timeConfig.seconds : undefined;
            const { events: archiveEvents } = await searchArchivesEvents({
              kind: 1,
              limit: SEARCH_PAGE_SIZE,
              sort: SORT_MAP[sortOption],
              since,
            });
            if (feedLoadedKeyRef.current !== feedKey) return;
            posts = archivesToEvents(archiveEvents);
          }
          for (const p of posts) feedIdsRef.current.add(p.id);
          setFeedPosts(posts);
          setSessionCache(cacheKey, posts);
          setFeedHasMore(!isEngagementSort && posts.length >= SEARCH_PAGE_SIZE);
          const profilePks = Array.from(new Set(posts.map(e => e.pubkey))).slice(0, 50);
          if (profilePks.length > 0) fetchProfilesCached(profilePks);
        }
      } catch {
        if (feedLoadedKeyRef.current === feedKey) setFeedPosts([]);
      } finally {
        if (feedLoadedKeyRef.current === feedKey) setFeedLoading(false);
      }
    })();
  }, [feedKey, pubkey, isDefaultFeed, sortOption, timeFilter]);

  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingMoreRef.current || !feedHasMore || isDefaultFeed || sortOption !== "recent") return;
    feedLoadingMoreRef.current = true;
    setFeedLoadingMore(true);
    const requestKey = feedKey;
    try {
      const timeConfig = POST_TIME_FILTERS.find(t => t.value === timeFilter);
      const since = timeConfig?.seconds ? Math.floor(Date.now() / 1000) - timeConfig.seconds : undefined;
      const { events: archiveEvents } = await searchArchivesEvents({
        kind: 1,
        limit: SEARCH_PAGE_SIZE,
        offset: feedIdsRef.current.size,
        sort: SORT_MAP[sortOption],
        since,
      });
      if (feedLoadedKeyRef.current !== requestKey) { feedLoadingMoreRef.current = false; setFeedLoadingMore(false); return; }
      const newPosts = archivesToEvents(archiveEvents.filter(ae => !feedIdsRef.current.has(ae.id)));
      for (const p of newPosts) feedIdsRef.current.add(p.id);
      if (newPosts.length > 0) {
        setFeedPosts(prev => [...prev, ...newPosts]);
        const profilePks = Array.from(new Set(newPosts.map(e => e.pubkey))).slice(0, 50);
        if (profilePks.length > 0) fetchProfilesCached(profilePks);
      }
      if (archiveEvents.length < SEARCH_PAGE_SIZE) setFeedHasMore(false);
    } catch {
      if (feedLoadedKeyRef.current === requestKey) setFeedHasMore(false);
    } finally {
      feedLoadingMoreRef.current = false;
      setFeedLoadingMore(false);
    }
  }, [feedHasMore, isDefaultFeed, sortOption, timeFilter, feedKey]);

  const feedLabel = isDefaultFeed
    ? "Trending"
    : sortOption === "reactions" ? "Most Reacted"
    : sortOption === "zaps" ? "Most Zapped"
    : sortOption === "replies" ? "Most Replied"
    : "Recent";

  const timeLabel = timeFilter === "all" ? "" : POST_TIME_FILTERS.find(t => t.value === timeFilter)?.label || "";

  return (
    <div>
      <div className="flex items-center gap-1 mb-3" data-testid="posts-mode-toggle">
        {([["trending", "Trending"], ["search", "Search"]] as const).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setPostsMode(val)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${ postsMode === val ? "bg-accent text-accent-foreground dark:text-brand border border-brand/20 dark:border-brand/30" : "text-muted-foreground hover:text-muted-foreground border border-transparent" }`}
            data-testid={`posts-mode-${val}`}
          >
            {val === "trending" ? <TrendingChartIcon className="w-3.5 h-3.5" /> : <SearchIcon className="w-3.5 h-3.5" />}
            {label}
          </button>
        ))}
      </div>

      {postsMode === "search" && (
        <div data-testid="container-posts-search">
          <TabSearchBar
            query={searchQuery}
            setQuery={setSearchQuery}
            onSubmit={() => runPostSearch(searchQuery)}
            onClear={() => { setSearchQuery(""); setSearchResults([]); setSearched(false); setSearchHasMore(false); activeQueryRef.current = ""; searchSeenIdsRef.current = new Set<string>(); }}
            loading={searchLoading}
            placeholder="Search posts by keyword…"
          />
          <div className="mt-3">
            {searchLoading ? (
              <LoadingState message="Searching posts across relays…" />
            ) : !searched ? (
              <EmptyState icon={SearchIcon} message="Search across posts" hint="Type a keyword and press Enter to search across the network." />
            ) : trustRanking ? (
              <LoadingState message="Putting people your network trusts first…" />
            ) : displayedResults.length === 0 ? (
              trustGated && moderatedResults.length > 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center" data-testid="posts-search-no-trusted">
                  <ShieldCheck className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-sm font-medium mb-1">No posts from people your network trusts</p>
                  <p className="text-[13px] text-muted-foreground max-w-xs">
                    {moderatedResults.length} match{moderatedResults.length === 1 ? "" : "es"} are from people your network doesn't know yet.
                  </p>
                  <button
                    onClick={() => setTrustedFirst(false)}
                    className="mt-4 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border border-foreground/25 text-foreground hover:bg-foreground/[0.06] transition-colors min-h-9"
                    data-testid="posts-search-show-everyone"
                  >
                    Show everyone
                  </button>
                </div>
              ) : (
                <EmptyState icon={FileText} message="No posts found" hint="Try different or fewer keywords." />
              )
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap" data-testid="posts-search-results-header">
                  <span className="text-[13px] text-muted-foreground">
                    {displayedResults.length}{searchHasMore ? "+" : ""} result{displayedResults.length === 1 ? "" : "s"}
                  </span>
                  {wotEnabled && (
                    <div className="flex items-center gap-0.5 rounded-full p-0.5 border border-border/60" role="group" aria-label="Order">
                      {([["trusted", "Trusted first"], ["relevance", "Everyone"]] as const).map(([k, lbl]) => {
                        const on = (k === "trusted") === trustedFirst;
                        return (
                          <button
                            key={k}
                            onClick={() => setTrustedFirst(k === "trusted")}
                            aria-pressed={on}
                            className={`flex items-center gap-1 rounded-full px-3 min-h-8 text-[13px] font-medium transition-colors duration-150 ${
                              on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                            }`}
                            data-testid={`posts-search-rank-${k}`}
                          >
                            {k === "trusted" && <ShieldCheck className="w-3 h-3" />}
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {/* Virtualized — same OOM guard as the hashtag results. */}
                  <VirtualFeed
                    items={displayedResults}
                    getKey={(event) => event.id}
                    estimateSize={340}
                    gap={12}
                    onReachEnd={loadMoreSearch}
                    renderItem={(event) => <PostBoundary id={event.id}><NostrPost event={event} /></PostBoundary>}
                  />
                  <ScrollSentinel onLoadMore={loadMoreSearch} isLoading={searchLoadingMore} hasMore={searchHasMore} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {postsMode === "trending" && (<>
      {!isDefaultFeed && (
        <div className="flex items-center mb-2">
          <a href="https://nostrarchives.com" target="_blank" rel="noopener noreferrer" className="inline-flex">
            <Badge variant="secondary" className="text-xs bg-brand/10 text-brand border-brand/20 cursor-pointer hover:bg-brand/20 transition-colors gap-1">
              <span className="font-normal">powered by</span>
              <Globe className="w-2.5 h-2.5 opacity-60" />
              Archives
            </Badge>
          </a>
        </div>
      )}

      <div className="flex items-center gap-1.5 sm:gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-0.5 bg-secondary/30 rounded-lg p-0.5 border border-border/30">
          {POST_SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSortOption(opt.value)}
              className={`flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${ sortOption === opt.value ? "bg-accent text-accent-foreground dark:text-brand shadow-sm border border-brand/20 dark:border-brand/30" : "text-muted-foreground hover:bg-secondary/50 border border-transparent" }`}
              data-testid={`sort-${opt.value}`}
            >
              <opt.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-border/30 hidden sm:block" />
        <div className="flex items-center gap-0.5">
          {POST_TIME_FILTERS.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeFilter(tf.value)}
              className={`px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                timeFilter === tf.value
                  ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-400/30"
                  : "text-muted-foreground border border-transparent hover:border-border/30"
              }`}
              data-testid={`time-${tf.value}`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div data-testid="container-posts-discovery">
        <div className="flex items-center gap-2 mb-3">
          {isDefaultFeed ? (
            <Activity className="w-4 h-4 text-brand" />
          ) : sortOption === "zaps" ? (
            <BtcZapIcon className="w-4 h-4 text-amber-800 dark:text-amber-400" />
          ) : sortOption === "reactions" ? (
            <Heart className="w-4 h-4 text-pink-400" />
          ) : sortOption === "replies" ? (
            <MessageCircle className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          ) : (
            <Clock className="w-4 h-4 text-brand" />
          )}
          <h3 className="text-sm font-semibold">{feedLabel}</h3>
          {isDefaultFeed && <span className="text-xs font-mono text-muted-foreground">4H</span>}
          {!isDefaultFeed && timeLabel && <span className="text-xs font-mono text-muted-foreground">{timeLabel}</span>}
        </div>
        {feedLoading ? (
          <LoadingState message={isDefaultFeed ? "Loading trending posts..." : `Loading ${feedLabel.toLowerCase()} posts...`} />
        ) : moderatedFeedPosts.length === 0 ? (
          <EmptyState icon={FileText} message="No posts found" hint={isDefaultFeed ? "Check back later for popular content." : "Try a different time range or sort."} />
        ) : (
          <div className="space-y-3">
            {/* Virtualized — same OOM guard as the hashtag results. */}
            <VirtualFeed
              items={moderatedFeedPosts}
              getKey={(event) => event.id}
              estimateSize={340}
              gap={12}
              onReachEnd={!isDefaultFeed ? loadMoreFeed : undefined}
              renderItem={(event) => <PostBoundary id={event.id}><NostrPost event={event} /></PostBoundary>}
            />
            {!isDefaultFeed && <ScrollSentinel onLoadMore={loadMoreFeed} isLoading={feedLoadingMore} hasMore={feedHasMore} />}
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}


function QuickFollowButton({ targetPubkey, isFollowed }: { targetPubkey: string; isFollowed: boolean }) {
  const { pubkey: myPubkey, signer, follows, updateFollows } = useNostrAuth();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [localFollowed, setLocalFollowed] = useState(isFollowed);

  useEffect(() => { setLocalFollowed(isFollowed); }, [isFollowed]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!myPubkey || !signer || processing || myPubkey === targetPubkey) return;
    setProcessing(true);
    try {
      // Authoritative current kind-3 + wipe guard (shared safeguard).
      const { base: freshFollowEvent, blocked } = await loadFollowBase(myPubkey, follows?.length ?? 0);
      if (blocked) {
        toast({ title: "Couldn't load your follow list", description: "Try again in a moment — your follows are safe.", variant: "destructive" });
        return;
      }
      const existingTags: string[][] = freshFollowEvent ? [...freshFollowEvent.tags] : [];
      let newTags: string[][];
      if (localFollowed) {
        newTags = existingTags.filter(t => !(t[0] === "p" && t[1] === targetPubkey));
      } else {
        newTags = existingTags.some(t => t[0] === "p" && t[1] === targetPubkey) ? existingTags : [...existingTags, ["p", targetPubkey]];
      }
      const event = { kind: KIND_FOLLOW_LIST, created_at: Math.floor(Date.now() / 1000), tags: newTags, content: freshFollowEvent?.content || "" };
      if (localFollowed) {
        updateFollows(prev => prev.filter(pk => pk !== targetPubkey));
      } else {
        updateFollows(prev => prev.includes(targetPubkey) ? prev : [...prev, targetPubkey]);
      }
      setLocalFollowed(!localFollowed);
      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_FOLLOW_LIST)) {
        setLocalFollowed(localFollowed);
        if (localFollowed) { updateFollows(prev => prev.includes(targetPubkey) ? prev : [...prev, targetPubkey]); }
        else { updateFollows(prev => prev.filter(pk => pk !== targetPubkey)); }
        return;
      }
      await publishEvent(signed);
      cacheFollowEvent(signed as Event, { force: true });
    } catch {
      setLocalFollowed(localFollowed);
      if (localFollowed) {
        updateFollows(prev => prev.includes(targetPubkey) ? prev : [...prev, targetPubkey]);
      } else {
        updateFollows(prev => prev.filter(pk => pk !== targetPubkey));
      }
      toast({ title: "Failed to update follow", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  if (!myPubkey || myPubkey === targetPubkey) return null;

  return (
    <span
      onClick={handleClick}
      className={`text-[10px] transition-colors cursor-pointer select-none ${
        localFollowed
          ? "text-brand"
          : "text-brand"
      } ${processing ? "opacity-40 pointer-events-none" : ""}`}
    >
      {processing ? "..." : localFollowed ? "Following" : "+ Follow"}
    </span>
  );
}

const MOBILE_TRUSTED_INITIAL = 4;

function MobileTrustedVoices({ voices, followSet }: {
  voices: { event: Event; tier: SignalTier; influence: number | null }[];
  followSet: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? voices : voices.slice(0, MOBILE_TRUSTED_INITIAL);
  const remaining = voices.length - MOBILE_TRUSTED_INITIAL;

  return (
    <div className="sm:hidden space-y-1.5">
      {visible.map(({ event: profile, tier, influence }) => {
        const content = (() => { try { return getProfileContent(profile); } catch { return null; } })();
        const npub = formatNpub(profile.pubkey);
        const ringColor = getSignalTierRingColor(tier);
        return (
          <div key={profile.pubkey} className="flex items-center gap-2.5 rounded-[16px] px-2.5 py-2 border border-border/60 bg-card active:bg-foreground/[0.05] transition-colors">
            <Link href={`/profile/${npub}`} className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="relative shrink-0">
                <Avatar className={`w-9 h-9 ring-2 ${ringColor} border border-background`}>
                  <AvatarImage src={content?.picture} alt={content?.display_name || content?.name || "User"} />
                  <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-[12px] font-bold">
                    {(content?.display_name || content?.name || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {getTrustMark(tier) && (
                  <span className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                    <TrustMark tier={tier} className="w-3 h-3" />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-foreground truncate leading-tight">
                  {content?.display_name || content?.name || shortenNpub(npub)}
                </p>
                {content?.nip05 && (
                  <p className="text-[12px] text-success truncate leading-tight mt-0.5">
                    {content.nip05.startsWith("_@") ? content.nip05.slice(2) : content.nip05}
                  </p>
                )}
              </div>
            </Link>
            <div className="shrink-0">
              <QuickFollowButton targetPubkey={profile.pubkey} isFollowed={followSet.has(profile.pubkey)} />
            </div>
          </div>
        );
      })}
      {!expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 min-h-11 rounded-full border border-border/60 active:bg-foreground/[0.05] transition-colors cursor-pointer"
        >
          <ChevronDown className="w-3.5 h-3.5 text-brand" />
          <span className="text-[13px] font-medium text-brand">Show {remaining} more</span>
        </button>
      )}
      {expanded && voices.length > MOBILE_TRUSTED_INITIAL && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full flex items-center justify-center gap-1.5 min-h-11 rounded-full border border-border/60 active:bg-foreground/[0.05] transition-colors cursor-pointer"
        >
          <ChevronUp className="w-3.5 h-3.5 text-brand" />
          <span className="text-[13px] font-medium text-brand">Show less</span>
        </button>
      )}
    </div>
  );
}

function HashtagsTab({ urlQuery, updateUrl }: TabProps) {
  const { pubkey, follows } = useNostrAuth();
  const { scores, injectScores, flaggedPubkeys } = useGrapeRankScores();
  const followSet = useMemo(() => new Set(follows || []), [follows]);
  // Moderation: hashtag feeds are the spam magnet — run every rendered post
  // through the shared spam/mute/report filter. `filter` identity bumps on any
  // mute/report change, so muting from THIS list purges it live.
  const { filter: moderationFilter } = useSpamFilter();
  const [query, setQuery] = useState(urlQuery.startsWith("#") ? urlQuery.slice(1) : urlQuery);
  const [trendingTags, setTrendingTags] = useState<TrendingHashtag[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [tagPosts, setTagPosts] = useState<Event[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const visibleTagPosts = useMemo(() => moderationFilter(tagPosts), [tagPosts, moderationFilter]);
  const [searched, setSearched] = useState(!!urlQuery);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const tagPostIdsRef = useRef(new Set<string>());
  const loadingMoreRef = useRef(false);
  const prevUrlQueryRef = useRef("");
  const trendingLoadedRef = useRef(false);
  const [trustedVoices, setTrustedVoices] = useState<{ event: Event; tier: SignalTier; influence: number | null }[]>([]);
  const [trustedVoicesLoading, setTrustedVoicesLoading] = useState(false);
  const trustedVoicesTagRef = useRef<string | null>(null);

  useEffect(() => {
    const q = urlQuery.startsWith("#") ? urlQuery.slice(1) : urlQuery;
    setQuery(q);
    if (urlQuery !== prevUrlQueryRef.current) {
      if (q) {
        searchTag(q, true);
      } else {
        setSearched(false);
        setActiveTag(null);
        setTagPosts([]);
        tagPostIdsRef.current.clear();
        setHasMore(true);
      }
    }
    prevUrlQueryRef.current = urlQuery;
  }, [urlQuery]);

  useEffect(() => {
    if (trendingLoadedRef.current) return;
    trendingLoadedRef.current = true;

    const cached = getSessionCache<TrendingHashtag[]>("search_trending_tags_v3");
    if (cached) {
      setTrendingTags(cached);
      setTrendingLoading(false);
      return;
    }

    fetchTrendingHashtags(20).then(tags => {
      setTrendingTags(tags);
      setTrendingLoading(false);
      setSessionCache("search_trending_tags_v3", tags);
    }).catch(() => setTrendingLoading(false));
  }, []);

  const searchTag = useCallback(async (tag: string, fromUrl = false) => {
    const cleaned = tag.replace(/^#/, "").toLowerCase().trim();
    if (!cleaned) return;
    if (!fromUrl) {
      prevUrlQueryRef.current = `#${cleaned}`;
      updateUrl({ q: `#${cleaned}` });
    }
    setActiveTag(cleaned);
    setSearched(true);
    setLoading(true);
    setHasMore(true);
    tagPostIdsRef.current.clear();
    setTagPosts([]);

    try {
      const tagFilter: any = { kinds: [1], "#t": [cleaned], limit: SEARCH_PAGE_SIZE };
      const searchFilter: any = { kinds: [1], search: `#${cleaned}`, limit: SEARCH_PAGE_SIZE };
      // The viewer's own notes relays FIRST: the Discover "Talking about"
      // chips count tags from follows' posts on these relays — a search that
      // skipped them answered "0 posts" for tags the strip had just counted.
      const tagRelays = Array.from(new Set([...getRelaysForPurpose("notes"), ...DEFAULT_RELAYS])).slice(0, 8);
      const nip50Relays = SEARCH_RELAYS;
      console.log(`[HashtagSearch] Searching "#${cleaned}" — tag filter to ${tagRelays.length} relays, NIP-50 to ${nip50Relays.length} relays`);
      const relayResults = await Promise.allSettled([
        queryWithTimeout(pool.querySync(tagRelays, tagFilter), 10000, []),
        queryWithTimeout(pool.querySync(nip50Relays, searchFilter), 10000, []),
      ]);
      const allEvents: Event[] = [];
      for (const r of relayResults) {
        if (r.status === "fulfilled") {
          console.log(`[HashtagSearch] Strategy returned ${r.value.length} events`);
          allEvents.push(...r.value);
        } else {
          console.warn(`[HashtagSearch] Strategy failed:`, r.reason);
        }
      }
      console.log(`[HashtagSearch] Total raw events: ${allEvents.length}`);
      const unique = allEvents.filter(e => {
        if (tagPostIdsRef.current.has(e.id)) return false;
        tagPostIdsRef.current.add(e.id);
        return true;
      });
      for (const e of unique) eventStore.add(e);
      const sorted = unique.sort((a, b) => b.created_at - a.created_at);
      setTagPosts(sorted);
      if (sorted.length < SEARCH_PAGE_SIZE) setHasMore(false);
      const profilePks = Array.from(new Set(sorted.map(e => e.pubkey))).slice(0, 50);
      if (profilePks.length > 0) fetchProfilesCached(profilePks);
    } catch {
      setTagPosts([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [updateUrl]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || !activeTag) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    const oldest = tagPosts[tagPosts.length - 1];
    if (!oldest) { setHasMore(false); loadingMoreRef.current = false; setIsLoadingMore(false); return; }

    try {
      const tagFilter: any = { kinds: [1], "#t": [activeTag], limit: SEARCH_PAGE_SIZE, until: oldest.created_at - 1 };
      const searchFilter: any = { kinds: [1], search: `#${activeTag}`, limit: SEARCH_PAGE_SIZE, until: oldest.created_at - 1 };
      const relayResults = await Promise.allSettled([
        queryWithTimeout(pool.querySync(DEFAULT_RELAYS.slice(0, 5), tagFilter), 10000, []),
        queryWithTimeout(pool.querySync(SEARCH_RELAYS, searchFilter), 10000, []),
      ]);
      const events: Event[] = [];
      for (const r of relayResults) {
        if (r.status === "fulfilled") events.push(...r.value);
      }
      const newPosts = events.filter(e => {
        if (tagPostIdsRef.current.has(e.id)) return false;
        tagPostIdsRef.current.add(e.id);
        return true;
      });
      for (const e of newPosts) eventStore.add(e);
      const sorted = newPosts.sort((a, b) => b.created_at - a.created_at);
      if (sorted.length > 0) {
        setTagPosts(prev => [...prev, ...sorted]);
        const profilePks = Array.from(new Set(sorted.map(e => e.pubkey))).slice(0, 50);
        if (profilePks.length > 0) fetchProfilesCached(profilePks);
      }
      if (sorted.length < SEARCH_PAGE_SIZE) setHasMore(false);
    } catch {
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [activeTag, tagPosts, hasMore]);

  const handleSubmit = () => {
    if (query.trim()) searchTag(query.trim());
  };

  const handleClear = () => {
    setQuery("");
    setSearched(false);
    setActiveTag(null);
    setTagPosts([]);
    tagPostIdsRef.current.clear();
    setHasMore(true);
    setTrustedVoices([]);
    trustedVoicesTagRef.current = null;
    updateUrl({ q: null });
  };

  useEffect(() => {
    if (!activeTag) {
      setTrustedVoices([]);
      trustedVoicesTagRef.current = null;
      return;
    }
    if (trustedVoicesTagRef.current === activeTag) return;
    trustedVoicesTagRef.current = activeTag;
    setTrustedVoicesLoading(true);
    const tag = activeTag;
    discoverByTopic(tag, 10).then(({ events, wotScores }) => {
      if (trustedVoicesTagRef.current !== tag) return;
      if (wotScores.size > 0) injectScores(wotScores);
      const profiles = events
        .filter(e => e.pubkey !== pubkey)
        .map(e => {
          const inf = wotScores.get(e.pubkey) ?? scores?.get(e.pubkey) ?? null;
          const tier: SignalTier = flaggedPubkeys?.has(e.pubkey) ? "flagged" : getSignalTier(inf);
          return { event: e, tier, influence: inf };
        })
        .slice(0, 10);
      setTrustedVoices(profiles);
    }).catch(() => {
      if (trustedVoicesTagRef.current === tag) setTrustedVoices([]);
    }).finally(() => {
      if (trustedVoicesTagRef.current === tag) setTrustedVoicesLoading(false);
    });
  }, [activeTag, pubkey, scores, flaggedPubkeys, injectScores]);

  const relatedTags = useMemo(() => {
    if (!activeTag || tagPosts.length === 0) return [];
    const tags = new Set<string>();
    for (const post of tagPosts) {
      for (const t of post.tags) {
        if (t[0] === "t" && t[1]) {
          const ht = t[1].toLowerCase();
          if (ht !== activeTag) tags.add(ht);
        }
      }
    }
    return Array.from(tags).slice(0, 12);
  }, [activeTag, tagPosts]);

  const filteredTrendingTags = useMemo(() => {
    if (!query.trim()) return trendingTags;
    const q = query.toLowerCase();
    return trendingTags.filter(t => t.hashtag.toLowerCase().includes(q));
  }, [trendingTags, query]);

  return (
    <div>
      <TabSearchBar
        query={query}
        setQuery={setQuery}
        onSubmit={handleSubmit}
        onClear={handleClear}
        loading={loading}
        placeholder="Search hashtags..."
      />

      {searched && activeTag ? (
        loading ? (
          <LoadingState message={`Searching #${activeTag}...`} />
        ) : (
          <div className="space-y-4" data-testid="container-hashtag-results">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12px] text-muted-foreground font-medium">
                #{activeTag}
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                <FollowHashtagButton tag={activeTag} />
                <SaveFrequencyButton query={`#${activeTag}`} hashtags={[activeTag]} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-snug -mt-2">
              <span className="text-foreground">Follow</span> adds #{activeTag} to your portable hashtags (shared across all your Nostr apps).{" "}
              <span className="text-foreground">Save Feed</span> keeps a custom feed here in Relay Outpost.
            </p>
            {relatedTags.length > 0 && (
              <div>
                <p className="text-[12px] text-muted-foreground mb-2 font-medium">Related</p>
                <div className="flex flex-wrap gap-1.5">
                  {relatedTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => { setQuery(tag); searchTag(tag); }}
                      className="cursor-pointer"
                    >
                      <Badge
                        variant="outline"
                        className="text-xs border-brand/15 text-brand cursor-pointer hover:border-brand/30 transition-colors"
                        data-testid={`badge-related-${tag}`}
                      >
                        #{tag}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {trustedVoices.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Brain className="w-3.5 h-3.5 text-brand" />
                  <span className="text-[12px] font-semibold text-foreground">Trusted voices</span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">{trustedVoices.length}</span>
                </div>
                <div className="hidden sm:flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                  {trustedVoices.map(({ event: profile, tier, influence }) => {
                    const content = (() => { try { return getProfileContent(profile); } catch { return null; } })();
                    const npub = formatNpub(profile.pubkey);
                    const ringColor = getSignalTierRingColor(tier);
                    return (
                      <div key={profile.pubkey} className="flex flex-col items-center gap-1 w-[76px] shrink-0 group">
                        <Link href={`/profile/${npub}`}>
                          <div className="flex flex-col items-center gap-1 cursor-pointer">
                            <div className="relative">
                              <Avatar className={`w-11 h-11 ring-2 ${ringColor} border-2 border-background`}>
                                <AvatarImage src={content?.picture} alt={content?.display_name || content?.name || "User"} />
                                <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-[10px] font-bold">
                                  {(content?.display_name || content?.name || "?").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              {getTrustMark(tier) && (
                                <span className="absolute -bottom-0.5 -right-0.5 bg-background rounded-full p-0.5">
                                  <TrustMark tier={tier} className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                            <span className="text-[12px] text-foreground group-hover:text-brand transition-colors truncate w-full text-center leading-tight">
                              {content?.display_name || content?.name || shortenNpub(npub)}
                            </span>
                          </div>
                        </Link>
                        <QuickFollowButton targetPubkey={profile.pubkey} isFollowed={followSet.has(profile.pubkey)} />
                      </div>
                    );
                  })}
                </div>
                <MobileTrustedVoices voices={trustedVoices} followSet={followSet} />
              </div>
            )}
            {trustedVoicesLoading && trustedVoices.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <RelayOutpostInlineLoader className="w-4 h-4 text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">Finding people your network trusts…</span>
              </div>
            )}
            {tagPosts.length > 0 ? (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground">
                  {visibleTagPosts.length} post{visibleTagPosts.length !== 1 ? "s" : ""} mentioning #{activeTag}
                </p>
                {/* Virtualized: a spammed hashtag can return a wall of
                    media-heavy posts — rendering them all at once OOM-kills
                    mobile Safari (white screen). Constant DOM cost instead. */}
                <VirtualFeed
                  items={visibleTagPosts}
                  getKey={(event) => event.id}
                  estimateSize={340}
                  gap={12}
                  onReachEnd={loadMore}
                  renderItem={(event) => <PostBoundary id={event.id}><NostrPost event={event} /></PostBoundary>}
                />
                <ScrollSentinel onLoadMore={loadMore} isLoading={isLoadingMore} hasMore={hasMore} />
              </div>
            ) : (
              <EmptyState icon={Hash} message={`No posts found for #${activeTag}`} hint="Try a different hashtag or check trending tags below." />
            )}
          </div>
        )
      ) : (
        <div className="space-y-6" data-testid="container-hashtags-discovery">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-brand drop-shadow-[0_0_4px_rgba(13,15,18,0.5)]" />
              <h3 className="text-sm font-semibold">Trending</h3>
              <span className="text-xs font-mono text-muted-foreground">24H</span>
            </div>
            {trendingLoading ? (
              <LoadingState message="Loading trending tags..." />
            ) : filteredTrendingTags.length === 0 ? (
              <EmptyState icon={Hash} message="No matching tags" hint="Try a different keyword." />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {filteredTrendingTags.map(item => (
                  <TrendTicker key={item.hashtag} item={item} onSearchTag={(tag) => { setQuery(tag); searchTag(tag); }} />
                ))}
              </div>
            )}
          </div>

          {!query.trim() && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Compass className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-semibold text-foreground">Browse Topics</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TOPIC_CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  return (
                    <div key={cat.name} className="glass-card rounded-lg border p-3">
                      <div className="flex items-center gap-2 mb-2.5">
                        <Icon className="w-3.5 h-3.5 text-brand" />
                        <span className="text-[12px] font-semibold text-foreground">{cat.name}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cat.tags.map(tag => (
                          <button
                            key={tag}
                            onClick={() => { setQuery(tag); searchTag(tag); }}
                            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs text-foreground hover:text-brand dark:hover:text-brand bg-brand/[0.05]/[0.06] hover:bg-brand/[0.1] border border-brand/10 hover:border-brand/25 transition-all duration-200 cursor-pointer"
                          >
                            <Hash className="w-2.5 h-2.5 opacity-60" />{tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function LiveTab({ urlQuery, updateUrl }: TabProps) {
  const [query, setQuery] = useState(urlQuery);
  const [liveEvents, setLiveEvents] = useState<LiveEventInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // Three outcomes, not two: data, genuinely quiet, or we never got to ask
  // (RELAY_REACHABILITY.md). This tab used to collapse the third into the
  // second — a cold-start connection stampede left querySync empty-handed at
  // its deadline and "No live events" painted over 21 real ones (measured
  // 2026-08-31 via the app's own pool: warm 42 events / cold 0).
  const [unreachable, setUnreachable] = useState(false);
  const [fetchNonce, setFetchNonce] = useState(0);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    // An empty cached array is NOT an answer — one slow first fetch used to
    // cache [] and paint "No live events" for the whole session (the same
    // fabricated-empty class: only positive results count).
    const cached = getSessionCache<LiveEventInfo[]>("search_discovery_live");
    if (cached && cached.length > 0 && fetchNonce === 0) {
      setLiveEvents(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setUnreachable(false);
    (async () => {
      try {
        const relays = Array.from(new Set([...LIVE_EVENT_RELAYS, ...LIVE_STREAM_RELAYS]));
        const since = Math.floor(Date.now() / 1000) - 60 * 60 * 12;
        // queryAnswered settles with whatever arrived AND says whether any
        // relay actually answered — the generous budget rides out the
        // page-load connection stampede.
        const { events, answered } = await queryAnswered(relays, { kinds: [KIND_LIVE_EVENT], limit: 400, since }, 12_000);
        if (cancelled) return;
        const parsed = (events as Event[]).map(parseLiveEvent).filter((e): e is LiveEventInfo => e !== null)
          // Newest edition first BEFORE the first-wins dedupe below — relays
          // return replaceables in arbitrary order, so without this an older
          // "live" edition could shadow the newer "ended" one and a finished
          // stream would keep showing as live here.
          .sort((a, b) => b.event.created_at - a.event.created_at);
        const seen = new Set<string>();
        const deduped: LiveEventInfo[] = [];
        for (const e of parsed) {
          const dTag = e.event.tags.find(t => t[0] === "d")?.[1] || e.id;
          const key = `${e.event.pubkey}:${dTag}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(e);
        }
        const live = deduped
          .filter(e => e.status === "live")
          .filter(e => !!e.streaming && e.streaming.length > 0);
        const sorted = live.sort((a, b) => {
          return (b.participants ?? 0) - (a.participants ?? 0) || b.event.created_at - a.event.created_at;
        });
        setLiveEvents(sorted);
        // Cache only a real answer — see the empty-cache guard above.
        if (sorted.length > 0) setSessionCache("search_discovery_live", sorted);
        if (!answered && sorted.length === 0) setUnreachable(true);
      } catch {
        if (!cancelled) setUnreachable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchNonce]);

  const filtered = useMemo(() => {
    if (!query.trim()) return liveEvents;
    const q = query.toLowerCase();
    return liveEvents.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.summary || "").toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [liveEvents, query]);

  return (
    <div>
      <MissionBriefing pageId="live" steps={LIVE_STREAMS_BRIEFING} />
      <TabSearchBar
        query={query}
        setQuery={setQuery}
        onSubmit={() => updateUrl({ q: query.trim() || null })}
        onClear={() => { setQuery(""); updateUrl({ q: null }); }}
        loading={false}
        placeholder="Filter live streams..."
      />

      {loading ? (
        <LoadingState message="Looking for live streams…" />
      ) : unreachable && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground" data-testid="live-tab-unreachable">
          Couldn't reach the stream relays — nothing is known about live broadcasts right now.
          <button
            type="button"
            onClick={() => setFetchNonce(n => n + 1)}
            className="px-4 py-2 rounded-full text-xs font-medium border border-brand/30 text-brand hover:bg-brand/10 transition-colors"
            data-testid="button-live-tab-retry"
          >
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Radio}
          message={query ? "No matching streams" : "No live events right now"}
          hint={query ? "Try different keywords." : "Live streams come and go. Check back for the next one."}
        />
      ) : (
        <div className="space-y-2" data-testid="container-live-results">
          <p className="text-xs text-muted-foreground mb-3 italic">Happening now across the network. Tune in, drop a zap, keep moving.</p>
          {filtered.map(live => (
            <LiveEventCard key={live.id} liveEvent={live} />
          ))}
        </div>
      )}
    </div>
  );
}




function tryDecodeEventAuthor(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^npub1[02-9ac-hj-np-z]+$/i.test(trimmed)) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") return decoded.data;
    } catch {}
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

// Browsing surface: no top-right action cluster. Every per-event action —
// RSVP (Going pins into the in-app calendar), Add-to-calendar, and Share —
// lives in EventCard's single bottom action row. Share is routed through
// onShare so the row's compact ⤴ opens the ShareEventDialog.
//
// Defense in depth: each card is wrapped in an ErrorBoundary so one malformed
// event that still slips past parsing (e.g. an unexpected object in a rendered
// field) degrades to a small placeholder instead of blanking the whole tab.
function EventCardRow({ ce, isPast, onShare }: {
  ce: CalendarEventData;
  isPast: boolean;
  onShare: (ce: CalendarEventData) => void;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div
          className="glass-card rounded-xl border p-3 text-xs text-muted-foreground"
          data-testid={`event-card-error-${ce.id.slice(0, 8)}`}
        >
          Couldn't display this event.
        </div>
      }
    >
      <EventCard ce={ce} dimmed={isPast} onShare={onShare} />
    </ErrorBoundary>
  );
}

function EventsTab({ urlQuery, updateUrl }: TabProps) {
  useNostrAuth();
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<CalendarEventData[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [expandWindow, setExpandWindow] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<{ pubkey: string; name: string; picture?: string } | null>(null);
  const [shareEvent, setShareEvent] = useState<CalendarEventData | null>(null);
  const [suggestions, setSuggestions] = useState<Event[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const lastFetchSeq = useRef(0);
  const suggestSeq = useRef(0);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUrlQueryRef = useRef("");

  const authorFromQuery = useMemo(() => tryDecodeEventAuthor(query), [query]);

  const runSearch = useCallback(async (qOverride?: string, fromUrl = false) => {
    const seq = ++lastFetchSeq.current;
    const q = (qOverride ?? query).trim();
    setLoading(true);
    setSearched(true);
    setShowPast(false);
    if (!fromUrl && q) updateUrl({ q });
    try {
      let authors: string[] | undefined;
      let textQuery = q;
      if (authorFilter) {
        authors = [authorFilter.pubkey];
        textQuery = "";
      } else if (authorFromQuery) {
        authors = [authorFromQuery];
        textQuery = "";
      }
      const data = await searchCalendarEvents(textQuery, authors);
      if (seq !== lastFetchSeq.current) return;
      data.sort((a, b) => {
        const ad = getCalendarEventDate(a);
        const bd = getCalendarEventDate(b);
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad.getTime() - bd.getTime();
      });
      setResults(data);
    } catch (err) {
      console.error("[EventsTab] search failed:", err);
    } finally {
      if (seq === lastFetchSeq.current) setLoading(false);
    }
  }, [query, authorFilter, authorFromQuery, updateUrl]);

  // Auto-discover upcoming events on first mount so the tab feels alive.
  useEffect(() => {
    if (autoLoaded) return;
    setAutoLoaded(true);
    void runSearch(urlQuery, !!urlQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync URL query into state and re-run when it changes.
  useEffect(() => {
    if (urlQuery !== prevUrlQueryRef.current) {
      prevUrlQueryRef.current = urlQuery;
      setQuery(urlQuery);
      if (urlQuery) {
        void runSearch(urlQuery, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  // Re-run whenever the picked author changes.
  useEffect(() => {
    if (!autoLoaded) return;
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorFilter]);

  // Live keyword search: re-run (debounced) as the user types so a keyword like
  // "austin" filters events by title/description/location/hashtags without
  // hitting Enter. fromUrl=true so we don't churn the URL on every keystroke
  // (the form submit still records ?q=). Clearing restores the broad list.
  // Author-filtered + initial-load cases are handled by the effects above.
  useEffect(() => {
    if (authorFilter || !autoLoaded) return;
    const t = setTimeout(() => { void runSearch(query, true); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Debounced creator suggestions when typing a name.
  useEffect(() => {
    if (suggestDebounce.current) {
      clearTimeout(suggestDebounce.current);
      suggestDebounce.current = null;
    }
    const trimmed = query.trim();
    if (authorFilter || authorFromQuery || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestLoading(false);
      return;
    }
    const cached = searchCachedProfiles(trimmed, 6) as Event[];
    if (cached.length > 0) {
      setSuggestions(cached);
      setShowSuggestions(true);
    }
    setSuggestLoading(true);
    const seq = ++suggestSeq.current;
    suggestDebounce.current = setTimeout(async () => {
      try {
        const remote = await searchUsersNip50(trimmed, 6);
        if (seq !== suggestSeq.current) return;
        const seen = new Set<string>();
        const merged: Event[] = [];
        for (const e of [...cached, ...remote]) {
          if (!seen.has(e.pubkey)) {
            seen.add(e.pubkey);
            merged.push(e);
          }
        }
        setSuggestions(merged.slice(0, 6));
        if (merged.length > 0) setShowSuggestions(true);
      } catch (err) {
        console.warn("[EventsTab] suggest failed:", err);
      } finally {
        if (seq === suggestSeq.current) setSuggestLoading(false);
      }
    }, 280);
    return () => {
      if (suggestDebounce.current) {
        clearTimeout(suggestDebounce.current);
        suggestDebounce.current = null;
      }
    };
  }, [query, authorFilter, authorFromQuery]);

  const pickAuthor = useCallback((event: Event) => {
    let name = "";
    let picture: string | undefined;
    try {
      const c = JSON.parse(event.content);
      name = safeString(c.display_name) || safeString(c.name) || "";
      picture = safeString(c.picture);
    } catch {}
    if (!name) name = event.pubkey.slice(0, 8) + "...";
    setAuthorFilter({ pubkey: event.pubkey, name, picture });
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    updateUrl({ q: null });
  }, [updateUrl]);

  const clearAuthorFilter = useCallback(() => setAuthorFilter(null), []);

  const handleClear = useCallback(() => {
    ++lastFetchSeq.current;
    setQuery("");
    setSuggestions([]);
    setShowSuggestions(false);
    updateUrl({ q: null });
    if (authorFilter) setAuthorFilter(null);
    else void runSearch("", true);
  }, [authorFilter, runSearch, updateUrl]);

  const isDiscoveryMode = !authorFilter && !query.trim();

  const { pastEvents, upcomingEvents, hiddenByWindow } = useMemo(() => {
    const now = Date.now();
    const past: CalendarEventData[] = [];
    const upcoming: CalendarEventData[] = [];
    for (const ce of results) {
      const d = getCalendarEventDate(ce);
      if (d && d.getTime() < now) past.push(ce);
      else upcoming.push(ce);
    }
    if (!isDiscoveryMode) {
      return { pastEvents: past, upcomingEvents: upcoming, hiddenByWindow: 0, windowLabel: "" };
    }
    const days = expandWindow ? 30 : 10;
    const cutoff = now + days * 24 * 60 * 60 * 1000;
    const within: CalendarEventData[] = [];
    let hidden = 0;
    for (const ce of upcoming) {
      const d = getCalendarEventDate(ce);
      if (d && d.getTime() <= cutoff) within.push(ce);
      else hidden += 1;
    }
    // Round-robin by author so a single account can't dominate the feed.
    const byAuthor = new Map<string, CalendarEventData[]>();
    for (const ce of within) {
      const list = byAuthor.get(ce.pubkey);
      if (list) list.push(ce);
      else byAuthor.set(ce.pubkey, [ce]);
    }
    const queues = Array.from(byAuthor.values());
    const mixed: CalendarEventData[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const q of queues) {
        const next = q.shift();
        if (next) {
          mixed.push(next);
          added = true;
        }
      }
    }
    return {
      pastEvents: past,
      upcomingEvents: mixed,
      hiddenByWindow: hidden,
      windowLabel: `Next ${days} days`,
    };
  }, [results, isDiscoveryMode, expandWindow]);

  // When the user starts searching or picks an author, drop the window cap.
  useEffect(() => {
    if (!isDiscoveryMode) setExpandWindow(false);
  }, [isDiscoveryMode]);

  return (
    <div data-testid="container-events-tab">
      {authorFilter ? (
        <div className="flex items-center gap-2 mb-4 rounded-lg border border-brand/25 bg-brand/[0.06]/[0.08] px-3 py-2">
          <Avatar className="w-7 h-7 shrink-0 border border-border/30">
            <AvatarImage src={authorFilter.picture} alt={authorFilter.name} />
            <AvatarFallback className="text-[10px] bg-muted">{authorFilter.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-brand font-medium">Events by</div>
            <div className="text-sm font-medium text-foreground truncate">{authorFilter.name}</div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={clearAuthorFilter}
            data-testid="button-clear-event-author"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="relative mb-4">
          <form
            onSubmit={(e) => { e.preventDefault(); void runSearch(); }}
            data-testid="form-events-search"
          >
            <SearchPill
              placeholder="Search events…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              data-testid="input-events-search"
              trailing={(query || loading) ? (
                <span className="flex items-center">
                  {loading && <RelayOutpostInlineLoader className="w-4 h-4 mr-1 text-brand" />}
                  <button
                    type="button"
                    onClick={handleClear}
                    className="p-2 rounded-full hover:bg-muted/50 transition-colors"
                    data-testid="button-events-search-clear"
                  >
                    <X className="w-4 h-4 text-muted-foreground/80 hover:text-foreground" />
                  </button>
                </span>
              ) : undefined}
            />
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <div
              className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg overflow-hidden shadow-lg border border-border/30 max-h-[280px] overflow-y-auto bg-popover"
              data-testid="dropdown-events-author-suggestions"
            >
              {suggestions.map(ev => {
                let name = "";
                let nip05 = "";
                let picture = "";
                try {
                  const c = JSON.parse(ev.content);
                  // Coerce: a malformed profile can carry an object/array in a
                  // name/nip05/picture field, which would crash the text node.
                  name = safeString(c.display_name) || safeString(c.name) || "";
                  nip05 = safeString(c.nip05) || "";
                  picture = safeString(c.picture) || "";
                } catch {}
                if (!name) name = `npub1...${ev.pubkey.slice(-6)}`;
                return (
                  <button
                    key={ev.pubkey}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickAuthor(ev)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/10 transition-colors"
                    data-testid={`suggest-events-author-${ev.pubkey.slice(0, 8)}`}
                  >
                    <Avatar className="w-8 h-8 shrink-0 border border-border/30">
                      <AvatarImage src={picture} alt={name} />
                      <AvatarFallback className="bg-muted text-foreground/60">
                        <UserIcon className="w-3.5 h-3.5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{name}</div>
                      {nip05 && <div className="text-xs text-muted-foreground truncate">{nip05}</div>}
                    </div>
                  </button>
                );
              })}
              <div className="px-3 py-1.5 text-[13px] text-muted-foreground text-center border-t border-border/20 font-medium">
                {suggestLoading ? "Searching…" : "Tap a creator to see their events"}
              </div>
            </div>
          )}
        </div>
      )}

      {loading && results.length === 0 ? (
        <LoadingState message="Loading events..." />
      ) : !loading && searched && results.length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          message="No events found"
          hint={authorFilter
            ? `${authorFilter.name} hasn't posted any calendar events yet.`
            : "Try a different keyword or look up a creator by name."}
        />
      ) : results.length > 0 ? (
        <div className="space-y-3" data-testid="container-events-results">
          <p className="text-xs text-muted-foreground">
            {results.length} event{results.length !== 1 ? "s" : ""}
            {upcomingEvents.length > 0 && ` · ${upcomingEvents.length} upcoming`}
            {pastEvents.length > 0 && ` · ${pastEvents.length} past`}
          </p>

          {upcomingEvents.length > 0 && (
            <div className="space-y-2">
              {upcomingEvents.map(ce => (
                <EventCardRow key={ce.id} ce={ce} isPast={false} onShare={setShareEvent} />
              ))}
            </div>
          )}

          {isDiscoveryMode && (hiddenByWindow > 0 || expandWindow) && (
            <div className="flex items-center justify-center pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandWindow(v => !v)}
                className="text-xs text-muted-foreground hover:text-brand gap-1.5"
                data-testid="button-toggle-event-window"
              >
                {expandWindow
                  ? "Show next 10 days only"
                  : `Show next 30 days${hiddenByWindow > 0 ? ` (+${hiddenByWindow} more)` : ""}`}
              </Button>
            </div>
          )}

          {pastEvents.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowPast(s => !s)}
                className="flex items-center gap-1.5 w-full text-left py-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                data-testid="button-toggle-past-events"
              >
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform ${showPast ? "rotate-90" : ""}`} />
                <span className="text-[13px] font-medium text-muted-foreground">Past</span>
                <span className="text-xs text-muted-foreground">({pastEvents.length})</span>
              </button>
              {showPast && (
                <div className="space-y-2 mt-1.5 pl-1">
                  {pastEvents.map(ce => (
                    <EventCardRow key={ce.id} ce={ce} isPast={true} onShare={setShareEvent} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {shareEvent && <ShareEventDialog ce={shareEvent} onClose={() => setShareEvent(null)} />}
    </div>
  );
}

// Follows a hashtag into the PORTABLE kind-10015 interests list (shared across
// all the user's Nostr apps) — distinct from "Save Feed" (a kind-30078 custom
// feed local to Relay Outpost). Wipe-guarded via useFollowedHashtags.
function FollowHashtagButton({ tag }: { tag: string }) {
  const { isFollowed, follow, unfollow, pending, canFollow } = useFollowedHashtags();
  const following = isFollowed(tag);
  const busy = pending === tag.replace(/^#+/, "").toLowerCase();

  if (!canFollow) return null;

  return (
    <Button
      variant={following ? "secondary" : "outline"}
      size="sm"
      className="gap-1.5 text-xs shrink-0"
      onClick={() => (following ? unfollow(tag) : follow(tag))}
      disabled={busy}
      data-testid="button-follow-hashtag"
      title={following
        ? "In your portable hashtags — shared across all your Nostr apps. Tap to unfollow."
        : "Add to your portable hashtags — shared across all your Nostr apps."}
    >
      {following ? <Check className="w-3.5 h-3.5" /> : <Hash className="w-3.5 h-3.5" />}
      {busy ? "..." : following ? "Following" : "Follow"}
    </Button>
  );
}

function SaveFrequencyButton({ query, hashtags }: { query: string; hashtags?: string[] }) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const { createFeed } = useNostrFeeds();
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const cacheKey = `${query}|${(hashtags || []).join(",")}`;
  const prevKeyRef = useRef(cacheKey);
  useEffect(() => {
    if (prevKeyRef.current !== cacheKey) {
      prevKeyRef.current = cacheKey;
      setSaved(false);
    }
  }, [cacheKey]);

  const handleSave = async () => {
    if (saved || isSaving) return;
    setIsSaving(true);
    try {
      const hasHashtags = hashtags && hashtags.length > 0;
      const isHashtag = hasHashtags || query.startsWith("#");
      const tagList = hasHashtags
        ? hashtags.map(h => h.replace(/^#/, "").toLowerCase())
        : isHashtag
          ? [query.replace(/^#/, "").toLowerCase()]
          : [];
      const keywords = tagList.length > 0 ? [] : [query.trim()];
      const name = tagList.length > 0
        ? tagList.map(t => `#${t}`).join(" ")
        : query.trim();

      const result = await createFeed({
        name,
        hashtags: tagList,
        authorPubkeys: [],
        includeKeywords: keywords,
        excludeKeywords: [],
        contentType: "all",
        source: "custom",
      });
      if (result) {
        setSaved(true);
        toast({ title: "Feed saved", description: "Find it in your Feeds tab." });
      }
    } catch {
      toast({ title: "Could not save", description: "Something went wrong. Try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (!pubkey || !query.trim()) return null;

  return (
    <Button
      variant={saved ? "secondary" : "outline"}
      size="sm"
      className="gap-1.5 text-xs shrink-0"
      onClick={handleSave}
      disabled={isSaving || saved}
      data-testid="button-save-frequency"
    >
      {saved ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
      {saved ? "Saved" : isSaving ? "Saving..." : "Save Feed"}
    </Button>
  );
}

function ScrollSentinel({ onLoadMore, isLoading, hasMore }: { onLoadMore: () => void; isLoading: boolean; hasMore: boolean }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoading && hasMore) onLoadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, isLoading, hasMore]);

  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="flex items-center justify-center py-6" data-testid="container-scroll-sentinel">
      {isLoading && <RelayOutpostInlineLoader className="w-5 h-5" />}
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12" data-testid="container-loading">
      <RelayOutpostInlineLoader className="w-6 h-6 mb-3" />
      <p className="text-xs text-muted-foreground font-mono tracking-wider">{message}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, message, hint, nudge }: {
  icon: typeof FileText;
  message: string;
  hint: string;
  nudge?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center" data-testid="container-empty-results">
      <OttoEmpty mood="looking" size={96} className="mb-2 text-foreground" />
      <p className="text-sm font-medium mb-1">{message}</p>
      <p className="text-[13px] text-muted-foreground max-w-xs">{hint}</p>
      {nudge && (
        <div className="mt-4 px-4 py-2 rounded-md bg-primary/5 border border-primary/10 max-w-xs">
          <p className="text-xs text-brand italic">{nudge}</p>
        </div>
      )}
    </div>
  );
}

function TrendTicker({ item, onSearchTag }: { item: TrendingHashtag; onSearchTag: (tag: string) => void }) {
  const isRising = useMemo(() => {
    const a = item.activity;
    if (a.length < 4) return false;
    const firstHalf = a.slice(0, 4).reduce((s, v) => s + v, 0);
    const secondHalf = a.slice(4).reduce((s, v) => s + v, 0);
    return secondHalf > firstHalf * 1.3;
  }, [item.activity]);

  return (
    <button
      onClick={() => onSearchTag(item.hashtag)}
      className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-brand/25 dark:border-brand/15 bg-brand/[0.06]/[0.08] hover:bg-brand/[0.12]/[0.15] hover:border-brand/40 dark:hover:border-brand/30 transition-all duration-200 cursor-pointer"
      data-testid={`button-trending-${item.hashtag}`}
    >
      <Hash className="w-2.5 h-2.5 text-brand/70 group-hover:text-brand transition-colors" />
      <span className="text-xs font-medium text-foreground group-hover:text-brand transition-colors truncate">{item.hashtag}</span>
      {isRising && <TrendingUp className="w-2.5 h-2.5 text-emerald-800 dark:text-emerald-400/80 shrink-0" />}
    </button>
  );
}

const TOPIC_CATEGORIES: { name: string; icon: typeof Zap; tags: string[] }[] = [
  { name: "Bitcoin & Lightning", icon: Zap, tags: ["bitcoin", "lightning", "zaps", "plebchain", "zapathon"] },
  { name: "Nostr & Apps", icon: Globe, tags: ["nostr", "asknostr", "grownostr", "damus", "primal", "amethyst", "wot"] },
  { name: "Dev & Tech", icon: Code2, tags: ["tech", "devstr", "opensource", "science", "privacy"] },
  { name: "Creative", icon: Palette, tags: ["photography", "artstr", "music", "memestr", "bookstr"] },
  { name: "Lifestyle", icon: Coffee, tags: ["fitness", "runstr", "health", "foodstr", "coffeechain", "travel"] },
  { name: "World & Culture", icon: Compass, tags: ["news", "freedom", "war", "christianity", "motivation", "sports", "gaming"] },
];


function LiveEventCard({ liveEvent }: { liveEvent: LiveEventInfo }) {
  const dTag = liveEvent.event.tags.find(t => t[0] === "d")?.[1] || "";
  const naddr = nip19.naddrEncode({ identifier: dTag, pubkey: liveEvent.event.pubkey, kind: KIND_LIVE_EVENT });
  const liveness = useStreamLiveness(liveEvent.status === "live" ? liveEvent.streaming : undefined);
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, liveEvent.event.pubkey), [liveEvent.event.pubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(liveEvent.event.pubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;
  const [imgError, setImgError] = useState(false);

  const isOffline = liveness === "offline";
  const isVerified = liveness === "verified-live";

  const statusColor = isOffline
    ? "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"
    : liveEvent.status === "live"
    ? "text-success dark:text-green-400 bg-green-400/10 border-green-400/20"
    : liveEvent.status === "planned"
    ? "text-amber-800 dark:text-amber-400 bg-amber-400/10 border-amber-400/20"
    : "text-muted-foreground bg-muted/50 border-border";

  const statusLabel = isOffline ? "Offline" : liveEvent.status === "live" ? "Live" : liveEvent.status === "planned" ? "Scheduled" : "Ended";

  const age = liveEvent.starts
    ? Math.floor((Date.now() / 1000) - liveEvent.starts)
    : Math.floor((Date.now() / 1000) - liveEvent.event.created_at);
  const ageLabel = age < 3600
    ? `${Math.floor(age / 60)}m ago`
    : age < 86400
    ? `${Math.floor(age / 3600)}h ago`
    : `${Math.floor(age / 86400)}d ago`;

  return (
    <Link href={`/live/${naddr}`}>
      <Card className={`glass-card border-primary/10 hover-elevate cursor-pointer ${isOffline ? "opacity-60" : ""}`} data-testid={`card-live-${liveEvent.id.slice(0, 8)}`}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="w-16 h-10 rounded-md shrink-0 border border-primary/15 overflow-hidden relative bg-primary/10">
              {liveEvent.image && !imgError ? (
                <img
                  src={liveEvent.image}
                  alt={liveEvent.title}
                  className="w-full h-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center gap-1.5 bg-gradient-to-br from-[#0e0a1a] via-[#0c0818] to-[#080610] relative overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(13,15,18,0.15)_0%,transparent_70%)]" />
                  <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(1px 1px at 10px 8px, white, transparent), radial-gradient(1px 1px at 30px 5px, white, transparent), radial-gradient(1px 1px at 50px 12px, white, transparent)' }} />
                  <div className="relative z-10 flex items-center gap-1.5">
                    <Avatar className="w-6 h-6 border border-brand/30 shadow-sm shadow-brand/20">
                      <AvatarImage src={avatarUrl} alt={displayName} className="object-cover" />
                      <AvatarFallback className="bg-foreground/[0.08] text-foreground/80 text-[8px] font-bold">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium text-brand truncate max-w-[44px] leading-tight">{displayName}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold truncate flex-1">{liveEvent.title}</p>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant="outline" className={`text-xs ${statusColor}`}>
                    {liveEvent.status === "live" && !isOffline && <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1 animate-pulse" />}
                    {isOffline && <Signal className="w-2.5 h-2.5 mr-0.5" />}
                    {statusLabel}
                  </Badge>
                  {isVerified && (
                    <Badge variant="outline" className="text-xs text-success dark:text-green-400 bg-green-400/10 border-green-400/20 px-1">
                      <Check className="w-2.5 h-2.5" />
                    </Badge>
                  )}
                </div>
              </div>
              {liveEvent.summary && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{liveEvent.summary}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">{ageLabel}</span>
                {liveEvent.participants != null && liveEvent.participants > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {liveEvent.participants}
                  </span>
                )}
                {liveEvent.tags.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {liveEvent.tags.slice(0, 3).map(t => `#${t}`).join(" ")}
                  </span>
                )}
                {liveEvent.streaming && !isOffline && (
                  <span
                    className="text-xs text-brand flex items-center gap-0.5 ml-auto"
                    data-testid={`button-play-${liveEvent.id.slice(0, 8)}`}
                  >
                    <Play className="w-3 h-3" /> Tune In
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function VouchesTab({ urlQuery, updateUrl }: TabProps) {
  // The vouches tab is hidden for the public beta and shows a placeholder;
  // it fetches nothing until the feature ships.



  return (
    <section className="relative min-h-[420px]">
      <div
        className="absolute inset-0 rounded-xl hidden dark:block"
        style={{
          background: `rgb(5, 2, 15)`,
        }}
      />
      <div
        className="absolute inset-0 rounded-xl dark:hidden"
        style={{
          background: `rgb(250, 248, 255)`,
        }}
      />

      <div className="absolute inset-0 overflow-hidden rounded-xl dark:block hidden">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              width: `${Math.random() * 2 + 0.5}px`,
              height: `${Math.random() * 2 + 0.5}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.4 + 0.1,
              animation: `pulse ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      <div className="absolute inset-0 overflow-hidden rounded-xl dark:hidden">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-brand"
            style={{
              width: `${Math.random() * 2 + 0.5}px`,
              height: `${Math.random() * 2 + 0.5}px`,
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.15 + 0.05,
              animation: `pulse ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center justify-center min-h-[420px] px-6 py-12 text-center">
        <div className="mb-5">
          <ShieldCheck className="w-10 h-10 text-brand" />
        </div>

        <h3 className="text-base text-foreground mb-2 font-medium">
          Network vouches
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground max-w-[280px] mb-4">
          People vouching for each other across the Nostr network. A real trust layer built by real users is forming here.
        </p>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/[0.08] dark:bg-brand/10 border border-brand/15 mb-5">
          <Lock className="w-3 h-3 text-brand/60 dark:text-brand/50" />
          <span className="text-[12px] font-medium text-brand">
            Coming soon
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-500/50" />
            Vouches
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-brand/50" />
            Endorsements
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-cyan-500/50" />
            Reputation
          </span>
        </div>
      </div>
    </section>
  );
}
