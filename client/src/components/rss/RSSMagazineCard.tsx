import { useCallback, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Bookmark,
  BookmarkCheck,
  Share2,
  Play,
  Pause,
  Headphones,
  Newspaper,
  Clock,
  Zap,
  Layers,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useAudioPlayer, getTrackPosition } from "@/contexts/AudioPlayerContext";
import type { MusicTrack } from "@/lib/music";
import type { RSSItem } from "@/pages/RSSFeed";

// ── The desktop "magazine" front-page card ───────────────────────────────────
// Two image-forward layouts over ONE renderer so podcast playback, read-state
// dimming, the reserved-height image slot, and the card-open behaviour stay
// identical between them:
//   • "grid" — a vertical tile for the responsive card grid below the lead
//     block: reserved 16:10 image, source eyebrow, headline (clamped), relative
//     time, and bookmark/share actions.
//   • "rail" — a compact horizontal tile for the secondary column beside the
//     hero: reserved 4:3 thumb, source eyebrow, headline. No action bar (the
//     rail stays glanceable); tapping still opens the reader.
//
// This never rewrites RSSArticleCard/RSSHeroCard (used by mobile + the shared
// hero) — it is an additive grid variant, so the mobile reader is untouched.

export type RSSMagazineVariant = "grid" | "rail";

interface RSSMagazineCardProps {
  item: RSSItem;
  variant: RSSMagazineVariant;
  onRead: (item: RSSItem) => void;
  onMarkRead?: (item: RSSItem) => void;
  onShare: (item: RSSItem) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  feedTitle?: string;
  feedImage?: string;
  sourceName?: string;
  isRead?: boolean;
  /** When >1, this card leads a multi-outlet story cluster — shows an "N sources" chip. */
  outletCount?: number;
  /** Whether the source advertises Lightning value-for-value (shows a ⚡ badge on podcasts). */
  v4v?: boolean;
}

