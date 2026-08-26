import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { use$ } from "applesauce-react/hooks";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";
import { Play, Pause, Volume2, VolumeX, ImageIcon, Video as VideoIcon, X, ChevronUp, ChevronDown } from "lucide-react";
import { useLocation } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { eventStore } from "@/lib/nostr";
import { getEventMediaInfo, extractMediaFromContent, parseImetaTags, classifyUrl, isEmbedType } from "@/lib/media-utils";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub, getOptimizedImageUrl } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";

// MediaGridGallery — the Photos/Video view for saved custom feeds.
//
// When the All|Photos|Video style chip on a saved feed is set to a media
// style, Home renders this Instagram-Explore-style mosaic INSTEAD of the
// normal post cards: zero text, zero hashtags, zero post chrome — just
// uniform square media tiles. Tapping a tile opens the swipeable pager
// viewer (below) at that item, over the gallery's full media list.
//
// It consumes the already-filtered + already-sorted `displayedEvents` slice
// from Home (spam/mute/trust filtering, the feed's sort mode, and the
// infinite-scroll paging all still apply — the sentinel stays in Home).
// One post can yield multiple media URLs; each becomes its own tile.

export interface MediaGridItem {
  event: Event;
  url: string;
}

function getThreadUrl(eventId: string): string {
  try {
    return `/thread/${nip19.noteEncode(eventId)}`;
  } catch {
    return `/thread/${eventId}`;
  }
}

function getProfileUrl(pubkey: string): string {
  try {
    return `/profile/${nip19.npubEncode(pubkey)}`;
  } catch {
    return "#";
  }
}

/** imeta/thumb-tag poster for a video URL (same lookup VideoFeed uses). */
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

/** Author display info for the viewer's bottom bar. */
function useAuthorInfo(event: Event) {
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
  return { avatarUrl, displayName, timeAgo };
}

// ---------------------------------------------------------------------------
// Grid tiles
// ---------------------------------------------------------------------------

