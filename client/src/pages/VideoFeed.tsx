import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { use$ } from "applesauce-react/hooks";
import { eventStore, pool, subscribeToFeed, subscribeToFeedPersistent, fetchProfilesCached, DEFAULT_RELAYS, getRelaysForPurpose, hasFeedData, markFeedDataLoaded, throttledPoolSubscribe } from "@/lib/nostr";
import { KIND_TEXT_NOTE, KIND_SHORT_VIDEO, VIDEO_EVENT_KINDS, DIVINE_VIDEO_RELAY } from "@/lib/nostr-helpers";
import { markVideosSeen, readSeenVideos, orderUnseenFirst } from "@/lib/video-seen";
import { prefetchStatsImmediate, primalStatsCache, fetchTrendingFeed } from "@/lib/primal-cache";
import { computeEngagementScore } from "@/lib/engagement";
import { getEventMediaInfo, extractMediaFromContent, classifyUrl, resolveEmbedId, getEmbedThumbnail, isEmbedType, embedPlatformLabel, parseImetaTags } from "@/lib/media-utils";
import { InlineEmbedPlayer } from "@/components/InlineEmbedPlayer";
import { getVideoMuted, setVideoMuted, isAutoplayMediaEnabled } from "@/lib/video-prefs";
import { InfiniteScrollSentinel } from "@/components/InfiniteScrollSentinel";
import { NewPostsPill } from "@/components/NewPostsPill";
import { useSpamFilter } from "@/hooks/use-spam-filter";
import { useTierContentFilter } from "@/hooks/use-tier-content-filter";
import { useProfileFloor } from "@/hooks/use-profile-floor";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { classifyProfileResolution } from "@/lib/spam-filter";
import { gateStrangerProfile } from "@/lib/discover-quality";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { RelayOutpostLoader, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDistanceToNow } from "date-fns";
import { Play, Video, LayoutGrid, LayoutList, ChevronUp, ChevronDown, Volume2, VolumeX, Loader2, Clock, TrendingUp, Flame, ExternalLink, MessageCircle, Filter, PictureInPicture2, X } from "lucide-react";
import { WalledGardenFallback } from "@/components/WalledGardenFallback";
import { MediaCommentsSection } from "@/components/MediaComments";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/PageTabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaInteractionBar } from "@/components/MediaInteractionBar";
import { BtcZapIcon } from "@/components/NostrPost";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePiP } from "@/contexts/PiPContext";
import type { Event } from "nostr-tools";
import divineLogo from "@assets/Black_on_white_1772061458294.png";

const PAGE_SIZE = 20;

function DivineBadge({ dark, eventId }: { dark?: boolean; eventId?: string }) {
  return (
    <img
      src={divineLogo}
      alt="Divine"
      className={`absolute top-2.5 right-2.5 z-10 h-5 w-auto rounded-md drop-shadow-lg ${dark ? "invert" : "dark:invert"}`}
      data-testid={`badge-divine-source${eventId ? `-${eventId}` : ""}`}
    />
  );
}

function getThreadUrl(eventId: string): string {
  try {
    return `/thread/${nip19.noteEncode(eventId)}`;
  } catch {
    return `/thread/${eventId}`;
  }
}

// Pull a poster/thumbnail for a video event so the first frame is instant.
// Prefers an imeta `thumb`/`image` matching the playing URL, then any imeta
// thumbnail, then a top-level `thumb`/`image` tag (kind-22 short videos).
function getVideoPoster(event: Event, videoUrl: string): string | undefined {
  try {
    const imeta = parseImetaTags(event.tags);
    const match = imeta.find((d) => d.url === videoUrl && d.thumbnail);
    if (match?.thumbnail) return match.thumbnail;
    const anyThumb = imeta.find((d) => d.thumbnail);
    if (anyThumb?.thumbnail) return anyThumb.thumbnail;
    const tag = event.tags.find((t) => (t[0] === "thumb" || t[0] === "image") && t[1]);
    if (tag?.[1]) return tag[1];
  } catch {}
  return undefined;
}

type SortMode = "latest" | "trending" | "most-zapped" | "top-engaged";

const SORT_OPTIONS: Array<{ value: SortMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "latest", label: "Latest", icon: Clock },
  { value: "trending", label: "Trending", icon: Flame },
];

/**
 * Mark a video seen once its card has actually been on screen (half visible)
 * — not merely rendered below the fold. Feeds the unseen-first ordering; the
 * mark takes effect on the NEXT feed build, never mid-scroll.
 */
function useMarkVideoSeenOnVisible(ref: React.RefObject<HTMLElement | null>, eventId: string) {
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        markVideosSeen([eventId]);
        obs.disconnect();
      }
    }, { threshold: 0.5 });
    obs.observe(node);
    return () => obs.disconnect();
  }, [ref, eventId]);
}

