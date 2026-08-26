import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, subscribeToFeed, subscribeToFeedPersistent, fetchProfilesCached, DEFAULT_RELAYS, getRelaysForPurpose, hasFeedData, markFeedDataLoaded, throttledPoolSubscribe } from "@/lib/nostr";
import { KIND_TEXT_NOTE, KIND_METADATA } from "@/lib/nostr-helpers";
import { KIND_PICTURE } from "@/lib/media-frame";
import { primalStatsCache } from "@/lib/primal-cache";
import { prefetchStatsImmediate } from "@/lib/primal-cache";
import { computeEngagementScore } from "@/lib/engagement";
import { MediaCommentsSection } from "@/components/MediaComments";
import { getEventMediaInfo, extractMediaFromContent, parseImetaTags } from "@/lib/media-utils";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { useTierContentFilter } from "@/hooks/use-tier-content-filter";
import { useProfileFloor } from "@/hooks/use-profile-floor";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDistanceToNow } from "date-fns";
import { LayoutGrid, LayoutList, Columns2, Columns3, Columns4, ImageIcon, Clock, TrendingUp, Flame, ExternalLink, ChevronDown, MessageCircle } from "lucide-react";
import { usePrimalStats } from "@/hooks/use-primal-stats";
import { ImageLightbox } from "@/components/ImageLightbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaInteractionBar } from "@/components/MediaInteractionBar";
import { BtcZapIcon, TextWithUnresolvedNostr } from "@/components/NostrPost";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Event } from "nostr-tools";

const PAGE_SIZE = 30;

function getThreadUrl(eventId: string): string {
  try {
    return `/thread/${nip19.noteEncode(eventId)}`;
  } catch {
    return `/thread/${eventId}`;
  }
}

type SortMode = "latest" | "trending" | "most-zapped" | "top-engaged";

const SORT_OPTIONS: Array<{ value: SortMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "latest", label: "Latest", icon: Clock },
  { value: "trending", label: "Trending", icon: Flame },
];

function getEngagementScore(eventId: string): number {
  const stats = primalStatsCache.get(eventId);
  return computeEngagementScore(stats ?? null);
}

function getTrendingScore(event: Event): number {
  const ageHours = (Date.now() / 1000 - event.created_at) / 3600;
  const decay = Math.max(0.1, 1 / (1 + ageHours / 6));
  return getEngagementScore(event.id) * decay + (1 / (1 + ageHours / 24));
}

function sortEntries<T extends { event: Event }>(entries: T[], mode: SortMode): T[] {
  switch (mode) {
    case "latest":
      return entries.sort((a, b) => b.event.created_at - a.event.created_at);
    case "trending":
      return entries.sort((a, b) => getTrendingScore(b.event) - getTrendingScore(a.event));
    case "most-zapped": {
      return entries.sort((a, b) => {
        const aZap = primalStatsCache.get(a.event.id)?.zapAmount ?? 0;
        const bZap = primalStatsCache.get(b.event.id)?.zapAmount ?? 0;
        return bZap - aZap || b.event.created_at - a.event.created_at;
      });
    }
    case "top-engaged":
      return entries.sort((a, b) => getEngagementScore(b.event.id) - getEngagementScore(a.event.id) || b.event.created_at - a.event.created_at);
    default:
      return entries;
  }
}