// Shared tile shell: square (no layout shift), same corner/border/backdrop
// tokens as ImagesFeed's grid cards, ≥44px tap target by nature.
const TILE_CLASS =
  "relative aspect-square overflow-hidden rounded-xl border border-border/40 bg-muted/30 cursor-pointer group focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function PhotoTile({ event, imageUrl, onOpen }: { event: Event; imageUrl: string; onOpen: () => void }) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Tile shows a ~400px rendition (wsrv.nl proxy w/ original fallback — the
  // same resizer avatars use); the viewer opens the full-size original.
  const tileSrc = useMemo(() => getOptimizedImageUrl(imageUrl, 400) ?? imageUrl, [imageUrl]);

  if (error) return null;

  return (
    <button
      type="button"
      className={TILE_CLASS}
      onClick={onOpen}
      aria-label="Open photo"
      data-testid={`media-tile-photo-${event.id}`}
    >
      <img
        src={tileSrc}
        alt=""
        className={`w-full h-full object-cover transition-opacity duration-300 sm:group-hover:scale-[1.03] sm:transition-[opacity,transform] ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        data-testid={`img-media-tile-${event.id}`}
      />
    </button>
  );
}

function VideoTile({ event, videoUrl, onOpen }: { event: Event; videoUrl: string; onOpen: () => void }) {
  const [error, setError] = useState(false);
  const poster = useMemo(() => getVideoPoster(event, videoUrl), [event, videoUrl]);

  if (error) return null;

  return (
    <button
      type="button"
      className={TILE_CLASS}
      onClick={onOpen}
      aria-label="Play video"
      data-testid={`media-tile-video-${event.id}`}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setError(true)}
        />
      ) : (
        // No poster advertised → let the browser paint the first frame.
        // preload="metadata" keeps it light; muted+playsInline avoids any
        // PWA/iOS autoplay weirdness (it never plays in the tile).
        <video
          src={videoUrl}
          className="w-full h-full object-cover"
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onError={() => setError(true)}
          data-testid={`video-media-tile-${event.id}`}
        />
      )}
      {/* Centered play glyph — same treatment as VideoFeed's thumbnails. */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center transition-transform duration-200 sm:group-hover:scale-105">
          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Swipeable pager viewer
// ---------------------------------------------------------------------------

function PagerVideoSlide({
  url,
  active }: {
  url: string;
  active: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  // Each slide owns its mute state and STARTS muted (iOS autoplay policy).
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);

  // Only the current slide plays; neighbors stay paused (they're mounted for
  // preload only). No `autoPlay` attribute — playback is owned here. Paging
  // away re-mutes: iOS only allows unmuted playback started inside a user
  // gesture, so a slide scrolled back into view must resume muted or its
  // play() would be rejected.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (active) {
      el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
      el.muted = true;
      setMuted(true);
    }
  }, [active]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  // Flip the element property SYNCHRONOUSLY inside the tap handler: routing
  // it through a deferred React effect lands outside iOS's user-activation
  // window, and WebKit can refuse/pause un-muting an autoplayed-muted video
  // that isn't tied to a gesture. State just mirrors the element for the icon.
  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
    if (!next && el.paused) el.play().catch(() => {});
  }, []);

  // Tap-to-unmute first (autoplay starts muted), then tap toggles play/pause —
  // mirrors the inline-video overlay behavior.
  const onVideoTap = useCallback(() => {
    if (muted) toggleMute();
    else togglePlay();
  }, [muted, toggleMute, togglePlay]);

  const seekTo = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = videoRef.current;
    const bar = progressRef.current;
    if (!el || !bar || !el.duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    el.currentTime = frac * el.duration;
  }, []);

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <video
        ref={videoRef}
        src={url}
        className="max-w-full max-h-full object-contain"
        playsInline
        loop
        muted={muted}
        preload={active ? "auto" : "metadata"}
        onClick={onVideoTap}
        data-testid="pager-video"
      />
      {/* Minimal custom controls (no native `controls` — see inline-video
          memory: the native attr drags in overlapping platform overlays).
          z-20 + safe-area offset keep the row ABOVE the z-10 bottom bar: on
          iPhone PWAs the bar's safe-area padding made its gradient tall
          enough to cover (and swallow taps on) these buttons. */}
      <div className="absolute inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 px-4 flex items-center gap-3 pointer-events-none">
        <button
          type="button"
          onClick={togglePlay}
          className="pointer-events-auto w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white shrink-0"
          aria-label={playing ? "Pause" : "Play"}
          data-testid="pager-video-playpause"
        >
          {playing ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
        </button>
        <div
          ref={progressRef}
          className="pointer-events-auto flex-1 h-6 flex items-center cursor-pointer"
          onClick={seekTo}
          data-testid="pager-video-progress"
        >
          <div className="w-full h-1 rounded-full bg-white/25 overflow-hidden">
            <div className="h-full bg-white/90 rounded-full" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          className="pointer-events-auto w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white shrink-0"
          aria-label={muted ? "Unmute" : "Mute"}
          data-testid="pager-video-mute"
        >
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}

function PagerBottomBar({ event, onNavigate }: { event: Event; onNavigate: (url: string) => void }) {
  const { avatarUrl, displayName, timeAgo } = useAuthorInfo(event);
  const caption = useMemo(() => {
    try {
      const { text } = extractMediaFromContent(event.content);
      return text.replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }, [event.content]);

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-10 px-3 sm:px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pointer-events-none"
      data-testid="pager-bottom-bar"
    >
      {/* The gradient itself must NOT eat taps (it stretches ~40px above the
          row and, with safe-area padding, over the video controls on phones);
          only the actual author/caption/View-post row is interactive. */}
      <div className="flex items-center gap-2.5 max-w-3xl mx-auto pointer-events-auto">
        {/* Plain buttons, not <Link>: navigation must REPLACE the viewer's
            synthetic history entry (see onNavigate) or the unmount cleanup's
            history.back() would cancel the route change. */}
        <button
          type="button"
          onClick={() => onNavigate(getProfileUrl(event.pubkey))}
          className="flex items-center gap-2 min-w-0 shrink-0 cursor-pointer"
          data-testid="pager-link-author"
        >
          <Avatar className="w-8 h-8 border border-white/20 shrink-0">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="text-[10px] bg-black/40 text-white">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-white/95 truncate max-w-[9rem] sm:max-w-[14rem] drop-shadow">{displayName}</span>
        </button>
        {caption ? (
          <button
            type="button"
            onClick={() => onNavigate(getThreadUrl(event.id))}
            className="text-xs text-white/70 truncate flex-1 min-w-0 drop-shadow text-left cursor-pointer"
            data-testid="pager-caption"
          >
            {caption}
          </button>
        ) : (
          <span className="flex-1 min-w-0 text-[11px] text-white/40">{timeAgo}</span>
        )}
        <button
          type="button"
          onClick={() => onNavigate(getThreadUrl(event.id))}
          className="shrink-0 text-xs font-medium text-white/90 hover:text-white px-2.5 py-2 rounded-full bg-white/10 backdrop-blur-sm whitespace-nowrap cursor-pointer"
          data-testid="pager-link-view-post"
        >
          View post &rarr;
        </button>
      </div>
    </div>
  );
}

export function MediaPagerViewer({
  items,
  mode,
  startIndex,
  onClose }: {
  items: MediaGridItem[];
  mode: "photos" | "video";
  startIndex: number;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(() => Math.min(startIndex, items.length - 1));
  const [, navigate] = useLocation();
  const goBack = useGoBack();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const navigatedAwayRef = useRef(false);

  // Jump to the tapped tile before first paint (no snap animation on open).
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (track) track.scrollTop = Math.min(startIndex, items.length - 1) * track.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock page scroll behind the viewer.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Browser/phone Back closes the viewer instead of leaving the page: push a
  // history entry on open; popstate → close. Closing via ✕/Escape consumes the
  // pushed entry via the shared back helper on unmount (there is always an entry
  // to pop here — we pushed one — so this resolves to a real history.back()).
  const closedViaPopRef = useRef(false);
  useEffect(() => {
    window.history.pushState({ mediaPager: true }, "");
    const onPop = () => {
      closedViaPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!closedViaPopRef.current && !navigatedAwayRef.current) goBack();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bottom-bar navigation REPLACES the viewer's synthetic history entry, so
  // "Back" from the profile/thread returns to the feed (not a ghost viewer
  // entry) and the unmount cleanup must not rewind the new route.
  const handleNavigate = useCallback((url: string) => {
    navigatedAwayRef.current = true;
    onCloseRef.current();
    navigate(url, { replace: true });
  }, [navigate]);

  // While a programmatic smooth scroll is in flight, onScroll's intermediate
  // positions would round back to the OLD index and flicker the counter/bar.
  // Time-boxed guard (not "until target reached"): if the animation gets
  // interrupted the sync recovers on its own instead of wedging.
  const pendingUntilRef = useRef(0);

  const scrollToIndex = useCallback((i: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.min(Math.max(i, 0), items.length - 1);
    // Optimistically commit the index — arrows/keyboard must not depend on
    // scroll events landing (smooth scrolling needs rendering frames; a
    // hidden/backgrounded page never fires them). onScroll still syncs swipes.
    pendingUntilRef.current = smooth ? Date.now() + 700 : 0;
    setCurrentIndex(clamped);
    track.scrollTo({ top: clamped * track.clientHeight, behavior: smooth ? "smooth" : "auto" });
  }, [items.length]);

  // Track which slide is snapped via scroll position (rAF-throttled).
  const rafRef = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const track = trackRef.current;
      if (!track || track.clientHeight === 0) return;
      if (Date.now() < pendingUntilRef.current) return; // programmatic scroll in flight
      const idx = Math.round(track.scrollTop / track.clientHeight);
      setCurrentIndex((prev) => (idx === prev ? prev : Math.min(Math.max(idx, 0), items.length - 1)));
    });
  }, [items.length]);
  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  // Keyboard: arrows page (Up/Down primary for the vertical pager, Left/Right
  // kept as aliases), Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); scrollToIndex(currentIndex + 1); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); scrollToIndex(currentIndex - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentIndex, scrollToIndex]);

  const current = items[Math.min(currentIndex, items.length - 1)];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      data-testid="media-pager-viewer"
    >
      {/* Vertical (TikTok/Reels-style) scroll-snap track: native momentum,
          PWA-friendly, no gesture lib. Each slide is one full viewport tall
          and snaps to the top; overscroll-contain stops the swipe from
          chaining into iOS pull-to-refresh / page rubber-banding. Only
          current ±1 slides mount their media — the rest are empty
          placeholders that keep scroll geometry for a long gallery. */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={() => { pendingUntilRef.current = 0; }}
        className="w-full h-full overflow-y-auto overflow-x-hidden snap-y snap-mandatory flex flex-col scrollbar-hide overscroll-contain"
        data-testid="pager-track"
      >
        {items.map((item, i) => {
          const near = Math.abs(i - currentIndex) <= 1;
          return (
            <div key={`${item.event.id}-${i}`} className="w-full h-full shrink-0 snap-start relative flex items-center justify-center">
              {near && (
                mode === "photos" ? (
                  <img
                    src={item.url}
                    alt=""
                    className="max-w-full max-h-full object-contain select-none"
                    draggable={false}
                    data-testid={`pager-image-${i}`}
                  />
                ) : (
                  <PagerVideoSlide url={item.url} active={i === currentIndex} />
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Counter — subtle, top-left. */}
      <div className="absolute top-3 left-3 z-10 px-2.5 py-1.5 rounded-full bg-black/40 backdrop-blur-sm text-[11px] font-medium text-white/80 tabular-nums pointer-events-none" data-testid="pager-counter">
        {Math.min(currentIndex + 1, items.length)} / {items.length}
      </div>

      {/* Close — 44px, top-right. */}
      <button
        type="button"
        onClick={() => onCloseRef.current()}
        className="absolute top-2 right-2 z-10 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white/90 hover:text-white"
        aria-label="Close viewer"
        data-testid="pager-close"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Desktop edge arrows (hover-polish only — swipe still works). Stacked
          on the right edge, Reels-style, to match the vertical direction. */}
      {currentIndex > 0 && (
        <button
          type="button"
          onClick={() => scrollToIndex(currentIndex - 1)}
          className="hidden sm:flex absolute right-3 top-1/2 -translate-y-[50px] z-10 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 items-center justify-center text-white/80 hover:text-white"
          aria-label="Previous"
          data-testid="pager-prev"
        >
          <ChevronUp className="w-6 h-6" />
        </button>
      )}
      {currentIndex < items.length - 1 && (
        <button
          type="button"
          onClick={() => scrollToIndex(currentIndex + 1)}
          className="hidden sm:flex absolute right-3 top-1/2 translate-y-1.5 z-10 w-11 h-11 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 items-center justify-center text-white/80 hover:text-white"
          aria-label="Next"
          data-testid="pager-next"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}

      {/* OG-post bar: author · caption snippet · View post. */}
      {current && <PagerBottomBar event={current.event} onNavigate={handleNavigate} />}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export function MediaGridGallery({ events, mode }: { events: Event[]; mode: "photos" | "video" }) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  // One tile per media URL. Events are already filtered (spam/mute/trust +
  // the feed-style regex) and sorted by Home — order is preserved here, and
  // the pager viewer consumes this exact same list.
  const tiles = useMemo(() => {
    const out: MediaGridItem[] = [];
    const seenUrls = new Set<string>();
    for (const event of events) {
      const info = getEventMediaInfo(event.content, event.tags);
      const urls = mode === "photos" ? info.imageUrls : info.videoUrls;
      for (const url of urls) {
        // Platform embeds (YouTube/Vimeo/Rumble) can't play in a <video>;
        // the feed-style pre-filter only passes direct files anyway.
        if (mode === "video" && isEmbedType(classifyUrl(url))) continue;
        if (seenUrls.has(url)) continue; // reposts/duplicates of the same asset
        seenUrls.add(url);
        out.push({ event, url });
      }
    }
    return out;
  }, [events, mode]);

  if (tiles.length === 0) {
    const Icon = mode === "photos" ? ImageIcon : VideoIcon;
    return (
      <div
        className="glass-card rounded-lg flex flex-col items-center justify-center py-12 sm:py-16 text-center px-4"
        data-testid="container-media-grid-empty"
      >
        <Icon className="w-8 h-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium mb-1">No {mode === "photos" ? "photos" : "videos"} yet</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Media from this feed will show up here as it streams in.
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5"
        data-testid="container-media-grid"
      >
        {tiles.map(({ event, url }, i) =>
          mode === "photos" ? (
            <PhotoTile key={`${event.id}-${url}-${i}`} event={event} imageUrl={url} onOpen={() => setViewerIndex(i)} />
          ) : (
            <VideoTile key={`${event.id}-${url}-${i}`} event={event} videoUrl={url} onOpen={() => setViewerIndex(i)} />
          )
        )}
      </div>

      {viewerIndex !== null && (
        <MediaPagerViewer
          items={tiles}
          mode={mode}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}