function getSessionSeed(): number {
  const key = "video_feed_session_seed";
  const stored = sessionStorage.getItem(key);
  if (stored) return parseInt(stored, 10);
  const seed = Math.floor(Math.random() * 2147483647);
  sessionStorage.setItem(key, String(seed));
  return seed;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function shuffleWithinTimeWindows<T extends { event: Event }>(entries: T[], seed: number, windowHours = 6): T[] {
  const windowSecs = windowHours * 3600;
  if (entries.length === 0) return entries;

  const sorted = [...entries].sort((a, b) => b.event.created_at - a.event.created_at);
  const newestTs = sorted[0].event.created_at;
  const buckets = new Map<number, T[]>();

  for (const entry of sorted) {
    const bucketKey = Math.floor((newestTs - entry.event.created_at) / windowSecs);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(entry);
    else buckets.set(bucketKey, [entry]);
  }

  const bucketKeys = [...buckets.keys()].sort((a, b) => a - b);
  const result: T[] = [];
  for (const key of bucketKeys) {
    result.push(...seededShuffle(buckets.get(key)!, seed + key));
  }
  return result;
}

function interleaveByKind<T extends { event: Event }>(entries: T[], maxRun = 2): T[] {
  const divine: T[] = [];
  const regular: T[] = [];
  for (const e of entries) {
    if (e.event.kind === KIND_SHORT_VIDEO) divine.push(e);
    else regular.push(e);
  }
  if (divine.length === 0 || regular.length === 0) return entries;

  const result: T[] = [];
  let lastKind: number | null = null;
  let runCount = 0;
  const queue = [...entries];

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    const kind = entry.event.kind === KIND_SHORT_VIDEO ? KIND_SHORT_VIDEO : KIND_TEXT_NOTE;

    if (kind === lastKind) {
      runCount++;
      if (runCount > maxRun) {
        const altKind = kind === KIND_SHORT_VIDEO ? KIND_TEXT_NOTE : KIND_SHORT_VIDEO;
        const altIdx = queue.findIndex((e, j) => j > i && (e.event.kind === KIND_SHORT_VIDEO ? KIND_SHORT_VIDEO : KIND_TEXT_NOTE) === altKind);
        if (altIdx !== -1) {
          const [alt] = queue.splice(altIdx, 1);
          queue.splice(i, 0, alt);
          result.push(alt);
          lastKind = altKind;
          runCount = 1;
          continue;
        }
      }
    } else {
      runCount = 1;
    }

    result.push(entry);
    lastKind = kind;
  }

  return result;
}

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

// Scroll the video feed back to top when a player starts, keeping the active
// video in view. Passed to the shared InlineEmbedPlayer via its onPlay prop.
function scrollFeedToTop() {
  const scrollContainer = document.querySelector('main.feed-scroll-container') || document.querySelector('main');
  if (scrollContainer) scrollContainer.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: "auto" });
}