function MediaSortBar({ value, onChange, compact = false }: { value: SortMode; onChange: (v: SortMode) => void; compact?: boolean }) {
  const activeOpt = SORT_OPTIONS.find((o) => o.value === value);
  return (
    <>
      <PageTabs
        className="hidden sm:flex"
        equalWidth={false}
        testId="sort-bar"
        ariaLabel="Sort"
        active={value}
        onChange={(v) => onChange(v as SortMode)}
        tabs={SORT_OPTIONS.map((opt) => ({
          key: opt.value,
          label: opt.label,
          icon: opt.icon,
          testId: `sort-${opt.value}`,
        }))}
      />
      <div className="sm:hidden" data-testid="sort-bar-mobile">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={compact ? "h-8 rounded-full px-3 text-xs gap-1" : "w-full justify-between"} data-testid="button-sort-dropdown">
              <span className="flex items-center gap-1.5">
                {activeOpt && <activeOpt.icon className="w-3.5 h-3.5" />}
                {activeOpt?.label || "Sort"}
              </span>
              <ChevronDown className="w-3.5 h-3.5 ml-2 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className={compact ? "w-44 p-1.5" : "w-[var(--radix-popover-trigger-width)] p-1.5"}>
            {SORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isActive = value === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onChange(opt.value)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    isActive ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`sort-mobile-${opt.value}`}
                >
                  {isActive && <span className="w-1 h-1 rounded-full bg-primary shrink-0" />}
                  <Icon className="w-3.5 h-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}


// ---------------------------------------------------------------------------
// Reserved image slots (scroll-stability)
//
// Cards used to render a fixed 288px spinner box and swap it for the image's
// natural height on load — one layout jump PER IMAGE, firing exactly while the
// reader scrolls through lazy-loading rows (iOS Safari has no scroll anchoring,
// so every jump visibly yanks the list: the reported "images feed glitches out
// when scrolling"). Instead, the wrapper owns an aspect-ratio box from first
// paint — imeta `dim` when the event ships one, a previous load of the same URL
// (session cache) otherwise, 4:3 as the cold default — and the image fills it
// with object-cover, so a card's height is settled before the file arrives.
// Unknown-ratio images adjust once on first-ever load and never again.
// ---------------------------------------------------------------------------

const imageAspectCache = new Map<string, number>();

/** Keep reserved boxes sane: panoramas/tall-strips clamp rather than explode. */
function clampAspect(r: number): number {
  return Math.min(Math.max(r, 0.5), 3.5);
}

function useReservedAspect(event: Event, imageUrl: string) {
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const dim = parseImetaTags(event.tags).find((d) => d.url === imageUrl)?.dimensions;
      if (dim && dim.width > 0 && dim.height > 0) return clampAspect(dim.width / dim.height);
    } catch {}
    return imageAspectCache.get(imageUrl) ?? 4 / 3;
  });
  const learnAspect = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const r = clampAspect(img.naturalWidth / img.naturalHeight);
      imageAspectCache.set(imageUrl, r);
      setRatio((prev) => (Math.abs(prev - r) > 0.01 ? r : prev));
    }
  }, [imageUrl]);
  return { ratio, learnAspect };
}

/** Stable per-tile identity: one event can yield several image URLs, but each
 * (event, url) pair is unique (getEventMediaInfo de-dupes per event). Keys must
 * NOT include the render index — index-suffixed keys remount every card below
 * any list change, flashing images back to their loading state mid-scroll. */
function entryKey(entry: { event: Event; imageUrl: string }): string {
  return `${entry.event.id} ${entry.imageUrl}`;
}

