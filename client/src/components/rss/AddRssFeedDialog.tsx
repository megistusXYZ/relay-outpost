// Directory-grade, fully in-app "Add RSS feed" dialog — Podcast Index discovery
// with rich metadata, durations, Lightning (V4V) badges, in-app preview +
// playback, and NO external links anywhere (required for the podcastindex.org
// apps directory). Extracted from RSSFeed.tsx; preserves the external contract
// (onAdd / existingUrls / onOpenFeed / trigger / autoFocusSearch).
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Rss,
  Plus,
  X,
  Search,
  TrendingUp,
  Mic,
  Newspaper,
  Check,
  ArrowLeft,
  Play,
  Pause,
  Zap,
  Headphones,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  LayoutGrid,
  Loader2,
  Flame,
  Star,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageTabs } from "@/components/PageTabs";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBackClosable } from "@/hooks/use-back-closable";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { formatDistanceToNow } from "date-fns";
import type { MusicTrack } from "@/lib/music";
import {
  type SavedFeed,
  SUGGESTED_FEEDS,
  EXTRA_DEFAULT_FEEDS,
} from "@/lib/rss-feeds";
import {
  type PodcastFeed,
  type PodcastEpisode,
  type TrendMomentum,
  PRESET_CATEGORY_PILLS,
  PRESET_SHOWS,
  MOMENTUM_LABELS,
  formatDuration,
  stripHtml,
  feedCategoryNames,
  feedSupportsValue,
  mergeDedupeById,
} from "@/lib/podcast-index";
import {
  usePodcastStatus,
  usePodcastTrending,
  usePodcastSearch,
  usePodcastCategories,
  usePodcastPreview,
  usePresetShows,
  useTrendSuggestions,
} from "@/hooks/use-podcast-index";

// A query "looks like a URL" if it starts with http(s):// OR is a bare domain
// (a dot, no spaces) — those go to feed discovery; everything else is a search.
function queryLooksLikeUrl(q: string): boolean {
  const v = q.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return true;
  return /\./.test(v) && !/\s/.test(v);
}