function VideoProgressBar({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const seekingRef = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onMeta = () => setDuration(el.duration || 0);
    const onDurationChange = () => setDuration(el.duration || 0);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onDurationChange);
    if (el.duration) setDuration(el.duration);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onDurationChange);
    };
  }, [videoRef]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      if (!seekingRef.current && el.duration) {
        setProgress(el.currentTime / el.duration);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(rafRef.current); };
  }, [videoRef]);

  const seekTo = useCallback((clientX: number) => {
    const track = trackRef.current;
    const el = videoRef.current;
    if (!track || !el || !el.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
    setProgress(ratio);
  }, [videoRef]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    seekingRef.current = true;
    setIsSeeking(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  }, [seekTo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!seekingRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(e.clientX);
  }, [seekTo]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!seekingRef.current) return;
    e.stopPropagation();
    seekingRef.current = false;
    setIsSeeking(false);
  }, []);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const currentTime = duration * progress;

  if (!duration) return null;

  return (
    <div
      className={`absolute left-0 right-0 z-30 pointer-events-auto px-3 transition-opacity duration-200 ${isSeeking ? "opacity-100" : "opacity-70"}`}
      // 68px above the (now-overlaying) bottom nav: nav is 60px + safe-area.
      style={{ bottom: "calc(128px + env(safe-area-inset-bottom, 0px))" }}
      data-testid="video-progress-bar"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-white/80 tabular-nums w-8 text-right shrink-0">{formatTime(currentTime)}</span>
        <div
          ref={trackRef}
          className="relative flex-1 h-6 flex items-center cursor-pointer touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="absolute left-0 right-0 h-[3px] rounded-full bg-white/20" />
          <div className="absolute left-0 h-[3px] rounded-full bg-white/70" style={{ width: `${progress * 100}%` }} />
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md transition-transform duration-100 ${isSeeking ? "w-3.5 h-3.5 scale-110" : "w-2.5 h-2.5"}`}
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-white/50 tabular-nums w-8 shrink-0">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

function ShortsCard({ event, videoUrl, isActive, isMuted, shouldPreload = false, disableAutoplay = false, onToggleMute }: { event: Event; videoUrl: string; isActive: boolean; isMuted: boolean; shouldPreload?: boolean; disableAutoplay?: boolean; onToggleMute: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Immersive pager: the ACTIVE card is the one being watched — that is the
  // seen signal here (visibility is meaningless when every card fills the screen).
  useEffect(() => {
    if (isActive) markVideosSeen([event.id]);
  }, [isActive, event.id]);
  const [error, setError] = useState(false);
  const [showPlayIcon, setShowPlayIcon] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const { notifyUnmount } = usePiP();

  // Tap the video to pause/resume (native short-video behaviour). The play
  // overlay mirrors the element's real state via its play/pause events.
  const handleVideoTap = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setShowPlayIcon(false);
    const onPause = () => setShowPlayIcon(true);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, []);

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

  const urlType = useMemo(() => classifyUrl(videoUrl), [videoUrl]);
  const isEmbed = isEmbedType(urlType);
  const embedId = useMemo(() => isEmbed ? resolveEmbedId(videoUrl, urlType) : null, [videoUrl, urlType, isEmbed]);

  const autoplayEnabled = useMemo(() => isAutoplayMediaEnabled(), []);
  const canAutoplay = autoplayEnabled && !disableAutoplay;

  useEffect(() => {
    if (isEmbed || !videoRef.current) return;
    if (isActive && canAutoplay) {
      // If autoplay is blocked (e.g. unmuted-by-default or no user gesture yet),
      // the play() promise rejects with NO `pause` event — surface the tap-to-play
      // affordance so the card doesn't sit on a poster with no control.
      videoRef.current.play().catch(() => setShowPlayIcon(true));
    } else {
      // Paused on mount (inactive slide, or data-saver/autoplay-off): show the
      // play overlay so there's always a visible way to start playback.
      videoRef.current.pause();
      if (!canAutoplay) setShowPlayIcon(true);
    }
  }, [isActive, isEmbed, canAutoplay]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = isMuted;
    if (isActive && !isMuted && canAutoplay) {
      videoRef.current.play().catch(() => setShowPlayIcon(true));
    }
  }, [isMuted, isActive, canAutoplay]);

  // Buffering spinner: track readiness so a slow MP4 doesn't look frozen.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("stalled", onWaiting);
    return () => {
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("stalled", onWaiting);
    };
  }, []);

  useEffect(() => {
    const vUrl = videoUrl;
    return () => { notifyUnmount(vUrl); };
  }, [videoUrl, notifyUnmount]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onLeave = () => { try { el.pause(); } catch {} };
    el.addEventListener("leavepictureinpicture", onLeave);
    return () => el.removeEventListener("leavepictureinpicture", onLeave);
  }, []);

  const { text: textContent } = useMemo(() => extractMediaFromContent(event.content), [event.content]);
  const previewText = textContent.length > 100 ? textContent.slice(0, 100) + "..." : textContent;
  const poster = useMemo(() => getVideoPoster(event, videoUrl), [event, videoUrl]);
  // Active slide loads fully; next 1–2 prefetch; everything else stays light.
  const preload = isActive || shouldPreload ? "auto" : "metadata";

  return (
    <div
      className="shorts-slide"
      data-testid={`shorts-card-${event.id}`}
    >
      {/* Full-bleed media: object-cover fills the slide edge-to-edge (no
          letterbox bars), TikTok/Shorts style. The slide is sized down to
          just above the app bottom nav via .shorts-slide CSS. */}
      <div className="absolute inset-0 bg-black flex items-center justify-center">
        {event.kind === KIND_SHORT_VIDEO && <DivineBadge dark eventId={event.id} />}
        {isEmbed && embedId ? (
          /* Embeds are interactive white iframes (X posts, YouTube), not video
             pixels — full-bleed they collide with the fixed chrome (mute, nav
             chevrons, caption, counter) and their own controls get covered.
             Contain them in a letterboxed box clear of the top controls and
             the bottom caption/counter zone; native <video> stays full-bleed. */
          <div
            className="absolute inset-x-0 flex items-center justify-center overflow-hidden"
            style={{
              top: "calc(env(safe-area-inset-top, 0px) + 3.5rem)",
              bottom: "8.5rem",
            }}
          >
            <InlineEmbedPlayer
              type={urlType}
              embedId={embedId}
              autoplay={isActive && autoplayEnabled}
              testId={`embed-shorts-${event.id}`}
              onPlay={scrollFeedToTop}
            />
          </div>
        ) : error ? (
          <WalledGardenFallback type="video" dark className="!rounded-none !border-0 h-full" />
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            poster={poster}
            className="w-full h-full object-cover"
            playsInline
            muted={isMuted}
            loop
            preload={preload}
            onError={() => setError(true)}
            onClick={handleVideoTap}
            data-testid={`video-shorts-${event.id}`}
          />
        )}
        {/* Buffering spinner — keeps a slow MP4 from looking frozen. */}
        {!isEmbed && !error && buffering && !showPlayIcon && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-9 h-9 text-white/80 animate-spin" data-testid={`spinner-shorts-${event.id}`} />
          </div>
        )}
        {!isEmbed && !error && showPlayIcon && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center">
              <Play className="w-8 h-8 text-white/90 fill-white/90 translate-x-0.5" />
            </div>
          </div>
        )}
      </div>

      {/* Duration scrubber is desktop-only; on mobile shorts behave like native
          reels (tap to pause, swipe to advance) without a timeline bar. */}
      {!isEmbed && (
        <div className="hidden sm:block">
          <VideoProgressBar videoRef={videoRef} />
        </div>
      )}

      {/* Single mute/unmute toggle (device handles volume). Top-right safe zone
          with a small scrim, clear of the grid toggle in the container. */}
      {!isEmbed && (
        <div
          className="absolute right-3 z-20 pointer-events-auto"
          // Same row as the X close button (owner report: the two floated at
          // different heights). Both are 44px circles at safe-top + 0.625rem.
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.625rem)" }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white active-elevate-2"
            data-testid={`button-mute-toggle-${event.id}`}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      )}

      {/* Right action rail: like/repost/zap/bookmark/share/orbit. Raised above
          the bottom nav via safe-area padding; width-capped caption (pr-20)
          leaves room so they never overlap. */}
      <div
        className="absolute right-2.5 z-20 flex flex-col items-center gap-5 pointer-events-auto"
        // 60px bottom dock overlays the slide (same constant the caption and
        // progress bar already add) — without it the rail's lowest icons sat
        // behind the dock on phones (owner screenshot, iPhone Air).
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 60px + 1rem)" }}
        data-testid={`shorts-actions-${event.id}`}
      >
        <MediaInteractionBar event={event} vertical />
      </div>

      {/* Author + caption: bottom-left gradient scrim, raised above the nav,
          padded on the right (pr-20) to clear the action rail. */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85) 75%)" }}>
        <div className="px-4 pt-10 pr-20 pointer-events-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem + 60px)" }}>
          <div className="flex items-center gap-2.5 mb-2">
            <Link href={profileUrl} data-testid={`link-shorts-avatar-${event.id}`}>
              <Avatar className="w-9 h-9 border-2 border-white/30 shrink-0">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="text-[11px] bg-white/10 text-white">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={profileUrl} className="text-sm font-semibold text-white truncate block" data-testid={`link-shorts-author-${event.id}`}>
                {displayName}
              </Link>
              <span className="text-[11px] text-white/40" data-testid={`text-shorts-time-${event.id}`}>{timeAgo}</span>
            </div>
            <Link
              href={getThreadUrl(event.id)}
              className="shrink-0 flex items-center gap-1.5 text-xs text-white/60 hover:text-white bg-white/10 hover:bg-white/20 rounded-md px-2.5 py-1.5 transition-colors"
              data-testid={`link-shorts-view-post-${event.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" /> View Post
            </Link>
          </div>
          {previewText && (
            <p className="text-xs text-white/70 line-clamp-2" data-testid={`text-shorts-desc-${event.id}`}>{previewText}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoCard({ event, videoUrl }: { event: Event; videoUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useMarkVideoSeenOnVisible(cardRef, event.id);
  const [error, setError] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const { enterPiP, isPiP, pipVideoSrc, pipSupported, notifyUnmount } = usePiP();
  const isThisPiP = isPiP && pipVideoSrc === videoUrl;

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

  const urlType = useMemo(() => classifyUrl(videoUrl), [videoUrl]);
  const isEmbed = isEmbedType(urlType);

  const embedId = useMemo(() => isEmbed ? resolveEmbedId(videoUrl, urlType) : null, [videoUrl, urlType, isEmbed]);

  const autoplayEnabled = useMemo(() => isAutoplayMediaEnabled(), []);

  useEffect(() => {
    const vUrl = videoUrl;
    return () => { notifyUnmount(vUrl); };
  }, [videoUrl, notifyUnmount]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onLeave = () => { try { el.pause(); } catch {} };
    el.addEventListener("leavepictureinpicture", onLeave);
    return () => el.removeEventListener("leavepictureinpicture", onLeave);
  }, []);

  useEffect(() => {
    if (isEmbed || !videoRef.current || !cardRef.current) return;
    if (!autoplayEnabled) return;

    const videoEl = videoRef.current;
    const cardEl = cardRef.current;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            videoEl.play().catch(() => {});
          } else {
            if (document.pictureInPictureElement === videoEl) return;
            videoEl.pause();
          }
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(cardEl);
    return () => observer.disconnect();
  }, [isEmbed]);

  const { text: textContent } = useMemo(() => extractMediaFromContent(event.content), [event.content]);
  const previewText = textContent.length > 120 ? textContent.slice(0, 120) + "..." : textContent;

  if (isEmbed && embedId) {
    return (
      <div
        className="rounded-xl overflow-hidden border border-border/40 glass-card"
        data-testid={`video-card-${event.id}`}
      >
        <div className="relative bg-black" style={{ aspectRatio: "16/9" }}>
          {event.kind === KIND_SHORT_VIDEO && <DivineBadge eventId={event.id} />}
          <InlineEmbedPlayer
            type={urlType}
            embedId={embedId}
            testId={`embed-card-${event.id}`}
            onPlay={scrollFeedToTop}
          />
        </div>
        <div className="p-3 space-y-1.5">
          {previewText && (
            <p className="text-xs text-foreground/70 line-clamp-2" data-testid={`text-video-desc-${event.id}`}>{previewText}</p>
          )}
          <div className="flex items-center gap-2">
            <Link href={profileUrl} data-testid={`link-avatar-${event.id}`}>
              <Avatar className="w-6 h-6 border border-border/50 shrink-0 cursor-pointer">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback className="text-[8px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </Link>
            <Link href={profileUrl} className="text-xs font-medium truncate flex-1 text-foreground/80 cursor-pointer" data-testid={`link-author-${event.id}`}>
              {displayName}
            </Link>
            <span className="text-[11px] text-muted-foreground/70 shrink-0" data-testid={`text-time-${event.id}`}>{timeAgo}</span>
            <Link
              href={getThreadUrl(event.id)}
              className="text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
              title="View post"
              data-testid={`link-view-post-${event.id}`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
          <MediaInteractionBar event={event} onCommentClick={() => setShowComments((c) => !c)} />
        </div>
        <MediaCommentsSection event={event} open={showComments} />
      </div>
    );
  }

  if (isEmbed && !embedId) {
    return (
      <div
        className="relative rounded-xl overflow-hidden border border-border/40 bg-card"
        data-testid={`video-card-${event.id}`}
      >
        {event.kind === KIND_SHORT_VIDEO && <DivineBadge eventId={event.id} />}
        <WalledGardenFallback type="embed" url={videoUrl} />
        <div className="px-3 py-2.5 flex items-center gap-2">
          <Link href={profileUrl} data-testid={`link-avatar-${event.id}`}>
            <Avatar className="w-6 h-6 border border-border/50 shrink-0 cursor-pointer">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[8px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <span className="text-xs font-medium truncate flex-1 text-foreground/80" data-testid={`text-author-${event.id}`}>{displayName}</span>
          <span className="text-[11px] text-muted-foreground/70 shrink-0" data-testid={`text-time-${event.id}`}>{timeAgo}</span>
          <Link
            href={getThreadUrl(event.id)}
            className="text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
            title="View post"
            data-testid={`link-view-post-unavail-${event.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        <MediaInteractionBar event={event} onCommentClick={() => setShowComments((c) => !c)} />
        <MediaCommentsSection event={event} open={showComments} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl overflow-hidden border border-border/40 bg-card"
        data-testid={`video-card-error-${event.id}`}
      >
        <WalledGardenFallback type="video" url={videoUrl} />
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="rounded-xl overflow-hidden border border-border/40 bg-card"
      data-testid={`video-card-${event.id}`}
    >
      <div className="relative bg-black group/vcard">
        {event.kind === KIND_SHORT_VIDEO && <DivineBadge eventId={event.id} />}
        {pipSupported && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              const video = videoRef.current;
              if (!video) return;
              await enterPiP(video, videoUrl, true);
            }}
            className={`absolute top-2 left-2 sm:left-auto sm:right-2 z-10 p-1.5 rounded-full backdrop-blur-md transition-all ${isThisPiP ? "bg-green-500/30 text-green-800 dark:text-green-300" : "bg-black/50 text-white/70 hover:text-white hover:bg-black/70"} opacity-0 group-hover/vcard:opacity-100 focus:opacity-100`}
            title={isThisPiP ? "Playing in Picture-in-Picture" : "Picture-in-Picture"}
            data-testid={`button-pip-${event.id}`}
          >
            <PictureInPicture2 className="w-4 h-4" />
          </button>
        )}
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full max-h-[70vh] sm:max-h-[500px] object-contain"
          controls
          playsInline
          muted
          loop
          preload="metadata"
          onError={() => setError(true)}
          data-testid={`video-player-${event.id}`}
        />
      </div>
      <div className="p-3 space-y-1.5">
        {previewText && (
          <p className="text-xs text-foreground/70 line-clamp-2" data-testid={`text-video-desc-${event.id}`}>{previewText}</p>
        )}
        <div className="flex items-center gap-2">
          <Link href={profileUrl} data-testid={`link-avatar-${event.id}`}>
            <Avatar className="w-6 h-6 border border-border/50 shrink-0 cursor-pointer">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[8px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
          <Link href={profileUrl} className="text-xs font-medium truncate flex-1 text-foreground/80 cursor-pointer" data-testid={`link-author-${event.id}`}>
            {displayName}
          </Link>
          <span className="text-[11px] text-muted-foreground/70 shrink-0" data-testid={`text-time-${event.id}`}>{timeAgo}</span>
          <Link
            href={getThreadUrl(event.id)}
            className="text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
            title="View post"
            data-testid={`link-view-post-native-${event.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
        <MediaInteractionBar event={event} onCommentClick={() => setShowComments((c) => !c)} />
        <MediaCommentsSection event={event} open={showComments} />
      </div>
    </div>
  );
}

function VideoListItem({ event, videoUrl }: { event: Event; videoUrl: string }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useMarkVideoSeenOnVisible(rootRef, event.id);
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

  const urlType = useMemo(() => classifyUrl(videoUrl), [videoUrl]);
  const isEmbed = isEmbedType(urlType);
  const embedId = useMemo(() => isEmbed ? resolveEmbedId(videoUrl, urlType) : null, [videoUrl, urlType, isEmbed]);

  const thumbnailUrl = useMemo(() => {
    if (isEmbed && embedId) return getEmbedThumbnail(urlType, embedId);
    return null;
  }, [urlType, embedId, isEmbed]);

  const { text: textContent } = useMemo(() => extractMediaFromContent(event.content), [event.content]);
  const previewText = textContent.length > 100 ? textContent.slice(0, 100) + "..." : textContent;

  const platformLabel = embedPlatformLabel(urlType);

  return (
    <div
      ref={rootRef}
      className="rounded-lg border border-border/20 bg-card/50"
      data-testid={`video-list-item-${event.id}`}
    >
      {expanded && isEmbed && embedId ? (
        <div className="relative bg-black rounded-t-lg" style={{ aspectRatio: "16/9" }}>
          <InlineEmbedPlayer
            type={urlType}
            embedId={embedId}
            autoplay
            testId={`embed-list-${event.id}`}
            onPlay={scrollFeedToTop}
          />
        </div>
      ) : (
        <div
          className="flex gap-3 p-2 cursor-pointer hover-elevate flex-wrap"
          onClick={() => {
            if (isEmbed && embedId) {
              setExpanded(true);
              const scrollContainer = document.querySelector('main.feed-scroll-container') || document.querySelector('main');
              if (scrollContainer) scrollContainer.scrollTop = 0;
              window.scrollTo({ top: 0, behavior: "auto" });
            }
          }}
          role={isEmbed && embedId ? "button" : undefined}
          tabIndex={isEmbed && embedId ? 0 : undefined}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && isEmbed && embedId) {
              e.preventDefault();
              setExpanded(true);
              const scrollContainer = document.querySelector('main.feed-scroll-container') || document.querySelector('main');
              if (scrollContainer) scrollContainer.scrollTop = 0;
              window.scrollTo({ top: 0, behavior: "auto" });
            }
          }}
        >
          <div
            className="w-28 h-20 sm:w-40 sm:h-[90px] rounded-md overflow-hidden bg-muted/30 shrink-0 relative flex items-center justify-center"
            data-testid={`thumbnail-list-${event.id}`}
          >
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt="Video thumbnail" className="w-full h-full object-cover" loading="lazy" data-testid={`img-list-thumbnail-${event.id}`} />
            ) : (
              <div className="w-full h-full bg-black/40 flex items-center justify-center">
                <Play className="w-6 h-6 text-white/60" />
              </div>
            )}
            {isEmbed && (
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-black/70 text-white/80" data-testid={`text-list-platform-${event.id}`}>
                {platformLabel}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-7 bg-white/20 backdrop-blur-sm rounded flex items-center justify-center">
                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              {previewText && (
                <p className="text-xs text-foreground/70 line-clamp-2 mb-1" data-testid={`text-list-desc-${event.id}`}>{previewText}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={profileUrl} data-testid={`link-list-avatar-${event.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <Avatar className="w-5 h-5 border border-border/50 shrink-0 cursor-pointer">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="text-[7px] bg-muted">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              </Link>
              <Link href={profileUrl} className="text-xs font-medium truncate text-foreground/80 cursor-pointer" data-testid={`link-list-author-${event.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                {displayName}
              </Link>
              <span className="text-[11px] text-muted-foreground/70 shrink-0 ml-auto" data-testid={`text-list-time-${event.id}`}>{timeAgo}</span>
              <Link
                href={getThreadUrl(event.id)}
                className="text-muted-foreground/50 hover:text-brand/70 transition-colors shrink-0"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                title="View post"
                data-testid={`link-list-view-post-${event.id}`}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// `sort` (optional) makes the sort externally controlled — the feed-macro
// dropdown in Home owns it and the internal sort chip is hidden entirely.
export default function VideoFeed({ embedded = false, sort }: { embedded?: boolean; sort?: SortMode } = {}) {
  const isMobile = useIsMobile();
  const { filter: spamFilter } = useSpamFilter();
  const tierFilter = useTierContentFilter();
  useDocumentTitle("Videos");
  const shortsContainerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const [cutoffTimestamp, setCutoffTimestamp] = useState(() => Math.floor(Date.now() / 1000));
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(() => !hasFeedData());
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  // Mobile defaults to the TikTok-style shorts viewer; toggleable to the grid.
  const [shortsMode, setShortsMode] = useState(true);
  const [internalSortMode, setSortMode] = useState<SortMode>("latest");
  const sortMode = sort ?? internalSortMode;
  const [statsVersion, setStatsVersion] = useState(0);
  const [isMuted, setIsMuted] = useState(getVideoMuted);
  // Persist mute choice so it carries across the feed and future sessions (X-style).
  useEffect(() => { setVideoMuted(isMuted); }, [isMuted]);
  // Full-bleed contract with the app chrome: while the shorts viewer is open,
  // body.shorts-open lifts the bottom nav ABOVE the video layer and makes the
  // dock translucent (index.css) so the video runs behind the nav + center
  // button. Cleaned up on unmount and when leaving shorts mode.
  useEffect(() => {
    const open = isMobile && shortsMode;
    if (open) document.body.classList.add("shorts-open");
    else document.body.classList.remove("shorts-open");
    return () => document.body.classList.remove("shorts-open");
  }, [isMobile, shortsMode]);
  // Respect the OS/browser data-saver flag: don't autoplay, show poster + tap.
  const saveData = useMemo(() => {
    try { return (navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData === true; } catch { return false; }
  }, []);
  const toggleMute = useCallback(() => setIsMuted((m) => !m), []);

  useEffect(() => {
    const key = "relay-outpost-scroll-/videos";
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
    // Feed-stability: only apply the periodic trending re-rank while the
    // reader is at the top — never reorder the grid under them (see ImagesFeed).
    const interval = setInterval(() => {
      const scroller = document.querySelector<HTMLElement>(".feed-scroll-container");
      if (scroller && scroller.scrollTop > 80) return;
      setStatsVersion((v) => v + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, [sortMode]);

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    const noteRelays = getRelaysForPurpose('notes');
    const sub = subscribeToFeed({
      kinds: [KIND_TEXT_NOTE],
      limit: 100,
      since: now - 48 * 60 * 60,
    }, noteRelays, () => {
      setCutoffTimestamp(Math.floor(Date.now() / 1000));
      setIsInitialLoading(false);
      markFeedDataLoaded();
    });

    const liveSub = subscribeToFeedPersistent({
      kinds: [KIND_TEXT_NOTE],
      since: Math.floor(Date.now() / 1000),
    }, noteRelays);

    const divineSub = subscribeToFeed({
      kinds: [KIND_SHORT_VIDEO],
      limit: 100,
      since: now - 72 * 60 * 60,
    }, [DIVINE_VIDEO_RELAY]);

    const divineLiveSub = subscribeToFeedPersistent({
      kinds: [KIND_SHORT_VIDEO],
      since: now,
    }, [DIVINE_VIDEO_RELAY]);

    // The GENERAL network's video kinds — NIP-71 21/22 plus the legacy
    // addressable pair. This is where most new video publishing lives now;
    // divine's relay carries only the 34236 archive, so without this sub the
    // feed was the archive plus whatever kind-1 notes happened to link video.
    const videoKindsSub = subscribeToFeed({
      kinds: [...VIDEO_EVENT_KINDS],
      limit: 100,
      since: now - 7 * 24 * 60 * 60,
    }, noteRelays);

    const videoKindsLiveSub = subscribeToFeedPersistent({
      kinds: [...VIDEO_EVENT_KINDS],
      since: now,
    }, noteRelays);

    fetchTrendingFeed("trending_4h", undefined, 100).catch(() => {});
    fetchTrendingFeed("hot", undefined, 100).catch(() => {});

    return () => {
      sub.close();
      liveSub.close();
      divineSub.close();
      divineLiveSub.close();
      videoKindsSub.close();
      videoKindsLiveSub.close();
    };
  }, []);

  const allTextNotes = use$(() => eventStore.timeline({ kinds: [KIND_TEXT_NOTE] }), []);
  const allShortVideos = use$(() => eventStore.timeline({ kinds: [...VIDEO_EVENT_KINDS] }), []);

  const sessionSeed = useMemo(() => getSessionSeed(), []);
  const seenSnapshot = useMemo(() => readSeenVideos(), []);

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
  // Both sources feed the gate, so both sources' authors must be prefetched.
  const profileFloorCandidates = useMemo(
    () => [...(allTextNotes ?? []).slice(0, 150), ...(allShortVideos ?? []).slice(0, 150)],
    [allTextNotes, allShortVideos],
  );
  const { profileGetter, profileSettledGetter, profileVersion } = useProfileFloor(profileFloorCandidates);

  const allVideoEntries = useMemo(() => {
    // Honor the shared WoT excluded-tier set (same filter the main feed and
    // outposts use) on both sources, on top of the spam filter.
    const textNotes = allTextNotes ? tierFilter(spamFilter(allTextNotes, {
      follows: followSet,
      hideNoProfile: true,
      profileGetter,
      profileSettledGetter,
      scoreGetter: (pk: string) => grapeRankScores?.get(pk),
    })) : [];
    // Short-form videos skip the full spam filter (deliberate — a curated
    // source), but the profile gate still applies: an npub-author video card
    // is the same spam signature here as in the text pipeline.
    const admitAuthor = (pk: string) =>
      followSet.has(pk) ||
      gateStrangerProfile({
        isInNetwork: false,
        wotScore: grapeRankScores?.get(pk),
        resolution: classifyProfileResolution(pk, profileGetter, profileSettledGetter),
      }) === "admit";
    const shortVideos = allShortVideos ? tierFilter(allShortVideos).filter((e) => admitAuthor(e.pubkey)) : [];
    const entries: Array<{ event: Event; videoUrl: string }> = [];

    for (const event of textNotes) {
      const info = getEventMediaInfo(event.content, event.tags);
      if (info.hasVideo) {
        for (const url of info.videoUrls) {
          if (classifyUrl(url) === "youtube") continue;
          entries.push({ event, videoUrl: url });
        }
      }
    }

    for (const event of shortVideos) {
      const info = getEventMediaInfo(event.content || "", event.tags);
      if (info.hasVideo) {
        for (const url of info.videoUrls) {
          entries.push({ event, videoUrl: url });
        }
      }
    }

    let sorted = sortEntries(entries, sortMode);
    if (sortMode === "latest") {
      sorted = shuffleWithinTimeWindows(sorted, sessionSeed);
    }
    // Unseen-first, from the MOUNT-TIME snapshot of the seen ledger: videos
    // this device already showed sink below fresh ones, but marks made while
    // scrolling never reorder the grid mid-session (feed-stability rule) —
    // they take effect next visit.
    return orderUnseenFirst(interleaveByKind(sorted), seenSnapshot);
    // profileVersion: a kind-0 arrival must re-run the gate to un-hide its
    // author's held posts (grace → admit).
  }, [allTextNotes, allShortVideos, spamFilter, tierFilter, sortMode, statsVersion, sessionSeed, seenSnapshot, followSet, profileGetter, profileSettledGetter, profileVersion, grapeRankScores]);

  const displayedEntries = useMemo(() => {
    return allVideoEntries
      .filter((e) => e.event.created_at <= cutoffTimestamp)
      .slice(0, displayLimit);
  }, [allVideoEntries, cutoffTimestamp, displayLimit]);

  const bufferedCount = useMemo(() => {
    return allVideoEntries.filter((e) => e.event.created_at > cutoffTimestamp).length;
  }, [allVideoEntries, cutoffTimestamp]);

  const showBuffered = useCallback(() => {
    setCutoffTimestamp(Math.floor(Date.now() / 1000));
    setDisplayLimit((prev) => Math.max(prev, PAGE_SIZE));
    if (!isMobile) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [isMobile]);

  // Pill tap: merge the buffer AND return to top (this replaces the old
  // rocket-with-dot path, which scrolled the app container on tap).
  const revealBufferedAtTop = useCallback(() => {
    showBuffered();
    const scroller = document.querySelector<HTMLElement>(".feed-scroll-container");
    scroller?.scrollTo({ top: 0, behavior: "instant" });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [showBuffered]);

  // Broadcast the pending count so the global rocket FAB yields to the pill
  // (one adaptive control — see ScrollToTopButton). `source` keys the count
  // so this feed's 0s can't clobber another dispatcher's live count.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("new-posts-update", {
      detail: { source: "videos", count: bufferedCount }
    }));
  }, [bufferedCount]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent("new-posts-update", {
        detail: { source: "videos", count: 0 }
      }));
    };
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    const oldest = displayedEntries[displayedEntries.length - 1];
    const oldestTs = oldest ? oldest.event.created_at : Math.floor(Date.now() / 1000) - 48 * 60 * 60;

    let receivedCount = 0;
    let subsComplete = 0;
    const totalSubs = 3;

    const checkComplete = () => {
      subsComplete++;
      if (subsComplete >= totalSubs) {
        if (receivedCount === 0) {
          setHasMore(false);
        } else {
          setDisplayLimit((prev) => prev + PAGE_SIZE);
        }
        setIsLoadingMore(false);
        loadingMoreRef.current = false;
      }
    };

    const sub = throttledPoolSubscribe(DEFAULT_RELAYS, {
      kinds: [KIND_TEXT_NOTE],
      until: oldestTs,
      since: oldestTs - 24 * 60 * 60,
      limit: 100,
    }, {
      onevent(event) {
        receivedCount++;
        eventStore.add(event);
      },
      oneose() {
        sub.close();
        checkComplete();
      },
    });

    const divineSub = throttledPoolSubscribe([DIVINE_VIDEO_RELAY], {
      kinds: [KIND_SHORT_VIDEO],
      until: oldestTs,
      since: oldestTs - 48 * 60 * 60,
      limit: 100,
    }, {
      onevent(event) {
        receivedCount++;
        eventStore.add(event);
      },
      oneose() {
        divineSub.close();
        checkComplete();
      },
    });

    // Dedicated video kinds page much sparser than kind-1: give the window a
    // week per page so "load more" actually reaches older archive content.
    const videoKindsSub = throttledPoolSubscribe(DEFAULT_RELAYS, {
      kinds: [...VIDEO_EVENT_KINDS],
      until: oldestTs,
      since: oldestTs - 7 * 24 * 60 * 60,
      limit: 100,
    }, {
      onevent(event) {
        receivedCount++;
        eventStore.add(event);
      },
      oneose() {
        videoKindsSub.close();
        checkComplete();
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
    for (const entry of allVideoEntries) {
      if (seen.has(entry.event.id)) continue;
      seen.add(entry.event.id);
      ids.push(entry.event.id);
      if (ids.length >= 250) break;
    }
    if (ids.length > 0) prefetchStatsImmediate(ids);
  }, [allVideoEntries, sortMode]);

  const scrollToIndex = useCallback((index: number) => {
    const container = shortsContainerRef.current;
    if (!container) return;
    const slides = container.querySelectorAll(".shorts-slide");
    if (slides[index]) {
      slides[index].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    const container = shortsContainerRef.current;
    if (!container || !isMobile) return;

    const handleScroll = () => {
      const slides = container.querySelectorAll(".shorts-slide");
      const containerRect = container.getBoundingClientRect();
      let closest = 0;
      let closestDist = Infinity;
      slides.forEach((slide, i) => {
        const rect = slide.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerRect.top);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      setActiveIndex(closest);

      if (closest >= displayedEntries.length - 3) {
        loadMore();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [isMobile, displayedEntries.length, loadMore]);

  if (isMobile && shortsMode) {
    if (isInitialLoading && displayedEntries.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-[80vh]" data-testid="container-loading">
          <RelayOutpostLoader size="lg" label="Scanning relays for videos..." />
        </div>
      );
    }

    if (displayedEntries.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-[80vh]" data-testid="container-empty">
          <p className="text-sm text-muted-foreground">No videos found</p>
        </div>
      );
    }

    // Portal to <body>: the app's <main> is `relative z-0` AND transformed, so
    // a fixed full-bleed overlay rendered inside it is (a) trapped below the
    // z-50 header and (b) positioned against <main>'s box instead of the
    // viewport (the documented z-0 <main> chrome trap — same escape as the
    // mobile DM thread overlay).
    return createPortal(
        <div className="shorts-container" ref={shortsContainerRef} data-testid="container-shorts">
          {displayedEntries.map((entry, i) => {
            // Mount the heavy video elements for the previous slide and the next
            // two upcoming ones (active-1 .. active+2). Pre-mounting the next two
            // makes swiping instant; off-window slides keep a same-height
            // .shorts-slide placeholder so snap scrolling and active-index
            // tracking stay correct.
            const offset = i - activeIndex;
            const mounted = offset >= -1 && offset <= 2;
            // Prefetch the next 1–2 videos (active+1, active+2) with preload=auto
            // so they're buffered before the user reaches them.
            const shouldPreload = offset === 1 || offset === 2;
            return mounted ? (
              <ShortsCard
                key={`${entry.event.id}-${i}`}
                event={entry.event}
                videoUrl={entry.videoUrl}
                isActive={i === activeIndex}
                isMuted={isMuted}
                shouldPreload={shouldPreload}
                disableAutoplay={saveData}
                onToggleMute={toggleMute}
              />
            ) : (
              <div key={`ph-${entry.event.id}-${i}`} className="shorts-slide" aria-hidden="true" />
            );
          })}
          {/* Full-bleed overlay chrome. These are `fixed` (not absolute): the
              container scrolls, so absolutely-positioned children would ride
              off-screen with the first slide. All top offsets pad with
              safe-area-inset-top since video now runs under the status bar. */}
          <div
            className="fixed left-0 right-0 top-0 z-30 pointer-events-none bg-gradient-to-b from-black/50 to-transparent"
            style={{ height: "calc(env(safe-area-inset-top, 0px) + 4rem)" }}
            aria-hidden="true"
          />
          <button
            onClick={() => setShortsMode(false)}
            className="fixed left-3 z-30 w-11 h-11 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center text-white active-elevate-2"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.625rem)" }}
            aria-label="Close video viewer"
            title="Grid view"
            data-testid="button-shorts-to-grid"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="fixed right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2">
            <button
              onClick={() => scrollToIndex(Math.max(0, activeIndex - 1))}
              className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/70"
              style={{ visibility: activeIndex > 0 ? "visible" : "hidden" }}
              data-testid="button-shorts-prev"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => scrollToIndex(Math.min(displayedEntries.length - 1, activeIndex + 1))}
              className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/70"
              style={{ visibility: activeIndex < displayedEntries.length - 1 ? "visible" : "hidden" }}
              data-testid="button-shorts-next"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          {/* No position counter ("5 / 20"): users shouldn't see how deep or
              how finite the reel is — endless-feel over odometer. */}
        </div>,
      document.body,
    );
  }

  return (
    <div className={embedded ? "" : "px-3 sm:px-4 py-4 sm:py-6"} data-testid="page-video-feed">
      {/* New-arrival affordance: the top-center pill (was the rocket FAB's
          notification dot — merged into one adaptive control). */}
      <NewPostsPill count={bufferedCount} onClick={revealBufferedAtTop} />
      <div className={embedded ? "" : "max-w-4xl mx-auto"}>
        {/* ONE control row: title (standalone only) · sort · view controls. */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {!embedded && <Video className="w-5 h-5 text-brand/70" />}
          {!embedded && <h1 className="text-lg font-semibold text-foreground" data-testid="text-page-title">Videos</h1>}
          {sort === undefined && <MediaSortBar value={sortMode} onChange={setSortMode} compact />}
          <div className="ml-auto flex items-center gap-1">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShortsMode(true)}
                title="Shorts view"
                data-testid="button-grid-to-shorts"
              >
                <Video className="w-4 h-4" />
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
            <RelayOutpostLoader size="lg" label="Scanning relays for videos..." />
          </div>
        ) : displayedEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20" data-testid="container-empty">
            <p className="text-sm text-muted-foreground">No videos found in recent posts</p>
          </div>
        ) : viewMode === "list" ? (
          <>
            <div className="space-y-1.5" data-testid="container-video-list">
              {displayedEntries.map((entry, i) => (
                <VideoListItem
                  key={`${entry.event.id}-${i}`}
                  event={entry.event}
                  videoUrl={entry.videoUrl}
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
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3"
              data-testid="container-video-grid"
            >
              {displayedEntries.map((entry, i) => (
                <VideoCard
                  key={`${entry.event.id}-${i}`}
                  event={entry.event}
                  videoUrl={entry.videoUrl}
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