function InstagramCard({ event, imageUrl }: { event: Event; imageUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // The comment ICON means "I want to write one" (Instagram: sheet opens with
  // the keyboard ready); the "View all N comments" line means "I want to
  // read". Same section, different entry intent.
  const [composeIntent, setComposeIntent] = useState(false);
  const stats = usePrimalStats(event.id);
  const replyCount = stats?.replies ?? 0;
  const { ratio, learnAspect } = useReservedAspect(event, imageUrl);

  const authorProfile = use$(() => eventStore.replaceable(0, event.pubkey), [event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [event.created_at]);

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return "#";
    }
  }, [event.pubkey]);

  const { text: textContent } = useMemo(() => extractMediaFromContent(event.content), [event.content]);
  // Truncate visually (line-clamp) rather than by character slice — slicing can
  // cut a nostr:npub/nevent token in half, leaving undecodable garbage in the
  // caption. The full text goes through the same mention/reference renderer as
  // regular posts (npub → @name, note refs → compact pill).
  const caption = textContent;

  if (error) return null;

  return (
    <>
      <div className="rounded-xl overflow-hidden border border-border/50 glass-card" data-testid={`ig-card-${event.id}`}>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Link href={profileUrl} data-testid={`link-ig-avatar-${event.id}`}>
            <Avatar className="w-8 h-8 border border-border/40 shrink-0">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[11px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 min-w-0">
            <Link href={profileUrl} className="text-sm font-semibold text-foreground/90 truncate block" data-testid={`link-ig-author-${event.id}`}>
              {displayName}
            </Link>
          </div>
          <span className="text-[11px] text-muted-foreground/60 shrink-0" data-testid={`text-ig-time-${event.id}`}>{timeAgo}</span>
          <Link
            href={getThreadUrl(event.id)}
            className="text-[11px] text-brand/70 hover:text-brand flex items-center gap-0.5 shrink-0"
            data-testid={`link-ig-view-post-${event.id}`}
          >
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>

        {/* Reserved slot: the wrapper owns the height (aspect-ratio, capped at
            70vh like before); the image absolutely fills it. Card height never
            changes when the file lands — see useReservedAspect above. */}
        <div
          className="relative bg-black/20 cursor-pointer overflow-hidden max-h-[70vh] w-full"
          style={{ aspectRatio: `${ratio}` }}
          onClick={() => setFullscreen(true)}
        >
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            </div>
          )}
          <img
            src={imageUrl}
            alt="Posted image"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={(e) => { learnAspect(e); setLoaded(true); }}
            onError={() => setError(true)}
            data-testid={`img-ig-${event.id}`}
          />
        </div>

        <MediaInteractionBar
          event={event}
          onCommentClick={() => { setComposeIntent(true); setShowComments((c) => !c); }}
        />

        {caption && (
          <div className="px-3 pb-2">
            <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2">
              <Link href={profileUrl} className="font-semibold text-foreground/90 mr-1.5" data-testid={`link-ig-caption-author-${event.id}`}>
                {displayName}
              </Link>
              <span data-testid={`text-ig-caption-${event.id}`}><TextWithUnresolvedNostr text={caption} inlineOnly /></span>
            </p>
          </div>
        )}

        {/* Always-visible comments door (Instagram's line): before this, the
            only way in was discovering the icon in the action row — the count
            existed but the affordance didn't. Hidden once the section is open
            (it would duplicate the section's own header). */}
        {!showComments && replyCount > 0 && (
          <button
            type="button"
            onClick={() => { setComposeIntent(false); setShowComments(true); }}
            className="block w-full text-left px-3 pb-2.5 text-xs text-muted-foreground/70 hover:text-foreground/80 transition-colors"
            data-testid={`button-view-comments-${event.id}`}
          >
            View {replyCount === 1 ? "1 comment" : `all ${replyCount} comments`}
          </button>
        )}

        <MediaCommentsSection event={event} open={showComments} autoComposer={composeIntent} />
      </div>

      {fullscreen && (
        <ImageLightbox
          images={[{ src: imageUrl }]}
          onClose={() => setFullscreen(false)}
          testIdPrefix={`lightbox-ig-${event.id}`}
          authorInfo={{
            avatarUrl,
            displayName,
            timestamp: timeAgo,
            postUrl: getThreadUrl(event.id),
          }}
        />
      )}
    </>
  );
}