function hostLabel(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function relativeTime(unixSecondsOrIso: number | string | undefined): string {
  if (!unixSecondsOrIso) return "";
  try {
    const d = typeof unixSecondsOrIso === "number"
      ? new Date(unixSecondsOrIso * 1000)
      : new Date(unixSecondsOrIso);
    if (Number.isNaN(d.getTime())) return "";
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return "";
  }
}

// ── Shared artwork (lifted from RSSFeed): violet-gradient Mic fallback. ───────
export function PodcastArtwork({ src, size = "md", className = "" }: {
  src?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const dims = { sm: "w-10 h-10", md: "w-14 h-14", lg: "w-20 h-20", xl: "w-24 h-24" }[size];
  const iconDims = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-7 h-7", xl: "w-8 h-8" }[size];
  if (!src || failed) {
    return (
      <div className={`${dims} rounded-xl bg-gradient-to-br from-brand/20 to-brand/20 border border-brand/20 flex items-center justify-center shrink-0 ${className}`}>
        <Mic className={`${iconDims} text-brand/70`} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={`${dims} rounded-xl object-cover shrink-0 border border-white/5 shadow-lg shadow-black/20 ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// Amber V4V pill — shown only when a real Lightning value block exists.
function V4VPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 text-[10px] text-amber-500/90"
      title="Supports Lightning (value for value)"
      data-testid="badge-v4v"
    >
      <Zap className="w-2.5 h-2.5" />
      {!compact && "V4V"}
    </span>
  );
}

// Small category chips (max 3) from the feed's id→name map.
function CategoryChips({ feed, max = 3 }: { feed: PodcastFeed; max?: number }) {
  const names = feedCategoryNames(feed).slice(0, max);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span key={n} className="rounded-md bg-white/[0.04] border border-border/20 px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
          {n}
        </span>
      ))}
    </div>
  );
}

function TrendingSkeleton({ count = 6, isMobile = false }: { count?: number; isMobile?: boolean }) {
  return (
    <div className={isMobile
      ? "grid grid-cols-3 gap-2"
      : "grid grid-cols-2 lg:grid-cols-3 gap-2.5"
    }>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2.5 rounded-xl bg-muted/10 border border-border/10 animate-pulse">
          <div className="w-full aspect-square rounded-lg bg-muted/20" />
          <div className="space-y-1.5 px-0.5">
            <div className="h-3 bg-muted/20 rounded w-4/5" />
            <div className="h-2.5 bg-muted/15 rounded w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Search-result ROW — tap the body to preview, [+] to add. Rich metadata line.
function PodcastRow({ feed, onPreview, onAdd, isAdded, isMobile }: {
  feed: PodcastFeed;
  onPreview: (feed: PodcastFeed) => void;
  onAdd: (feed: PodcastFeed) => void;
  isAdded: boolean;
  isMobile?: boolean;
}) {
  const updated = relativeTime(feed.newestItemPubdate || feed.lastUpdateTime);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreview(feed)}
      onKeyDown={(e) => { if (e.key === "Enter") onPreview(feed); }}
      className="group flex items-start gap-3.5 p-3 rounded-xl border text-left transition-all w-full border-border/15 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/20 cursor-pointer"
      data-testid={`row-pi-feed-${feed.id}`}
    >
      <PodcastArtwork src={feed.image} size="md" />
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2">
          <p className={`${isMobile ? "text-[15px]" : "text-sm"} font-medium leading-snug line-clamp-1`}>{feed.title}</p>
          {feedSupportsValue(feed) && <V4VPill compact />}
        </div>
        {feed.author && (
          <p className={`${isMobile ? "text-[13px]" : "text-xs"} text-muted-foreground/60 mt-0.5 truncate`}>{feed.author}</p>
        )}
        {feed.description && (
          <p className="text-[11px] text-muted-foreground/40 mt-1 line-clamp-2 leading-relaxed">{feed.description}</p>
        )}
        <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1.5">
          {feed.episodeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/40 font-mono">
              <Headphones className="w-3 h-3" />
              {feed.episodeCount.toLocaleString()} eps
            </span>
          )}
          {updated && <span className="text-[10px] text-muted-foreground/40">Updated {updated}</span>}
          <CategoryChips feed={feed} max={2} />
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        {isAdded ? (
          <div className="flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg bg-green-500/10 border border-green-500/20 px-2" data-testid={`added-pi-feed-${feed.id}`}>
            <Check className="w-3.5 h-3.5 text-green-500/80" />
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(feed); }}
            className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 px-2 hover:bg-primary/20 hover:border-primary/30 transition-colors"
            aria-label={`Add ${feed.title}`}
            data-testid={`button-add-pi-feed-${feed.id}`}
          >
            <Plus className="w-4 h-4 text-brand/80" />
          </button>
        )}
      </div>
    </div>
  );
}

// Trending grid TILE — artwork-forward with ⚡ + add affordance overlays.
function TrendingTile({ feed, onPreview, onAdd, isAdded }: {
  feed: PodcastFeed;
  onPreview: (feed: PodcastFeed) => void;
  onAdd: (feed: PodcastFeed) => void;
  isAdded: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPreview(feed)}
      onKeyDown={(e) => { if (e.key === "Enter") onPreview(feed); }}
      className="group flex flex-col gap-2 p-2.5 rounded-xl border text-left transition-all border-border/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/20 cursor-pointer"
      data-testid={`tile-pi-trending-${feed.id}`}
    >
      <div className="relative w-full aspect-square">
        <PodcastArtwork src={feed.image} size="xl" className="!w-full !h-full" />
        {feedSupportsValue(feed) && (
          <span
            className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/55 border border-amber-400/40"
            title="Supports Lightning (value for value)"
            data-testid={`badge-v4v-${feed.id}`}
          >
            <Zap className="w-2.5 h-2.5 text-amber-400" />
          </span>
        )}
        {isAdded ? (
          <span className="absolute top-1.5 right-1.5 flex items-center justify-center w-7 h-7 rounded-full bg-black/55 border border-green-400/40" data-testid={`added-pi-trending-${feed.id}`}>
            <Check className="w-3.5 h-3.5 text-green-400" />
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(feed); }}
            className="absolute top-1.5 right-1.5 flex items-center justify-center w-7 h-7 rounded-full bg-black/55 border border-white/25 hover:bg-primary hover:border-primary transition-colors"
            aria-label={`Add ${feed.title}`}
            data-testid={`button-add-pi-trending-${feed.id}`}
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        )}
      </div>
      <div className="px-0.5 min-w-0">
        <p className="text-xs font-medium line-clamp-2 leading-snug">{feed.title}</p>
        {feed.author && <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">{feed.author}</p>}
      </div>
    </div>
  );
}

// Small accent chip naming a suggestion's momentum tier ("Rising" etc.).
function MomentumChip({ momentum }: { momentum: TrendMomentum }) {
  const styles = {
    new: "bg-sky-400/10 border-sky-400/30 text-sky-500/90",
    rising: "bg-emerald-400/10 border-emerald-400/30 text-emerald-500/90",
    surging: "bg-amber-400/10 border-amber-400/30 text-amber-500/90",
  }[momentum];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${styles}`}
      data-testid={`chip-momentum-${momentum}`}
    >
      <Flame className="w-2.5 h-2.5" />
      {MOMENTUM_LABELS[momentum]}
    </span>
  );
}

// Compact "Rising now" strip — trend-history suggestions for the active
// category (global on Top). Renders nothing at all when the engine has no
// suggestions yet, errors, or Podcast Index is unconfigured (silent skip).
function RisingNowRow({ cat, onPreview, onAdd, existingUrls, enabled }: {
  cat: string | null;
  onPreview: (feed: PodcastFeed) => void;
  onAdd: (feed: PodcastFeed) => void;
  existingUrls: Set<string>;
  enabled: boolean;
}) {
  const { suggestions } = useTrendSuggestions(cat, 5, enabled);
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="rising-now-row">
      <div className="flex items-center gap-2 px-0.5">
        <Flame className="w-3.5 h-3.5 text-emerald-500/70" />
        <span className="text-sm font-semibold">Rising now</span>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {suggestions.map((s) => {
          const feed = s.feed!;
          const isAdded = existingUrls.has(feed.url);
          return (
            <div
              key={s.feedId}
              role="button"
              tabIndex={0}
              title={s.reason}
              onClick={() => onPreview(feed)}
              onKeyDown={(e) => { if (e.key === "Enter") onPreview(feed); }}
              className="group w-28 shrink-0 flex flex-col gap-1.5 p-2 rounded-xl border text-left transition-all border-border/10 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/20 cursor-pointer"
              data-testid={`tile-pi-rising-${s.feedId}`}
            >
              <div className="relative w-full aspect-square">
                <PodcastArtwork src={feed.image} size="lg" className="!w-full !h-full" />
                {isAdded ? (
                  <span className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded-full bg-black/55 border border-green-400/40" data-testid={`added-pi-rising-${s.feedId}`}>
                    <Check className="w-3 h-3 text-green-400" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onAdd(feed); }}
                    className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded-full bg-black/55 border border-white/25 hover:bg-primary hover:border-primary transition-colors"
                    aria-label={`Add ${feed.title}`}
                    data-testid={`button-add-pi-rising-${s.feedId}`}
                  >
                    <Plus className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
              <MomentumChip momentum={s.momentum} />
              {s.consistent && (
                <span
                  className="inline-flex w-fit items-center rounded-full border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[9px] font-medium text-brand/90"
                  title="Consistently strong — in the trending top 15 on 3+ recent days"
                  data-testid={`chip-consistent-${s.feedId}`}
                >
                  Consistently strong
                </span>
              )}
              <p className="text-[11px] font-medium line-clamp-2 leading-snug">{feed.title}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Enriched in-dialog preview: artwork, author, description, category chips,
// episode count + last-updated, ⚡ badge, and recent episodes with in-app play.
function FeedPreviewPanel({ feed, isAdded, onBack, onAdd }: {
  feed: PodcastFeed;
  isAdded: boolean;
  onBack: () => void;
  onAdd: (feed: PodcastFeed) => void;
}) {
  const { play, currentTrack, isPlaying, togglePlay } = useAudioPlayer();
  const { episodes, isLoading, isError } = usePodcastPreview(feed, 8);
  const updated = relativeTime(feed.newestItemPubdate || feed.lastUpdateTime);
  const cleanDescription = useMemo(() => stripHtml(feed.description).slice(0, 400), [feed.description]);

  const toTrack = (ep: PodcastEpisode): MusicTrack | null => {
    if (!ep.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(ep.audioUrl)}`,
      title: ep.title || "Untitled Episode",
      artist: feed.author || feed.title || "Podcast",
      artistPubkey: "",
      audioUrl: ep.audioUrl,
      coverUrl: ep.thumbnail || feed.image || "",
      description: ep.description || "",
      genre: "Podcast",
      duration: ep.duration || 0,
      createdAt: ep.pubDate ? Math.floor(new Date(ep.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: feed.title || undefined,
      transcriptUrl: ep.transcriptUrl,
      transcriptType: ep.transcriptType,
      chaptersUrl: ep.chaptersUrl,
    };
  };

  return (
    <div className="space-y-4" data-testid="feed-preview">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 min-h-[36px] text-xs text-muted-foreground/70 hover:text-foreground transition-colors -ml-1 px-1"
        data-testid="button-preview-back"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      <div className="flex items-start gap-4">
        <PodcastArtwork src={feed.image} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-snug">{feed.title}</p>
          {feed.author && <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{feed.author}</p>}
          <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1.5">
            {feed.episodeCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/40 font-mono">
                <Headphones className="w-3 h-3" />
                {feed.episodeCount.toLocaleString()} episodes
              </span>
            )}
            {updated && <span className="text-[10px] text-muted-foreground/40">Updated {updated}</span>}
            {feedSupportsValue(feed) && <V4VPill />}
          </div>
        </div>
      </div>

      <CategoryChips feed={feed} max={6} />

      {isAdded ? (
        <div className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-green-500/10 border border-green-500/20 text-sm font-medium text-green-500/90" data-testid="preview-added">
          <Check className="w-4 h-4" /> In your feeds
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAdd(feed)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-[0.99] transition-all"
          data-testid="button-preview-add"
        >
          <Plus className="w-4 h-4" /> Add to my feeds
        </button>
      )}

      {cleanDescription && (
        <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-4">{cleanDescription}</p>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 px-0.5">Latest episodes</p>
        {isLoading && (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-muted/10 border border-border/10 animate-pulse" />
            ))}
          </div>
        )}
        {isError && <p className="text-xs text-muted-foreground/40 px-0.5 py-2">Couldn't load episodes — you can still add the feed.</p>}
        {!isLoading && !isError && episodes.length === 0 && (
          <p className="text-xs text-muted-foreground/40 px-0.5 py-2">No episodes found.</p>
        )}
        {episodes.map((ep, i) => {
          const track = toTrack(ep);
          const isCurrent = !!track && currentTrack?.audioUrl === track.audioUrl;
          const thisPlaying = isCurrent && isPlaying;
          const dur = formatDuration(ep.duration);
          return (
            <div key={ep.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-border/10">
              {track ? (
                <button
                  type="button"
                  onClick={() => (isCurrent ? togglePlay() : play(track))}
                  className={`flex w-9 h-9 items-center justify-center rounded-full shrink-0 transition-colors ${
                    thisPlaying ? "bg-primary text-primary-foreground" : "bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20"
                  }`}
                  aria-label={thisPlaying ? "Pause" : "Play"}
                  data-testid={`button-preview-play-${i}`}
                >
                  {thisPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
              ) : (
                <div className="flex w-9 h-9 items-center justify-center rounded-full bg-muted/20 border border-border/15 shrink-0">
                  <Rss className="w-3.5 h-3.5 text-muted-foreground/40" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium line-clamp-2 leading-snug">{ep.title}</p>
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                  {ep.pubDate ? new Date(ep.pubDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
                  {dur ? ` · ${dur}` : ""}
                  {ep.transcriptUrl ? (
                    <span className="ml-1.5 inline-flex items-center rounded border border-brand/20 bg-brand/5 px-1 py-px text-[9px] font-medium text-brand/70 align-middle" title="This episode has a transcript — open it from the player">
                      Transcript
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Full 112-category picker (the "More categories" affordance).
function CategorySheet({ onPick, onClose }: {
  onPick: (cat: { key: string; label: string; cat: string }) => void;
  onClose: () => void;
}) {
  const { categories } = usePodcastCategories(true);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, filter]);
  return (
    <div className="space-y-3" data-testid="category-sheet">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 min-h-[36px] text-xs text-muted-foreground/70 hover:text-foreground transition-colors -ml-1 px-1"
          data-testid="button-categories-back"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <span className="text-sm font-semibold ml-1">All categories</span>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 pointer-events-none" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter categories…"
          className="pl-9 h-10 text-sm bg-white/[0.03] border-border/30 focus:border-primary/40 rounded-xl"
          data-testid="input-category-filter"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick({ key: `cat-${c.id}`, label: c.name, cat: String(c.id) })}
            className="text-left px-3 py-2 rounded-lg bg-white/[0.02] border border-border/15 hover:bg-white/[0.05] hover:border-primary/25 text-xs font-medium transition-colors truncate"
            data-testid={`button-category-${c.id}`}
          >
            {c.name}
          </button>
        ))}
        {shown.length === 0 && (
          <p className="col-span-full text-xs text-muted-foreground/40 py-4 text-center">No categories match.</p>
        )}
      </div>
    </div>
  );
}

type ActiveCat = { key: string; label: string; cat: string | null };

// ── Dialog body (universal search + zero-state discovery + manual add). ───────
function AddFeedBody({
  onAdd, existingUrls, toast, onOpenFeed, autoFocusSearch = false, isMobileDrawer = false,
}: {
  onAdd: (feed: SavedFeed) => void;
  existingUrls: Set<string>;
  toast: ReturnType<typeof useToast>["toast"];
  onOpenFeed?: (feedUrl: string) => void;
  autoFocusSearch?: boolean;
  isMobileDrawer?: boolean;
}) {
  const { configured: piConfiguredRaw } = usePodcastStatus();
  const piConfigured = piConfiguredRaw; // boolean | null

  // ── Universal search box. ──
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const isUrlQuery = queryLooksLikeUrl(query);
  const hasQuery = query.trim().length > 0;

  // Debounce the (non-URL) query into the PI search hook.
  useEffect(() => {
    if (isUrlQuery) { setDebouncedQuery(""); return; }
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query, isUrlQuery]);

  // ── Zero-state: category pills → "Trending in [Category]". ──
  const [activeCat, setActiveCat] = useState<ActiveCat>({ key: "top", label: "Top", cat: null });
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [trendingMax, setTrendingMax] = useState(12);
  useEffect(() => { setTrendingMax(12); }, [activeCat.key]);

  const trendingEnabled = piConfigured === true && !hasQuery && !showCategorySheet;
  const { feeds: trendingPage, isFetching: trendingFetching, isError: trendingError } =
    usePodcastTrending(activeCat.cat, trendingMax, trendingEnabled);
  const trendingFeeds = useMemo(() => mergeDedupeById([], trendingPage), [trendingPage]);
  const trendingHasMore = trendingPage.length >= trendingMax && trendingMax < 50;

  // Creator-led preset list for the active category pill (Top stays dynamic).
  // Each curated show is resolved against the LIVE index and title-matched —
  // unresolvable shows are simply not rendered.
  const presetKey = activeCat.cat !== null && PRESET_SHOWS[activeCat.key] ? activeCat.key : null;
  const { feeds: presetFeeds } = usePresetShows(presetKey, trendingEnabled);

  // ── Search path (podcasts). ──
  const [searchMax, setSearchMax] = useState(20);
  useEffect(() => { setSearchMax(20); }, [debouncedQuery]);
  const searchEnabled = piConfigured === true && !isUrlQuery;
  const { feeds: searchPage, isFetching: searchFetching, searched: searchSearched } =
    usePodcastSearch(debouncedQuery, searchMax, searchEnabled);
  const searchResults = useMemo(() => mergeDedupeById([], searchPage), [searchPage]);
  const searchHasMore = searchPage.length >= searchMax && searchMax < 40;

  // ── News & blogs presets (client-side filtered). ──
  const availableSuggested = useMemo(() => {
    const seen = new Set<string>();
    return [...SUGGESTED_FEEDS, ...EXTRA_DEFAULT_FEEDS].filter(
      (sf) => !existingUrls.has(sf.url) && !seen.has(sf.url) && (seen.add(sf.url), true),
    );
  }, [existingUrls]);
  const filteredSuggested = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as SavedFeed[];
    return availableSuggested.filter(
      (sf) => sf.name.toLowerCase().includes(q) || sf.category.toLowerCase().includes(q),
    );
  }, [availableSuggested, query]);

  // Full curated preset library grouped by category — browsable with an EMPTY
  // query. Before this, presets only surfaced via typed search, so the curated
  // library (podcast categories included) was effectively invisible.
  const libraryGroups = useMemo(() => {
    const groups = new Map<string, SavedFeed[]>();
    for (const sf of availableSuggested) {
      const g = groups.get(sf.category) || [];
      g.push(sf);
      groups.set(sf.category, g);
    }
    return Array.from(groups.entries());
  }, [availableSuggested]);

  // ── URL path: auto-detect a site's RSS/Atom feed via /api/rss/discover. ──
  const [detected, setDetected] = useState<{ title: string; url: string }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectSearched, setDetectSearched] = useState(false);
  const detectReqRef = useRef(0);
  useEffect(() => {
    if (!isUrlQuery) { setDetected([]); setDetectSearched(false); return; }
    const v = query.trim();
    if (!v || !/\./.test(v)) return;
    const reqId = ++detectReqRef.current;
    const t = setTimeout(async () => {
      setDetecting(true);
      setDetectSearched(false);
      try {
        const res = await fetch(`/api/rss/discover?url=${encodeURIComponent(v)}`);
        if (reqId !== detectReqRef.current) return;
        const data = res.ok ? await res.json() : null;
        setDetected(data?.feeds || []);
      } catch {
        if (reqId === detectReqRef.current) setDetected([]);
      } finally {
        if (reqId === detectReqRef.current) { setDetecting(false); setDetectSearched(true); }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, isUrlQuery]);

  // ── Preview + add. ──
  const [previewFeed, setPreviewFeed] = useState<PodcastFeed | null>(null);
  useEffect(() => { setPreviewFeed(null); }, [query]);

  const addWithToast = useCallback((sf: SavedFeed) => {
    if (existingUrls.has(sf.url)) return;
    onAdd(sf);
    toast({
      title: "Added to your feeds",
      description: sf.name,
      action: onOpenFeed ? (
        <ToastAction altText="Open feed" onClick={() => onOpenFeed(sf.url)}>Open</ToastAction>
      ) : undefined,
    });
  }, [onAdd, existingUrls, toast, onOpenFeed]);

  // Persist artwork + author (+ V4V support) onto the SavedFeed so the library
  // keeps rich cards and the News priority strip can show the ⚡ badge.
  const addPodcast = useCallback((feed: PodcastFeed) => {
    addWithToast({
      name: feed.title,
      url: feed.url,
      category: "Podcast",
      feedImage: feed.image || undefined,
      author: feed.author || undefined,
      v4v: feedSupportsValue(feed) || undefined,
    });
  }, [addWithToast]);

  const clearQuery = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setDetected([]);
    setDetectSearched(false);
  }, []);

  // ── Manual add (strengthened: fetch-verify before adding). ──
  const [manualOpen, setManualOpen] = useState(false);
  const [mName, setMName] = useState("");
  const [mUrl, setMUrl] = useState("");
  const [mCategory, setMCategory] = useState("Custom");
  const [mError, setMError] = useState("");
  const [mVerifying, setMVerifying] = useState(false);

  const handleManualAdd = useCallback(async () => {
    const name = mName.trim();
    const url = mUrl.trim();
    if (!url) { setMError("RSS URL is required"); return; }
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        setMError("URL must start with http:// or https://");
        return;
      }
    } catch {
      setMError("Enter a valid URL");
      return;
    }
    if (existingUrls.has(url)) { setMError("This feed is already added"); return; }
    setMError("");
    setMVerifying(true);
    try {
      // Podcast enrichment first (artwork/author) — podcast URLs only.
      let enriched: { image?: string; author?: string; title?: string } | null = null;
      try {
        const pi = await fetch(`/api/podcastindex/byfeedurl?url=${encodeURIComponent(url)}`);
        if (pi.ok) {
          const data = await pi.json();
          if (data?.feed) {
            enriched = { image: data.feed.image, author: data.feed.author, title: data.feed.title };
          }
        }
      } catch { /* enrichment is best-effort */ }

      // General validation gate — every RSS/Atom (podcast or not) via discover.
      let verifiedTitle = "";
      try {
        const res = await fetch(`/api/rss/discover?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data = await res.json();
          const match = (data?.feeds || []).find((f: { url: string }) => f.url === url) || (data?.feeds || [])[0];
          if (match) verifiedTitle = match.title || "";
        }
      } catch { /* fall through to enrichment/no-verify */ }

      if (!enriched && !verifiedTitle) {
        setMError("Couldn't verify a feed at that URL. Double-check the link.");
        return;
      }
      const finalName = name || enriched?.title || verifiedTitle || hostLabel(url);
      addWithToast({
        name: finalName,
        url,
        category: mCategory.trim() || "Custom",
        feedImage: enriched?.image || undefined,
        author: enriched?.author || undefined,
      });
      setMName(""); setMUrl(""); setMCategory("Custom"); setManualOpen(false);
    } finally {
      setMVerifying(false);
    }
  }, [mName, mUrl, mCategory, existingUrls, addWithToast]);

  // ── Pieces ──
  const searchInput = (
    <div className="relative">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setMError(""); }}
        placeholder="Search podcasts, blogs, or paste a URL…"
        className={`pl-10 pr-10 h-12 ${isMobileDrawer ? "text-base" : "text-sm"} bg-white/[0.03] border-border/30 focus:border-primary/40 rounded-xl`}
        autoFocus={autoFocusSearch}
        inputMode="search"
        enterKeyHint="search"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        data-testid="input-universal-feed-search"
      />
      {(detecting || searchFetching) && (
        <RelayOutpostInlineLoader className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand" />
      )}
      {hasQuery && !detecting && !searchFetching && (
        <button
          onClick={clearQuery}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  const zeroState = (
    <div className="space-y-5" data-testid="feed-search-zero-state">
      {piConfigured === true ? (
        showCategorySheet ? (
          <CategorySheet
            onClose={() => setShowCategorySheet(false)}
            onPick={(c) => { setActiveCat(c); setShowCategorySheet(false); }}
          />
        ) : (
          <>
            {/* Official category pills + "More categories". */}
            <div className="space-y-2">
              <PageTabs
                equalWidth={false}
                ariaLabel="Podcast categories"
                active={activeCat.key}
                onChange={(key) => {
                  const pill = PRESET_CATEGORY_PILLS.find((p) => p.key === key);
                  if (pill) setActiveCat({ key: pill.key, label: pill.label, cat: pill.cat });
                }}
                tabs={[
                  ...PRESET_CATEGORY_PILLS.map((p) => ({ key: p.key, label: p.label, testId: `pill-feed-cat-${p.key}` })),
                  // Keep a non-preset active category visible/selected in the row.
                  ...(!PRESET_CATEGORY_PILLS.some((p) => p.key === activeCat.key)
                    ? [{ key: activeCat.key, label: activeCat.label, testId: `pill-feed-cat-active` }]
                    : []),
                ]}
              />
              <button
                type="button"
                onClick={() => setShowCategorySheet(true)}
                className="inline-flex items-center gap-1.5 text-[11px] text-brand/70 hover:text-brand transition-colors px-1"
                data-testid="button-more-categories"
              >
                <LayoutGrid className="w-3 h-3" /> More categories
              </button>
            </div>

            {/* Creator-led preset picks for the active category. */}
            {presetKey && presetFeeds.length > 0 && (
              <div className="space-y-2" data-testid="preset-shows-section">
                <div className="flex items-center gap-2 px-0.5">
                  <Star className="w-3.5 h-3.5 text-brand/70" />
                  <span className="text-sm font-semibold">Popular in {activeCat.label}</span>
                </div>
                <div className="space-y-1.5">
                  {presetFeeds.map((feed) => (
                    <PodcastRow
                      key={feed.id}
                      feed={feed}
                      onPreview={setPreviewFeed}
                      onAdd={addPodcast}
                      isAdded={existingUrls.has(feed.url)}
                      isMobile={isMobileDrawer}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Rising now — trend-history suggestions (global on Top). */}
            <RisingNowRow
              cat={activeCat.cat}
              onPreview={setPreviewFeed}
              onAdd={addPodcast}
              existingUrls={existingUrls}
              enabled={trendingEnabled}
            />

            {/* Trending in [Category]. */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 px-0.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-500/60" />
                <span className="text-sm font-semibold">
                  {activeCat.cat === null ? "Trending now" : `Trending in ${activeCat.label}`}
                </span>
              </div>
              {trendingFetching && trendingFeeds.length === 0 && (
                <TrendingSkeleton count={isMobileDrawer ? 6 : 6} isMobile={isMobileDrawer} />
              )}
              {!trendingFetching && trendingError && trendingFeeds.length === 0 && (
                <p className="text-xs text-muted-foreground/40 px-0.5 py-2">Couldn't load trending — try another category.</p>
              )}
              {!trendingError && !trendingFetching && trendingFeeds.length === 0 && (
                <p className="text-xs text-muted-foreground/40 px-0.5 py-2">Nothing trending here right now — try another category.</p>
              )}
              {trendingFeeds.length > 0 && (
                <>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {trendingFeeds.map((feed) => (
                      <TrendingTile
                        key={feed.id}
                        feed={feed}
                        onPreview={setPreviewFeed}
                        onAdd={addPodcast}
                        isAdded={existingUrls.has(feed.url)}
                      />
                    ))}
                  </div>
                  {trendingHasMore && (
                    <button
                      type="button"
                      onClick={() => setTrendingMax((m) => Math.min(50, m + 12))}
                      disabled={trendingFetching}
                      className="w-full h-10 rounded-xl bg-white/[0.03] border border-border/25 text-xs font-medium text-muted-foreground/80 hover:border-primary/30 hover:text-foreground transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                      data-testid="button-trending-load-more"
                    >
                      {trendingFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Load more
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )
      ) : piConfigured === false ? (
        <p className="text-xs text-muted-foreground/50 leading-relaxed px-0.5">
          Search any blog by name — or paste a site link and we'll find its feed.
        </p>
      ) : (
        <TrendingSkeleton count={6} isMobile={isMobileDrawer} />
      )}

      {/* The full curated preset library, browsable without typing — grouped
          by category (podcast categories + news), rows reuse the preset-add
          treatment. Renders regardless of Podcast Index availability. */}
      {libraryGroups.length > 0 && (
        <div className="space-y-4" data-testid="library-browse">
          <div className="flex items-center gap-2 px-0.5">
            <LayoutGrid className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-sm font-semibold">Browse the library</span>
            <span className="text-[10px] text-muted-foreground/30 ml-auto">{availableSuggested.length}</span>
          </div>
          {libraryGroups.map(([cat, feeds]) => (
            <div key={cat} className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground/50 px-0.5">{cat}</div>
              <div className="grid grid-cols-1 gap-1.5">
                {feeds.map((sf) => (
                  <button
                    key={sf.url}
                    onClick={() => addWithToast(sf)}
                    className="group flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.02] border border-border/15 hover:bg-white/[0.05] hover:border-primary/20 text-left transition-all"
                    data-testid={`button-library-${sf.name}`}
                  >
                    {sf.feedImage ? (
                      <img src={sf.feedImage} alt="" loading="lazy" decoding="async" className="w-8 h-8 rounded-lg object-cover border border-border/15 shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-muted/20 border border-border/15 flex items-center justify-center shrink-0">
                        <Newspaper className="w-3.5 h-3.5 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{sf.name}</p>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-brand shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const searchResultsBlock = (
    <div className="space-y-4">
      {/* Podcasts (Podcast Index). */}
      {piConfigured === true && (searchResults.length > 0 || searchFetching) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-0.5">
            <Mic className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">Podcasts</span>
          </div>
          {searchResults.length === 0 && searchFetching ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-muted/10 border border-border/10 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {searchResults.map((feed) => (
                <PodcastRow
                  key={feed.id}
                  feed={feed}
                  onPreview={setPreviewFeed}
                  onAdd={addPodcast}
                  isAdded={existingUrls.has(feed.url)}
                  isMobile={isMobileDrawer}
                />
              ))}
              {searchHasMore && (
                <button
                  type="button"
                  onClick={() => setSearchMax((m) => Math.min(40, m + 20))}
                  disabled={searchFetching}
                  className="w-full h-10 rounded-xl bg-white/[0.03] border border-border/25 text-xs font-medium text-muted-foreground/80 hover:border-primary/30 hover:text-foreground transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                  data-testid="button-search-load-more"
                >
                  {searchFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Load more
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* News & blogs presets. */}
      {filteredSuggested.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-0.5">
            <Newspaper className="w-3.5 h-3.5 text-brand/70" />
            <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60">News &amp; blogs</span>
            <span className="text-[10px] text-muted-foreground/30 ml-auto">{filteredSuggested.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {filteredSuggested.map((sf) => (
              <button
                key={sf.url}
                onClick={() => addWithToast(sf)}
                className="group flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.02] border border-border/15 hover:bg-white/[0.05] hover:border-primary/20 text-left transition-all"
                data-testid={`button-suggest-${sf.name}`}
              >
                <div className="w-8 h-8 rounded-lg bg-muted/20 border border-border/15 flex items-center justify-center shrink-0">
                  <Newspaper className="w-3.5 h-3.5 text-muted-foreground/50" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{sf.name}</p>
                  <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{sf.category}</p>
                </div>
                <Plus className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-brand shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nothing matched. */}
      {!searchFetching && filteredSuggested.length === 0 &&
        (piConfigured !== true || (searchSearched && searchResults.length === 0)) && (
        <div className="text-center py-6 space-y-1">
          <p className="text-xs text-muted-foreground/50">No matches for &ldquo;{query.trim()}&rdquo;</p>
          <p className="text-[11px] text-muted-foreground/35">Paste a site URL, or add it manually below.</p>
        </div>
      )}
    </div>
  );

  const urlDetectBlock = (
    <div className="space-y-1.5">
      {detected.map((f) => {
        const added = existingUrls.has(f.url);
        return (
          <button
            key={f.url}
            disabled={added}
            onClick={() => addWithToast({ name: f.title || hostLabel(f.url), url: f.url, category: "News" })}
            className="w-full group flex items-center gap-2.5 p-2.5 rounded-xl bg-white/[0.02] border border-border/15 hover:bg-white/[0.05] hover:border-primary/20 text-left transition-all disabled:opacity-50 disabled:cursor-default"
            data-testid="button-detected-feed"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
              <Rss className="w-3.5 h-3.5 text-brand/70" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{f.title || "RSS feed"}</p>
              <p className="text-[10px] text-muted-foreground/40 font-mono truncate">{f.url}</p>
            </div>
            {added
              ? <span className="text-[10px] text-emerald-800/70 dark:text-emerald-400/70 shrink-0">Added</span>
              : <Plus className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-brand shrink-0 transition-colors" />}
          </button>
        );
      })}
      {detectSearched && detected.length === 0 && !detecting && (
        <p className="text-[11px] text-muted-foreground/40 px-1 leading-relaxed">
          No feed found there. Try the site's homepage, or add it manually below.
        </p>
      )}
    </div>
  );

  const manualDisclosure = (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setManualOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-1 py-1 text-left group cursor-pointer"
        aria-expanded={manualOpen}
        data-testid="button-toggle-manual-add"
      >
        <Rss className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-brand/70 transition-colors" />
        <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted-foreground/60 group-hover:text-muted-foreground/80 transition-colors">
          Add manually
        </span>
        {manualOpen
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />}
      </button>
      {manualOpen && (
        <div className="rounded-xl bg-white/[0.02] border border-border/20 p-4 space-y-3.5">
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">RSS URL</label>
            <Input
              value={mUrl}
              onChange={(e) => { setMUrl(e.target.value); setMError(""); }}
              placeholder="https://example.com/feed.xml"
              className={`font-mono ${isMobileDrawer ? "text-base h-11" : "text-xs"} bg-white/[0.03] border-border/30 focus:border-primary/40 rounded-xl`}
              inputMode="url"
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              data-testid="input-feed-url"
            />
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Feed Name <span className="text-muted-foreground/30 normal-case">(optional)</span></label>
            <Input
              value={mName}
              onChange={(e) => { setMName(e.target.value); setMError(""); }}
              placeholder="Auto-filled from the feed if left blank"
              className={`${isMobileDrawer ? "text-base h-11" : "text-sm"} bg-white/[0.03] border-border/30 focus:border-primary/40 rounded-xl`}
              enterKeyHint="next"
              autoCorrect="off"
              data-testid="input-feed-name"
            />
          </div>
          <div>
            <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5 block">Category</label>
            <Input
              value={mCategory}
              onChange={(e) => setMCategory(e.target.value)}
              placeholder="Bitcoin, Nostr, Tech…"
              className={`${isMobileDrawer ? "text-base h-11" : "text-sm"} bg-white/[0.03] border-border/30 focus:border-primary/40 rounded-xl`}
              enterKeyHint="done"
              autoCorrect="off"
              data-testid="input-feed-category"
            />
          </div>
          {mError && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/15 px-3 py-2.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-destructive" />
              <span className="text-xs text-destructive" data-testid="text-feed-error">{mError}</span>
            </div>
          )}
          <Button
            onClick={handleManualAdd}
            disabled={!mUrl.trim() || mVerifying}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-brand uppercase tracking-widest text-xs border border-primary/40 rounded-xl transition-colors"
            data-testid="button-confirm-add-feed"
          >
            {mVerifying ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
            {mVerifying ? "Verifying…" : "Add Feed"}
          </Button>
        </div>
      )}
    </div>
  );

  const footer = (
    // Plain, NON-LINKING attribution — the directory forbids external links.
    <div className="flex items-center justify-center gap-1.5 pt-1" data-testid="pi-attribution">
      <span className="text-[9px] text-muted-foreground/30">Powered by Podcast Index · Value for Value</span>
    </div>
  );

  return (
    <>
      <div className={`shrink-0 ${isMobileDrawer ? "px-4" : "px-5"} pt-1 pb-3`}>
        <div className="mx-auto w-full max-w-[600px]">{searchInput}</div>
      </div>
      <div
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide ${isMobileDrawer ? "px-4" : "px-5"} pb-[calc(2rem+env(safe-area-inset-bottom,0px))]`}
        style={{ WebkitOverflowScrolling: "touch" }}
        onScroll={() => {
          const el = document.activeElement;
          if (el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) el.blur();
        }}
        data-testid="add-feed-scroll"
      >
        <div className="mx-auto w-full max-w-[600px] space-y-4">
          {previewFeed ? (
            <FeedPreviewPanel
              feed={previewFeed}
              isAdded={existingUrls.has(previewFeed.url)}
              onBack={() => setPreviewFeed(null)}
              onAdd={addPodcast}
            />
          ) : (
            <>
              {isUrlQuery ? urlDetectBlock : hasQuery ? searchResultsBlock : zeroState}
              {!showCategorySheet && piConfigured === true && footer}
              <div className="h-px bg-border/15" />
              {manualDisclosure}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Outer shell: desktop Dialog + mobile full-screen portal (+ Esc/keyboard). ─
export function AddRssFeedDialog({
  onAdd, existingUrls, trigger, autoFocusSearch = false, onOpenFeed,
}: {
  onAdd: (feed: SavedFeed) => void;
  existingUrls: Set<string>;
  trigger?: React.ReactNode;
  autoFocusSearch?: boolean;
  onOpenFeed?: (feedUrl: string) => void;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // The mobile panel is a hand-rolled full-screen portal (no Radix root), so
  // it must join the modal-back contract itself: Back closes the panel, not
  // the News page under it. The desktop <Dialog> path inherits this from the
  // shared primitive; gating on the portal actually being shown keeps the two
  // paths from double-registering.
  useBackClosable(isMobile && open, () => setOpen(false));
  const { toast } = useToast();
  const kb = useKeyboardViewport(isMobile && open);

  useEffect(() => {
    if (!(isMobile && open)) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [isMobile, open]);

  const bodyProps = {
    onAdd,
    existingUrls,
    toast,
    autoFocusSearch,
    // "Open" toast action closes this dialog first, then jumps to the feed.
    onOpenFeed: onOpenFeed ? (feedUrl: string) => { setOpen(false); onOpenFeed(feedUrl); } : undefined,
  };

  const triggerButton = trigger ?? (
    <Button
      variant="outline"
      size="sm"
      className="font-brand uppercase tracking-widest text-xs border-brand/30 text-brand"
      aria-label="Add feed"
      data-testid="button-add-feed"
    >
      {/* Label yields below sm so the trigger fits the one-line News header
          beside "← Discover" — the + icon carries it on phones. */}
      <Plus className="w-3.5 h-3.5 sm:mr-1.5" />
      <span className="hidden sm:inline">Add Feed</span>
    </Button>
  );

  if (isMobile) {
    return (
      <>
        <span style={{ display: "contents" }} onClick={() => setOpen(true)}>{triggerButton}</span>
        {open && createPortal(
          <div
            className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top,0px)] animate-in fade-in-0 duration-150"
            style={kb.height != null ? { height: `${kb.height}px`, top: `${kb.offsetTop}px`, bottom: "auto" } : undefined}
            data-testid="add-feed-fullscreen"
          >
            {/* Opaque backing layer: iOS WebKit can drop the composited background of an
                animated/transformed fixed container that holds a scrollable descendant
                (same bug shape as PRs #321/#322). This plain layer keeps the panel solid. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-background" data-testid="add-feed-backing" />
            <div className="shrink-0 flex items-center gap-2 px-4 h-14 border-b border-border/15">
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
                <Rss className="w-3.5 h-3.5 text-brand" />
              </div>
              <span className="text-sm font-brand uppercase tracking-widest">Add RSS Feed</span>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                aria-label="Close"
                data-testid="button-close-add-feed"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <AddFeedBody {...bodyProps} isMobileDrawer />
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerButton}</DialogTrigger>
      <DialogContent className="max-w-[640px] w-[95vw] h-[min(680px,85vh)] overflow-hidden border-border/20 bg-background/95 backdrop-blur-xl p-0 flex flex-col">
        {/* Backing layer against the iOS/iPadOS scroll-in-transform compositing bug (PRs #321/#322);
            mirrors the shell's translucent blurred look. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-lg bg-background/95 backdrop-blur-xl" data-testid="add-feed-dialog-backing" />
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/15 shrink-0">
          <DialogTitle className="font-brand uppercase tracking-widest text-sm flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Rss className="w-3.5 h-3.5 text-brand" />
            </div>
            Add RSS Feed
          </DialogTitle>
        </DialogHeader>
        <AddFeedBody {...bodyProps} />
      </DialogContent>
    </Dialog>
  );
}

export default AddRssFeedDialog;