function durationLabelFor(seconds?: number): string | null {
  if (!seconds) return null;
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}m`;
}

export function RSSMagazineCard({
  item,
  variant,
  onRead,
  onMarkRead,
  onShare,
  isBookmarked,
  onToggleBookmark,
  feedTitle,
  feedImage,
  sourceName,
  isRead,
  outletCount,
  v4v,
}: RSSMagazineCardProps) {
  const isRail = variant === "rail";
  const imageUrl = item.thumbnail || feedImage || "";
  const [imgFailed, setImgFailed] = useState(false);

  const timeAgo = useMemo(() => {
    if (!item.pubDate) return "";
    try {
      return formatDistanceToNow(new Date(item.pubDate), { addSuffix: true });
    } catch {
      return "";
    }
  }, [item.pubDate]);

  // ── Podcast playback (mirrors RSSArticleCard/RSSHeroCard) ──
  const { play, currentTrack, isPlaying, togglePlay, currentTime: playerTime, duration: playerDuration } = useAudioPlayer();
  const podcastTrack: MusicTrack | null = useMemo(() => {
    if (!item.audioUrl) return null;
    return {
      id: `rss-${encodeURIComponent(item.audioUrl)}`,
      title: item.title || "Untitled Episode",
      artist: item.author || feedTitle || "Podcast",
      artistPubkey: "",
      audioUrl: item.audioUrl,
      coverUrl: item.thumbnail || feedImage || "",
      description: item.description || "",
      genre: "Podcast",
      duration: item.duration || 0,
      createdAt: item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : 0,
      source: "podcast" as const,
      albumTitle: feedTitle || undefined,
    };
  }, [item, feedTitle, feedImage]);
  const isCurrentPodcast = !!podcastTrack && currentTrack?.audioUrl === podcastTrack.audioUrl;
  const isThisPlaying = isCurrentPodcast && isPlaying;

  const savedPosition = useMemo(() => {
    if (!podcastTrack) return null;
    if (isCurrentPodcast && !isPlaying && playerTime > 5) {
      return { time: playerTime, duration: playerDuration || item.duration || 0 };
    }
    if (isCurrentPodcast) return null;
    return getTrackPosition(podcastTrack.id);
  }, [podcastTrack, isCurrentPodcast, isPlaying, playerTime, playerDuration, item.duration]);

  const progressPct = useMemo(() => {
    if (!savedPosition || !savedPosition.duration || savedPosition.duration <= 0) return 0;
    return Math.min(100, Math.max(0, (savedPosition.time / savedPosition.duration) * 100));
  }, [savedPosition]);

  const durationLabel = useMemo(() => durationLabelFor(item.duration), [item.duration]);

  const handlePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!podcastTrack) return;
    onMarkRead?.(item);
    isCurrentPodcast ? togglePlay() : play(podcastTrack);
  }, [podcastTrack, isCurrentPodcast, togglePlay, play, onMarkRead, item]);

  const playTitle = isThisPlaying ? "Pause" : savedPosition && savedPosition.time > 5 ? "Resume" : "Play";

  // Tapping the card body opens the reader; links + action buttons opt out.
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button[data-action]")) return;
    onRead(item);
  }, [item, onRead]);

  const showImage = !!imageUrl && !imgFailed;

  // Reserved-height image slot (PR #320 pattern): the aspect box always keeps its
  // height, so a missing/slow/broken image never shifts the grid. A failed image
  // falls back to the source-tinted placeholder icon rather than collapsing.
  const imageSlot = (aspectClass: string) => (
    <div className={`relative w-full ${aspectClass} shrink-0 overflow-hidden bg-muted/40 ${isRail ? "rounded-lg" : ""}`}>
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/25">
          {podcastTrack ? <Headphones className={isRail ? "w-6 h-6" : "w-9 h-9"} /> : <Newspaper className={isRail ? "w-6 h-6" : "w-9 h-9"} />}
        </div>
      )}
      {podcastTrack && (
        <>
          <button
            type="button"
            data-action="play"
            onClick={handlePlay}
            className="absolute inset-0 flex items-center justify-center focus:outline-none"
            aria-label={playTitle}
            title={playTitle}
            data-testid={`button-mag-play-${item.link}`}
          >
            <span className={`flex items-center justify-center rounded-full bg-black/45 backdrop-blur-sm border border-white/25 text-white shadow-lg transition-transform group-hover:scale-105 hover:bg-black/60 ${isRail ? "w-9 h-9" : "w-12 h-12"}`}>
              {isThisPlaying ? <Pause className={isRail ? "w-4 h-4" : "w-5 h-5"} /> : <Play className={`${isRail ? "w-4 h-4" : "w-5 h-5"} ml-0.5`} />}
            </span>
          </button>
          {durationLabel && (
            <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-black/60 text-white/90 text-[10px] font-mono px-1.5 py-0.5 tabular-nums">
              <Clock className="w-2.5 h-2.5" />
              {durationLabel}
            </span>
          )}
        </>
      )}
      {progressPct > 0 && (
        <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );

  const eyebrow = (
    <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
      {!isRead && <span aria-hidden className="w-[6px] h-[6px] rounded-full bg-primary shrink-0" />}
      <span className="font-mono uppercase tracking-wider text-muted-foreground/90 truncate max-w-[150px]">
        {sourceName || item.author || "Feed"}
      </span>
      {(outletCount ?? 0) > 1 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-brand/30 bg-brand/10 text-brand text-[10px] px-1.5 py-px shrink-0"
          title={`${outletCount} sources covering this story`}
        >
          <Layers className="w-2.5 h-2.5" />
          {outletCount}
        </span>
      )}
      {podcastTrack && v4v && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-500/90 shrink-0" title="Supports Lightning (value for value)">
          <Zap className="w-2.5 h-2.5 fill-current" />
        </span>
      )}
    </div>
  );

  if (isRail) {
    return (
      <Card
        className={`group glass-card hover-elevate cursor-pointer overflow-hidden p-2.5 flex gap-3 transition-opacity ${isRead ? "opacity-60" : ""}`}
        onClick={handleCardClick}
        data-read={isRead ? "true" : "false"}
        data-testid={`card-rss-rail-${item.link}`}
      >
        <div className="w-24 sm:w-28 shrink-0">{imageSlot("aspect-[4/3]")}</div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {eyebrow}
          <h3
            className={`text-sm leading-snug line-clamp-3 ${isRead ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}
            data-testid={`link-rss-rail-${item.link}`}
          >
            {item.title || "Untitled"}
          </h3>
          {timeAgo && <span className="mt-auto text-[11px] text-muted-foreground/70 font-mono">{timeAgo}</span>}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={`group glass-card hover-elevate cursor-pointer overflow-hidden flex flex-col h-full transition-opacity ${isRead ? "opacity-60" : ""}`}
      onClick={handleCardClick}
      data-read={isRead ? "true" : "false"}
      data-testid={`card-rss-grid-${item.link}`}
    >
      {imageSlot("aspect-[16/10]")}
      <div className="flex flex-col flex-1 gap-1.5 p-3 sm:p-3.5">
        {eyebrow}
        <h3
          className={`text-[15px] leading-snug line-clamp-3 ${isRead ? "font-semibold text-muted-foreground" : "font-bold text-foreground"}`}
          data-testid={`link-rss-grid-${item.link}`}
        >
          {item.title || "Untitled"}
        </h3>
        <div className="mt-auto pt-1.5 flex items-center gap-1">
          {timeAgo && <span className="text-[11px] text-muted-foreground/70 font-mono truncate">{timeAgo}</span>}
          <div className="ml-auto flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              data-action="bookmark"
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-muted/50 ${isBookmarked ? "text-brand" : "text-muted-foreground/70 hover:text-foreground"}`}
              aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
              title={isBookmarked ? "Saved" : "Save"}
              data-testid={`button-mag-bookmark-${item.link}`}
            >
              {isBookmarked ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            </button>
            <button
              type="button"
              data-action="share"
              onClick={(e) => { e.stopPropagation(); onShare(item); }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Share"
              title="Share"
              data-testid={`button-mag-share-${item.link}`}
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