function ImageCard({ event, imageUrl }: { event: Event; imageUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stats = usePrimalStats(event.id);
  const replyCount = stats?.replies ?? 0;
  const { ratio, learnAspect } = useReservedAspect(event, imageUrl);

  const authorProfile = use$(() => eventStore.replaceable(0, event.pubkey), [event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [event.created_at]);

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return "#";
    }
  }, [event.pubkey]);

  if (error) return null;

  return (
    <>
      <div
        className="relative break-inside-avoid mb-3 rounded-xl overflow-hidden border border-border/40 bg-muted/30 group cursor-pointer"
        onClick={() => setFullscreen(true)}
        data-testid={`image-card-${event.id}`}
      >
        {/* Reserved slot (see useReservedAspect): masonry column items keep a
            settled height from first paint instead of jumping 192px→natural. */}
        <div className="relative w-full" style={{ aspectRatio: `${ratio}` }}>
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            </div>
          )}
          <img
            src={imageUrl}
            alt="Image preview"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={(e) => { learnAspect(e); setLoaded(true); }}
            onError={() => setError(true)}
            data-testid={`img-preview-${event.id}`}
          />
        </div>
        {/* Image-first: author rides a hover overlay (always-on for touch, hover-in on desktop). */}
        {loaded && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-2 bg-gradient-to-t from-black/65 via-black/20 to-transparent reveal-on-hover">
            <Link href={profileUrl} onClick={(e) => e.stopPropagation()} data-testid={`link-avatar-${event.id}`}>
              <Avatar className="w-5 h-5 border border-white/20 shrink-0 cursor-pointer">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="text-[8px] bg-black/40 text-white">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <Link
              href={profileUrl}
              className="text-[11px] font-medium truncate flex-1 text-white/90 drop-shadow cursor-pointer"
              onClick={(e) => e.stopPropagation()}
              data-testid={`link-author-${event.id}`}
            >
              {displayName}
            </Link>
            <span className="text-[10px] text-white/70 shrink-0 drop-shadow" data-testid={`text-time-${event.id}`}>{timeAgo}</span>
            {/* The comments door with its count — before this the grid's only
                exit was a bare external-link glyph nobody read as "the post".
                Both land on the thread (comments live there); the pairing of
                icon+count is the legible one. */}
            <Link
              href={getThreadUrl(event.id)}
              className="flex items-center gap-0.5 text-white/70 hover:text-white transition-colors shrink-0"
              onClick={(e) => e.stopPropagation()}
              title={replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "comment" : "comments"}` : "Comment"}
              data-testid={`link-comments-${event.id}`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {replyCount > 0 && <span className="text-[10px] tabular-nums">{replyCount}</span>}
            </Link>
            <Link
              href={getThreadUrl(event.id)}
              className="text-white/70 hover:text-white transition-colors shrink-0"
              onClick={(e) => e.stopPropagation()}
              title="View post"
              data-testid={`link-view-post-${event.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {fullscreen && (
        <ImageLightbox
          images={[{ src: imageUrl }]}
          onClose={() => setFullscreen(false)}
          testIdPrefix={`lightbox-${event.id}`}
          authorInfo={{
            avatarUrl,
            displayName,
            timestamp: timeAgo,
            postUrl: getThreadUrl(event.id),
          }}
        />
      )}
    </>
  );
}

function ImageListItem({ event, imageUrl }: { event: Event; imageUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const stats = usePrimalStats(event.id);
  const replyCount = stats?.replies ?? 0;

  const authorProfile = use$(() => eventStore.replaceable(0, event.pubkey), [event.pubkey]);
  const fallbackName = shortenNpub(formatNpub(event.pubkey));
  const displayName = authorProfile ? (getDisplayName(authorProfile, fallbackName) ?? fallbackName) : fallbackName;
  const avatarUrl = getAvatarUrl(authorProfile);

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true });
    } catch {
      return "";
    }
  }, [event.created_at]);

  const profileUrl = useMemo(() => {
    try {
      return `/profile/${nip19.npubEncode(event.pubkey)}`;
    } catch {
      return "#";
    }
  }, [event.pubkey]);

  if (error) return null;

  return (
    <>
      <div
        className="flex items-center gap-3 p-2 rounded-lg hover-elevate cursor-pointer border border-border/20 glass-card flex-wrap"
        onClick={() => setFullscreen(true)}
        data-testid={`image-list-item-${event.id}`}
      >
        <div className="w-16 h-16 rounded-md overflow-hidden bg-muted/30 shrink-0">
          {!loaded && (
            <div className="w-full h-full flex items-center justify-center">
              <RelayOutpostInlineLoader className="w-3 h-3 text-brand" />
            </div>
          )}
          <img
            src={imageUrl}
            alt="Image thumbnail"
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            data-testid={`img-list-preview-${event.id}`}
          />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <Link href={profileUrl} onClick={(e) => e.stopPropagation()} data-testid={`link-list-avatar-${event.id}`}>
            <Avatar className="w-6 h-6 border border-border/50 shrink-0 cursor-pointer">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[8px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <Link
            href={profileUrl}
            className="text-xs font-medium truncate text-foreground/80 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            data-testid={`link-list-author-${event.id}`}
          >
            {displayName}
          </Link>
          <span className="text-[11px] text-muted-foreground/70 shrink-0 ml-auto" data-testid={`text-list-time-${event.id}`}>{timeAgo}</span>
          <Link
            href={getThreadUrl(event.id)}
            className="flex items-center gap-0.5 text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
            onClick={(e) => e.stopPropagation()}
            title={replyCount > 0 ? `${replyCount} ${replyCount === 1 ? "comment" : "comments"}` : "Comment"}
            data-testid={`link-list-comments-${event.id}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {replyCount > 0 && <span className="text-[10px] tabular-nums">{replyCount}</span>}
          </Link>
          <Link
            href={getThreadUrl(event.id)}
            className="text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
            onClick={(e) => e.stopPropagation()}
            title="View post"
            data-testid={`link-list-view-post-${event.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {fullscreen && (
        <ImageLightbox
          images={[{ src: imageUrl }]}
          onClose={() => setFullscreen(false)}
          testIdPrefix={`lightbox-list-${event.id}`}
          authorInfo={{
            avatarUrl,
            displayName,
            timestamp: timeAgo,
            postUrl: getThreadUrl(event.id),
          }}
        />
      )}
    </>
  );
}

type ColumnCount = 2 | 3 | 4;
const COLUMN_ICONS: Record<ColumnCount, typeof Columns2> = { 2: Columns2, 3: Columns3, 4: Columns4 };
const COLUMN_CLASSES: Record<ColumnCount, string> = {
  2: "columns-1 sm:columns-2 gap-3",
  3: "columns-1 sm:columns-2 lg:columns-3 gap-3",
  4: "columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-3",
};

// `sort` (optional) makes the sort externally controlled — the feed-macro
// dropdown in Home owns it and the internal sort chip is hidden entirely.
export default function ImagesFeed({ embedded = false, sort }: { embedded?: boolean; sort?: SortMode } = {}) {
  const isMobile = useIsMobile();
  const { filter: spamFilter } = useSpamFilter();
  const tierFilter = useTierContentFilter();
  useDocumentTitle("Images");
  const [cutoffTimestamp, setCutoffTimestamp] = useState(() => Math.floor(Date.now() / 1000));
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(() => !hasFeedData());
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [columns, setColumns] = useState<ColumnCount>(2);
  const [internalSortMode, setSortMode] = useState<SortMode>("trending");
  const sortMode = sort ?? internalSortMode;
  const [statsVersion, setStatsVersion] = useState(0);

  useEffect(() => {
    const key = "relay-outpost-scroll-/images";
    const saved = sessionStorage.getItem(key);
    if (!saved) return;
    sessionStorage.removeItem(key);
    const y = parseInt(saved, 10);
    if (isNaN(y) || y <= 0) return;
    const timer = setInterval(() => {
      if (document.body.scrollHeight > y) {
        window.scrollTo(0, y);
        clearInterval(timer);
      }
    }, 200);
    const fallback = setTimeout(() => {
      clearInterval(timer);
      window.scrollTo(0, Math.min(y, document.body.scrollHeight - window.innerHeight));
    }, 3000);
    return () => { clearInterval(timer); clearTimeout(fallback); };
  }, []);

  useEffect(() => {
    if (sortMode === "latest") return;
    // Feed-stability: the periodic trending re-rank reorders the masonry.
    // Only apply it while the reader is parked at the top — re-sorting under
    // someone scrolled into the grid yanks the content they're looking at.
    const interval = setInterval(() => {
      const scroller = document.querySelector<HTMLElement>(".feed-scroll-container");
      if (scroller && scroller.scrollTop > 80) return;
      setStatsVersion((v) => v + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, [sortMode]);

  // BOTH image roots (owner call, 2026-08-18): kind-1 notes with images AND
  // NIP-68 kind-20 picture posts — the image-native kind Olas publishes and
  // this app now publishes too (#690). A kind-1-only images feed was blind to
  // the majority of dedicated picture content, including our own.
  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    const noteRelays = getRelaysForPurpose('notes');
    const sub = subscribeToFeed({
      kinds: [KIND_TEXT_NOTE, KIND_PICTURE],
      limit: 100,
      since: now - 12 * 60 * 60,
    }, noteRelays, () => {
      setCutoffTimestamp(Math.floor(Date.now() / 1000));
      setIsInitialLoading(false);
      markFeedDataLoaded();
    });

    const liveSub = subscribeToFeedPersistent({
      kinds: [KIND_TEXT_NOTE, KIND_PICTURE],
      since: Math.floor(Date.now() / 1000),
    }, noteRelays);

    return () => {
      sub.close();
      liveSub.close();
    };
  }, []);

  const allTextNotes = use$(() => eventStore.timeline({ kinds: [KIND_TEXT_NOTE, KIND_PICTURE] }), []);

  // Three-state stranger profile gate (see spam-filter.ts): this is a global
  // discovery surface, so profile-less stranger posts (raw-npub authors) are
  // held while their kind-0 resolves and dropped once resolution completes
  // empty. Followed and positive-WoT authors are never gated.
  const { pubkey: myPubkey, follows } = useNostrAuth();
  const { scores: grapeRankScores } = useGrapeRankScores();
  const followSet = useMemo(() => {
    const s = new Set(follows || []);
    if (myPubkey) s.add(myPubkey); // your own posts are never gated
    return s;
  }, [follows, myPubkey]);
  const { profileGetter, profileSettledGetter, profileVersion } = useProfileFloor(allTextNotes);

  // Feed-stability, extended (see the statsVersion guard above): this memo does
  // NOT only re-run on the 5s re-rank tick — the persistent live subscription
  // streams new kind-1s continuously, and every arrival recomputes it. Ranked
  // sorts are time- and stats-sensitive (engagement stats fill in async), so
  // each recompute could reorder the whole grid under a scrolled reader —
  // cards teleport mid-scroll. While the reader is away from the top, pin the
  // previous relative order for known tiles; anything new appends after (new
  // arrivals are cutoff-gated out of view anyway). The pin refreshes whenever
  // the reader is parked at the top or the sort mode changes.
  const pinnedOrderRef = useRef<{ sortMode: SortMode; order: Map<string, number> } | null>(null);

  const allImageEntries = useMemo(() => {
    if (!allTextNotes) return [];
    // Honor the shared WoT excluded-tier set (same filter the main feed and
    // outposts use), on top of the spam filter.
    const filtered = tierFilter(spamFilter(allTextNotes, {
      follows: followSet,
      hideNoProfile: true,
      profileGetter,
      profileSettledGetter,
      scoreGetter: (pk: string) => grapeRankScores?.get(pk),
    }));
    const entries: Array<{ event: Event; imageUrl: string }> = [];
    for (const event of filtered) {
      const info = getEventMediaInfo(event.content, event.tags);
      if (info.hasImage) {
        for (const url of info.imageUrls) {
          entries.push({ event, imageUrl: url });
        }
      }
    }
    const sorted = sortEntries(entries, sortMode);
    const scroller = document.querySelector<HTMLElement>(".feed-scroll-container");
    const parkedAtTop = !scroller || scroller.scrollTop <= 80;
    const pinned = pinnedOrderRef.current;
    if (!parkedAtTop && pinned && pinned.sortMode === sortMode && pinned.order.size > 0) {
      // Scrolled reader: keep known tiles in their pinned relative order
      // (Array.prototype.sort is stable — unpinned entries keep their scored
      // order after the pinned block).
      const prev = pinned.order;
      sorted.sort((a, b) => (prev.get(entryKey(a)) ?? Number.MAX_SAFE_INTEGER) - (prev.get(entryKey(b)) ?? Number.MAX_SAFE_INTEGER));
    } else {
      pinnedOrderRef.current = { sortMode, order: new Map(sorted.map((e, i) => [entryKey(e), i])) };
    }
    return sorted;
    // profileVersion: a kind-0 arrival must re-run the gate to un-hide its
    // author's held posts (grace → admit).
  }, [allTextNotes, spamFilter, tierFilter, sortMode, statsVersion, followSet, profileGetter, profileSettledGetter, profileVersion, grapeRankScores]);

  const displayedEntries = useMemo(() => {
    return allImageEntries
      .filter((e) => e.event.created_at <= cutoffTimestamp)
      .slice(0, displayLimit);
  }, [allImageEntries, cutoffTimestamp, displayLimit]);

  const bufferedCount = useMemo(() => {
    return allImageEntries.filter((e) => e.event.created_at > cutoffTimestamp).length;
  }, [allImageEntries, cutoffTimestamp]);

  const showBuffered = useCallback(() => {
    setCutoffTimestamp(Math.floor(Date.now() / 1000));
    setDisplayLimit((prev) => Math.max(prev, PAGE_SIZE));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("new-posts-update", {
      detail: { count: bufferedCount, showBuffered }
    }));
  }, [bufferedCount, showBuffered]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("new-posts-update", {
        detail: { count: 0, showBuffered: null }
      }));
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    const oldest = displayedEntries[displayedEntries.length - 1];
    const oldestTs = oldest ? oldest.event.created_at : Math.floor(Date.now() / 1000) - 12 * 60 * 60;

    let receivedCount = 0;
    const sub = throttledPoolSubscribe(DEFAULT_RELAYS, {
      kinds: [KIND_TEXT_NOTE, KIND_PICTURE],
      until: oldestTs,
      since: oldestTs - 12 * 60 * 60,
      limit: 100,
    }, {
      onevent(event) {
        receivedCount++;
        eventStore.add(event);
      },
      oneose() {
        sub.close();
        if (receivedCount === 0) {
          setHasMore(false);
        } else {
          setDisplayLimit((prev) => prev + PAGE_SIZE);
        }
        setIsLoadingMore(false);
        loadingMoreRef.current = false;
      },
    });
  }, [displayedEntries, hasMore]);

  const uniqueEvents = useMemo(() => {
    const seen = new Set<string>();
    return displayedEntries
      .map((e) => e.event)
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
  }, [displayedEntries]);

  useEffect(() => {
    const authors = Array.from(new Set(uniqueEvents.map((e) => e.pubkey)));
    fetchProfilesCached(authors);
    if (uniqueEvents.length > 0) {
      prefetchStatsImmediate(uniqueEvents.map((e) => e.id));
    }
  }, [uniqueEvents]);

  // Ranked sorts need stats for the WHOLE loaded window, not just the on-screen
  // slice — otherwise "Most Zapped"/"Top Engaged"/"Trending" only re-order the
  // newest page. Prefetch across everything loaded (capped + batched + cached so
  // it stays light). Skipped for "latest" (no stats needed there).
  useEffect(() => {
    if (sortMode === "latest") return;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const entry of allImageEntries) {
      if (seen.has(entry.event.id)) continue;
      seen.add(entry.event.id);
      ids.push(entry.event.id);
      if (ids.length >= 250) break;
    }
    if (ids.length > 0) prefetchStatsImmediate(ids);
  }, [allImageEntries, sortMode]);

  const nextColumns = (): ColumnCount => columns === 2 ? 3 : columns === 3 ? 4 : 2;
  const ColIcon = COLUMN_ICONS[columns];

  if (isMobile) {
    return (
      <div className="pb-4" data-testid="page-images-feed-mobile">
        {/* One slim row: no duplicate "Images" heading when embedded (the feed
            macro chip / hub tab already labels the view) and the sort is a
            compact chip instead of a full-width bar. When the sort is owned by
            the feed-macro dropdown (`sort` prop), the row disappears entirely —
            zero header, straight into images. */}
        {sort === undefined && (
          <div className="flex items-center gap-2 px-3 py-2">
            {!embedded && (
              <>
                <ImageIcon className="w-5 h-5 text-brand/70" />
                <h1 className="text-lg font-semibold text-foreground" data-testid="text-page-title">Images</h1>
              </>
            )}
            <div className={embedded ? "" : "ml-auto"}>
              <MediaSortBar value={sortMode} onChange={setSortMode} compact />
            </div>
          </div>
        )}

        {isInitialLoading && displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20" data-testid="container-loading">
            <RelayOutpostLoader size="lg" label="Scanning relays for images..." />
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20" data-testid="container-empty">
            <p className="text-sm text-muted-foreground">No images found</p>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-2" data-testid="container-ig-feed">
              {displayedEntries.map((entry) => (
                <InstagramCard
                  key={entryKey(entry)}
                  event={entry.event}
                  imageUrl={entry.imageUrl}
                />
              ))}
            </div>
            <InfiniteScrollSentinel
              onLoadMore={loadMore}
              isLoading={isLoadingMore}
              hasMore={hasMore}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "px-2 sm:px-4 py-4 sm:py-6"} data-testid="page-images-feed">
      <div className={embedded ? "" : "max-w-6xl mx-auto"}>
        {/* ONE control row: title (standalone only) · sort · view controls. */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {!embedded && <ImageIcon className="w-5 h-5 text-brand/70" />}
          {!embedded && <h1 className="text-lg font-semibold text-foreground" data-testid="text-page-title">Images</h1>}
          {sort === undefined && <MediaSortBar value={sortMode} onChange={setSortMode} compact />}
          <div className="ml-auto flex items-center gap-1">
            {viewMode === "grid" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setColumns(nextColumns())}
                title={`${columns} columns`}
                data-testid="button-column-density"
              >
                <ColIcon className="w-4 h-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
              title={viewMode === "grid" ? "List view" : "Grid view"}
              data-testid="button-view-toggle"
            >
              {viewMode === "grid" ? <LayoutList className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        {isInitialLoading && displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20" data-testid="container-loading">
            <RelayOutpostLoader size="lg" label="Scanning relays for images..." />
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20" data-testid="container-empty">
            <p className="text-sm text-muted-foreground">No images found in recent posts</p>
          </div>
        ) : viewMode === "list" ? (
          <>
            <div className="space-y-1.5 max-w-2xl mx-auto" data-testid="container-images-list">
              {displayedEntries.map((entry) => (
                <ImageListItem
                  key={entryKey(entry)}
                  event={entry.event}
                  imageUrl={entry.imageUrl}
                />
              ))}
            </div>
            <InfiniteScrollSentinel
              onLoadMore={loadMore}
              isLoading={isLoadingMore}
              hasMore={hasMore}
            />
          </>
        ) : (
          <>
            <div
              className={COLUMN_CLASSES[columns]}
              data-testid="container-images-grid"
            >
              {displayedEntries.map((entry) => (
                <ImageCard
                  key={entryKey(entry)}
                  event={entry.event}
                  imageUrl={entry.imageUrl}
                />
              ))}
            </div>
            <InfiniteScrollSentinel
              onLoadMore={loadMore}
              isLoading={isLoadingMore}
              hasMore={hasMore}
            />
          </>
        )}
      </div>
    </div>
  );
}
