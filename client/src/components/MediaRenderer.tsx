import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ExternalLink, Link2, Play, Pause, ChevronLeft, ChevronRight, X, Download, RotateCcw, RotateCw, ShieldAlert, Radio, Cast, MessageCircle, Maximize2, Volume2, VolumeX } from "lucide-react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { VideoLightbox } from "@/components/VideoLightbox";
import { WalledGardenFallback } from "@/components/WalledGardenFallback";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { usePiP } from "@/contexts/PiPContext";
import { usePersistentMedia } from "@/contexts/PersistentMediaContext";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "@/lib/nostr";
import { getAvatarUrl, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import {
  type MediaItem,
  type ImetaData,
  extractMediaFromContent,
  parseImetaTags,
  classifyUrl,
  getMediaTypeFromMime,
  extractZapStreamNaddr,
  shouldProxyImage,
  proxiedImageUrl,
  buildProxiedSrcSet,
  ipfsGatewayFallback,
  resolveEmbedId,
  isYouTubeShort,
  isEmbedType,
  isKnownVideoLink,
  type EmbedType,
} from "@/lib/media-utils";
import { normalizeNostrClientLinks } from "@/lib/nostr-client-links";
import { InlineEmbedPlayer } from "@/components/InlineEmbedPlayer";
import { GroupInviteCard } from "@/components/GroupInviteCard";
import { detectGroupInvite } from "@/lib/concord/invite-detect";
import { setActiveVideo, clearActiveVideo, isAutoplayMediaEnabled } from "@/lib/video-prefs";
import { autoplayDecision, readAutoplayEnvironment, AUTOPLAY_VISIBILITY_THRESHOLD } from "@/lib/autoplay-policy";
import { useAutoplayMediaSetting } from "@/lib/video-prefs";
import { MusicLinkCard } from "@/components/MusicLinkCard";
import { WavlakeInlinePlayer } from "@/components/WavlakeInlinePlayer";
import { InlineAudio } from "@/components/InlineAudio";
import { extractZapSplits } from "@/lib/music";
import type { ArtistCreditData } from "@/lib/artist-credit";
import { decode } from "blurhash";
import type HlsType from "hls.js";
import { supportsNativeHls } from "@/contexts/PiPContext";
import { needsProxy, proxyUrl, parseLiveEvent } from "@/lib/live-events";
import type { LiveEventData } from "@/lib/live-events";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { KIND_LIVE_EVENT } from "@/lib/nostr-helpers";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReservedRatio } from "@/hooks/use-reserved-ratio";
import {
  clampVideoRatio,
  COMPACT_MAX_HEIGHT,
  IMAGE_MAX_HEIGHT,
  UNKNOWN_PLACEHOLDER_HEIGHT,
  MEDIA_MOUNT_LEAD,
  VIDEO_MAX_HEIGHT,
  VIDEO_WIDEST_RATIO,
} from "@/lib/media-ratio";
import { getContentWarning, getSensitiveContentSetting, isCwRevealed, markCwRevealed } from "@/lib/sensitive-content";
import { useBlossomHeal } from "@/hooks/use-blossom-heal";

function SensitiveContentOverlay({
  reason,
  onReveal,
}: {
  reason: string;
  onReveal: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl overflow-hidden cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onReveal();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-2xl" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(139,92,246,0.3) 3px, rgba(139,92,246,0.3) 4px)",
        }}
      />
      <div className="relative flex flex-col items-center gap-3 px-6 py-4">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center border border-brand/30"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(139,92,246,0.25), rgba(30,10,60,0.9) 60%, rgba(5,2,15,0.95))",
          }}
        >
          <ShieldAlert className="w-5 h-5 text-brand/90" />
        </div>
        <div className="text-center">
          <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-brand/80 mb-1">
            Signal Flagged
          </p>
          <p className="text-[11px] text-white/60 max-w-[200px] leading-relaxed">
            {reason}
          </p>
        </div>
        <div className="mt-1 px-4 py-1.5 rounded-full border border-brand/25 bg-brand/10 backdrop-blur-sm">
          <span className="text-[10px] font-medium tracking-wider uppercase text-brand/90">
            Tap to Reveal
          </span>
        </div>
      </div>
    </div>
  );
}

const blurhashCache = new Map<string, string>();


function decodeBlurhashToDataUrl(blurhash: string, width = 32, height = 32): string | null {
  if (blurhashCache.has(blurhash)) return blurhashCache.get(blurhash)!;
  try {
    const pixels = decode(blurhash, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL();
    blurhashCache.set(blurhash, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}


// Mount media a bit BEFORE it scrolls into view — earlier and more consistently
// than the browser's native lazy threshold (which is conservative, especially on
// mobile) — so it's usually loaded by the time the user reaches it.
/**
 * Is this box within N screens of the viewport, tracked BOTH ways?
 *
 * The budget for live `<video>` elements. `useNearViewport` below is a one-way
 * latch — correct for "start loading early", useless for "release the decoder
 * once it is far away". At ~700px a row, the virtualizer's overscan of 6 would
 * otherwise keep ~4,200px of video decoding off screen, and a mid-range Android
 * will stutter — which the user experiences as the SCROLL being broken, not the
 * video.
 *
 * Starts false so the initial burst does not mount a player per row; the
 * observer resolves within a frame. If IntersectionObserver is missing there is
 * no budget to enforce, so it starts true instead of never mounting anything.
 */
function useWithinScreens(ref: React.RefObject<HTMLElement | null>, screens = 1) {
  const [within, setWithin] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setWithin(!!entry?.isIntersecting),
      { rootMargin: `${screens * 100}% 0px` },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, screens]);
  return within;
}

function useNearViewport(rootMargin = MEDIA_MOUNT_LEAD) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setNear(true); obs.disconnect(); }
    }, { rootMargin });
    obs.observe(el);
    return () => obs.disconnect();
  }, [near, rootMargin]);
  return [ref, near] as const;
}

function InlineImage({
  src,
  alt,
  dimensions,
  blurhash,
  sha256,
  fallbacks,
  compact = false,
  onOpenGallery,
  contentWarning,
  cwKey,
  priority = false,
  inGallery = false,
}: {
  src: string;
  alt?: string;
  dimensions?: { width: number; height: number };
  blurhash?: string;
  sha256?: string;
  fallbacks?: string[];
  compact?: boolean;
  onOpenGallery?: () => void;
  contentWarning?: string | null;
  cwKey?: string;
  priority?: boolean;
  inGallery?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [proxyFailed, setProxyFailed] = useState(false);
  // IPFS resilience: when the primary gateway 404s/errors, retry once on the
  // next gateway (null for non-IPFS srcs — ipfsGatewayFallback returns null).
  const [gatewayRetrySrc, setGatewayRetrySrc] = useState<string | null>(null);
  // Blossom resilience: after proxy → direct → IPFS all fail, walk the bounded
  // alternate list (imeta fallbacks, then other Blossom servers by sha256).
  const heal = useBlossomHeal(src, { sha256, fallbacks });
  const hasCW = !!contentWarning && getSensitiveContentSetting();
  const [cwRevealed, setCwRevealed] = useState(() => cwKey ? isCwRevealed(cwKey) : false);
  const [revealed, setRevealed] = useState(() => {
    if (hasCW && !cwRevealed) return false;
    try { return localStorage.getItem("imageLoading") !== "blur"; } catch { return true; }
  });

  const [containerRef, near] = useNearViewport();
  const shouldLoad = priority || inGallery || near;

  const effectiveSrc = heal.isAlternate ? heal.src : gatewayRetrySrc ?? src;
  // Alternates are always loaded direct: they're fresh single-shot candidates,
  // and routing them through the proxy would re-enter the proxy retry chain.
  const useProxy = !heal.isAlternate && !proxyFailed && shouldProxyImage(effectiveSrc);
  const widths = inGallery ? [320, 480, 640, 960] : [384, 640, 1080, 1920];
  const defaultWidth = inGallery ? 640 : 1080;
  const sizesAttr = inGallery
    ? "(max-width: 768px) 50vw, 320px"
    : "(max-width: 768px) 100vw, 600px";
  const imgSrc = useProxy ? proxiedImageUrl(effectiveSrc, defaultWidth) : effectiveSrc;
  const imgSrcSet = useProxy ? buildProxiedSrcSet(effectiveSrc, widths) : undefined;

  const blurhashUrl = useMemo(() => {
    if (!blurhash) return null;
    const w = dimensions ? Math.min(dimensions.width, 32) : 32;
    const h = dimensions ? Math.min(dimensions.height, 32) : 32;
    return decodeBlurhashToDataUrl(blurhash, w, h);
  }, [blurhash, dimensions]);

  const imetaRatio = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions.width / dimensions.height
    : null;
  const box = useReservedRatio(containerRef, effectiveSrc, imetaRatio);

  if (heal.exhausted) return <WalledGardenFallback type="image" compact className="my-1" />;

  // Reserved space (feed-stability): the container ALWAYS owns the box, so a
  // late-loading image can never change the row's height and the virtualizer's
  // first measurement is already the final one. That part was always right.
  //
  // What was wrong: when `dim` was missing it reserved 16/10 and filled with
  // `cover`, so every portrait photo got centre-cropped into a landscape box.
  // Real feed images range 0.462–2.215; a guess paired with `cover` is a crop.
  // The box is LEARNED now (see lib/media-ratio.ts) and only covers once it is
  // known to match; until then the image is contained over a blurred copy of
  // itself, which loses nothing.
  // Reserve ONLY when the shape is actually known. A guessed box is worse than
  // no box: it renders at the wrong height and, because a box on screen never
  // resizes, stays wrong for as long as you are looking at it. Unknown images
  // flow at their natural height — width 100%, height auto — which is right the
  // instant they decode.
  const reservedStyle: React.CSSProperties = box.known
    ? { aspectRatio: String(box.ratio), maxHeight: compact ? COMPACT_MAX_HEIGHT : IMAGE_MAX_HEIGHT }
    // A flowing image is height:auto, so before it decodes the container would
    // collapse to nothing and the post would look empty. A modest placeholder
    // height holds the space until the real height is known — small enough that
    // the settle is a nudge rather than the jump a full guessed box produces.
    : {
        maxHeight: compact ? COMPACT_MAX_HEIGHT : IMAGE_MAX_HEIGHT,
        ...(loaded ? {} : { minHeight: UNKNOWN_PLACEHOLDER_HEIGHT }),
      };

  const handleClick = (e: React.MouseEvent) => {
    if (hasCW && !cwRevealed) {
      return;
    }
    e.stopPropagation();
    if (!revealed) {
      e.preventDefault();
      setRevealed(true);
      return;
    }
    if (onOpenGallery) {
      onOpenGallery();
    } else {
      setFullscreen(true);
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        // Radius is a token the FRAME sets, not a constant the media owns. An
        // inset image is a rounded card; a full-bleed one spans the post and
        // has to square off, because a rounded rectangle at full width still
        // reads as "image inside a box" — the exact language full-bleed exists
        // to leave. Default keeps today's rounded-xl for every other caller.
        className={`relative rounded-[var(--media-radius,0.75rem)] overflow-hidden bg-muted/30 ${inGallery ? "w-full h-full cursor-pointer" : "w-full"}`}
        style={inGallery ? undefined : reservedStyle}
        onClick={inGallery ? handleClick : undefined}
        data-testid="media-inline-image"
      >
        {blurhashUrl && !loaded && (
          <img
            src={blurhashUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            aria-hidden="true"
          />
        )}
        {/* No blurred filler any more. It existed to disguise the gap a guessed
            box left, and there is no guessed box — an unknown image is simply
            its own size. */}
        {shouldLoad && (
          <img
            src={imgSrc}
            srcSet={imgSrcSet}
            sizes={imgSrcSet ? sizesAttr : undefined}
            alt={alt || "User-shared image"}
            className={`${
              inGallery
                ? "w-full h-full object-cover"
                : box.known
                  ? "absolute inset-0 w-full h-full object-cover cursor-zoom-in"
                  : "block w-full h-auto cursor-zoom-in"
            } rounded-[var(--media-radius,0.75rem)] transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${loaded && !revealed ? "blur-xl" : ""}`}
            // Top-anchored only matters when the height cap clips a known-tall
            // image: a centre crop would remove the beginning AND the end,
            // ruinous for the screenshots and memes most tall images are.
            style={inGallery || !box.known ? undefined : { objectPosition: "top" }}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            {...(priority ? { fetchpriority: "high" } : {})}
            onClick={inGallery ? undefined : handleClick}
            onLoad={(e) => {
              setLoaded(true);
              // The shape, learned from the element that was loading anyway.
              box.learn(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
            }}
            onError={() => {
              if (useProxy) {
                setProxyFailed(true);
                return;
              }
              if (!heal.isAlternate) {
                // Direct load failed — for IPFS gateway URLs, retry once on the
                // fallback gateway (fresh proxy attempt) before giving up.
                const fallback = gatewayRetrySrc ? null : ipfsGatewayFallback(effectiveSrc);
                if (fallback) {
                  setGatewayRetrySrc(fallback);
                  setProxyFailed(false);
                  return;
                }
              }
              // Proxy, direct and IPFS all failed — try the next Blossom
              // alternate (bounded; dead URLs are session-cached). When none
              // remain, `heal.exhausted` flips and the terminal fallback shows.
              heal.advance();
            }}
          />
        )}
        {hasCW && !cwRevealed && loaded && (
          <SensitiveContentOverlay
            reason={contentWarning!}
            onReveal={() => {
              setCwRevealed(true);
              setRevealed(true);
              if (cwKey) markCwRevealed(cwKey);
            }}
          />
        )}
        {loaded && !revealed && !hasCW && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl overflow-hidden cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-brand/20 to-black/40 dark:from-black/40 dark:via-brand/30 dark:to-black/50 backdrop-blur-md" />
            <div
              className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(139,92,246,0.3) 3px, rgba(139,92,246,0.3) 4px)",
              }}
            />
            <div className="relative flex flex-col items-center gap-2 sm:gap-3 group/reveal">
              <div className="relative flex items-center justify-center">
                <div className="absolute w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-full border border-brand/[0.08]/[0.12] group-hover/reveal:border-brand/20 transition-colors" />
                <div
                  className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full border border-brand/15 dark:border-brand/20 flex items-center justify-center shadow-[0_0_15px_rgba(88,28,135,0.2)] dark:shadow-[0_0_15px_rgba(88,28,135,0.3)] group-hover/reveal:shadow-[0_0_25px_rgba(88,28,135,0.4)] dark:group-hover/reveal:shadow-[0_0_25px_rgba(88,28,135,0.5)] group-hover/reveal:scale-105 transition-all overflow-hidden"
                  style={{ background: "radial-gradient(circle at 30% 30%, rgba(99,102,241,0.25), rgba(30,10,60,0.95) 60%, rgba(5,2,15,0.98))" }}
                >
                  <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(1px 1px at 20% 30%, rgba(167,139,250,0.7), transparent), radial-gradient(1px 1px at 70% 20%, rgba(129,140,248,0.5), transparent), radial-gradient(1px 1px at 45% 70%, rgba(192,132,252,0.6), transparent), radial-gradient(0.5px 0.5px at 80% 60%, rgba(167,139,250,0.4), transparent), radial-gradient(0.5px 0.5px at 15% 80%, rgba(129,140,248,0.3), transparent), radial-gradient(1px 1px at 60% 45%, rgba(139,92,246,0.5), transparent)" }} />
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-6 h-6 sm:w-7 sm:h-7 relative z-10 opacity-90 group-hover/reveal:opacity-100 transition-opacity drop-shadow-[0_0_3px_rgba(255,255,255,0.3)]">
                    <g clipPath="url(#clip0_reveal)">
                      <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" />
                      <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" />
                    </g>
                    <defs>
                      <clipPath id="clip0_reveal">
                        <rect width="24" height="24" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </div>
              </div>
              <span className="text-[10px] sm:text-[11px] font-medium tracking-[0.15em] uppercase text-white/70 dark:text-brand/60">
                Tap to Reveal
              </span>
            </div>
          </div>
        )}
        {!loaded && !blurhashUrl && (
          <div className="absolute inset-0 feed-skeleton-shimmer" aria-hidden="true" />
        )}
      </div>
      {fullscreen && (
        <ImageLightbox
          images={[{ src: effectiveSrc, alt }]}
          startIndex={0}
          onClose={() => setFullscreen(false)}
        />
      )}
    </>
  );
}

function ImageGallery({
  images,
  compact = false,
  contentWarning,
  cwKey,
  priority = false,
}: {
  images: Array<{ src: string; alt?: string; dimensions?: { width: number; height: number }; blurhash?: string; sha256?: string; fallbacks?: string[] }>;
  compact?: boolean;
  contentWarning?: string | null;
  cwKey?: string;
  priority?: boolean;
}) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  if (images.length === 1) {
    return <InlineImage src={images[0].src} alt={images[0].alt} dimensions={images[0].dimensions} blurhash={images[0].blurhash} sha256={images[0].sha256} fallbacks={images[0].fallbacks} compact={compact} contentWarning={contentWarning} cwKey={cwKey} priority={priority} />;
  }

  return (
    <>
      <div
        className={`grid gap-1.5 rounded-xl overflow-hidden ${
          images.length === 2
            ? "grid-cols-2"
            : images.length === 3
            ? "grid-cols-2"
            : "grid-cols-2"
        }`}
        data-testid="media-image-gallery"
      >
        {images.slice(0, 4).map((img, i) => (
          <div key={i} className={`relative overflow-hidden ${images.length === 3 && i === 0 ? "row-span-2 h-full" : "aspect-square"}`}>
            <InlineImage
              src={img.src}
              alt={img.alt}
              dimensions={img.dimensions}
              blurhash={img.blurhash}
              sha256={img.sha256}
              fallbacks={img.fallbacks}
              compact
              onOpenGallery={() => setGalleryIndex(i)}
              contentWarning={contentWarning}
              cwKey={cwKey}
              priority={priority && i === 0}
              inGallery
            />
          </div>
        ))}
      </div>
      {galleryIndex !== null && (
        <ImageLightbox
          images={images.map((img) => ({ src: img.src, alt: img.alt }))}
          startIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
        />
      )}
    </>
  );
}

function InlineVideo({
  src,
  poster,
  dimensions,
  sha256,
  fallbacks,
  compact = false,
  contentWarning,
  cwKey,
  authorInfo,
  authorPubkey,
}: {
  src: string;
  poster?: string;
  dimensions?: { width: number; height: number };
  sha256?: string;
  fallbacks?: string[];
  compact?: boolean;
  contentWarning?: string | null;
  cwKey?: string;
  authorInfo?: { avatarUrl?: string; displayName: string; timestamp?: string; postUrl?: string };
  authorPubkey?: string;
}) {
  const [error, setError] = useState(false);
  // Blossom resilience for direct files (HLS streams are live — not blob-addressed).
  const heal = useBlossomHeal(src, { sha256, fallbacks });
  const [manualPlay, setManualPlay] = useState(false);
  const [muted, setMuted] = useState(true);
  const [theaterOpen, setTheaterOpen] = useState(false);
  const hasCW = !!contentWarning && getSensitiveContentSetting();
  const [cwRevealed, setCwRevealed] = useState(() => cwKey ? isCwRevealed(cwKey) : false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  // Reserved space (feed-stability): the wrapper owns the box so the <video>
  // resizing itself when metadata arrives can never change the row's height
  // mid-read. The box is LEARNED rather than guessed (lib/media-ratio.ts) —
  // the 16:9 default is exactly what pillarboxed every portrait clip whose
  // publisher omitted `dim`, which is a large share of them.
  const imetaRatio = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions.width / dimensions.height
    : null;
  const box = useReservedRatio(videoBoxRef, src, imetaRatio, VIDEO_WIDEST_RATIO);
  // The decoder budget: a real <video> only exists within a screen of the
  // viewport. Everything further away is a poster in the same reserved box.
  const videoLive = useWithinScreens(videoBoxRef, 1);
  const reservedVideoStyle: React.CSSProperties = {
    aspectRatio: `${clampVideoRatio(box.ratio)}`,
    maxHeight: compact ? COMPACT_MAX_HEIGHT : VIDEO_MAX_HEIGHT,
  };
  const { isPiP, pipVideoSrc, notifyUnmount } = usePiP();
  const { handoffVideo, claimVideo } = usePersistentMedia();
  const isHls = src.includes(".m3u8");
  const hlsRef = useRef<HlsType | null>(null);
  const wasPlayingRef = useRef(false);
  const setMutedSafely = useCallback((el: HTMLVideoElement, m: boolean) => {
    if (el.muted !== m) el.muted = m;
  }, []);
  // X-style: a dedicated speaker toggle so sound is always one tap away and never
  // buried behind the native controls. (Scrolling away re-mutes via the observer.)
  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    setMutedSafely(el, next);
    setMuted(next);
    if (!next) el.play().catch(() => {});
  }, [setMutedSafely]);
  const { getLiveStream } = useLiveStatus();

  const liveStreamLink = useMemo(() => {
    if (!isHls) return null;
    if (authorPubkey) {
      const stream = getLiveStream(authorPubkey);
      if (stream) {
        const naddr = nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT });
        return `/live/${naddr}`;
      }
    }
    return "/live";
  }, [isHls, authorPubkey, getLiveStream]);
  const claimedRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const theaterTransitionRef = useRef(false);
  const isMobile = useIsMobile();
  const [initialMobileGuess] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.matchMedia("(max-width: 767px)").matches; } catch { return false; }
  });
  const [hookResolved, setHookResolved] = useState(false);
  useEffect(() => { setHookResolved(true); }, []);
  const treatAsMobile = hookResolved ? isMobile : initialMobileGuess;
  const [mobileControlsVisible, setMobileControlsVisible] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const didMoveRef = useRef(false);
  const mobileControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (mobileControlsTimerRef.current) clearTimeout(mobileControlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!treatAsMobile && mobileControlsVisible) setMobileControlsVisible(false);
  }, [treatAsMobile, mobileControlsVisible]);

  const effectiveSrc = useMemo(() => {
    if (!isHls && heal.isAlternate) return heal.src;
    if (isHls && needsProxy(src)) return proxyUrl(src);
    return src;
  }, [src, isHls, heal.isAlternate, heal.src]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!isHls) {
      el.src = effectiveSrc;
      return;
    }
    if (supportsNativeHls) {
      el.src = effectiveSrc;
      return;
    }
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !el) return;
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 10,
          maxMaxBufferLength: 30,
        });
        hlsRef.current = hls;
        hls.loadSource(effectiveSrc);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
          if (data.fatal) {
            setError(true);
            hls.destroy();
            hlsRef.current = null;
          }
        });
      } else {
        el.src = effectiveSrc;
      }
    }).catch(() => {
      if (!cancelled && el) el.src = effectiveSrc;
    });
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    // `videoLive` — the same rule the observer below is commented for, and the
    // one this effect was missing. The <video> mounts LATE (decoder budget), so
    // on first render videoRef.current is null, this bails, and without the dep
    // it never runs again. The element then exists with NO src at all: a black
    // box that plays nothing, while the mute and expand controls render happily
    // because they only ask whether autoplay is permitted. Every effect in this
    // component that reads videoRef needs this dep — no exceptions.
  }, [effectiveSrc, isHls, videoLive]);

  useEffect(() => {
    // Same late-mount rule: a handoff from the theater/PiP arrives before the
    // element does, so claiming it against a null ref silently dropped the
    // resume position.
    if (!videoLive) return;
    if (claimedRef.current) return;
    claimedRef.current = true;
    const handoff = claimVideo(src);
    if (handoff && videoRef.current) {
      videoRef.current.currentTime = handoff.currentTime;
      videoRef.current.muted = handoff.muted;
      setManualPlay(true);
      videoRef.current.play().catch(() => {});
    }
  }, [src, claimVideo, videoLive]);

  // Every reason a video may not start, decided in one place. The verdict is
  // kept (not just the boolean) so a "why isn't this playing" report has an
  // answer sitting on the element instead of requiring a bisect.
  // The SETTING is a dependency. It was read inside the memo and left out of
  // the deps, so the verdict froze at mount: turning "Auto-play videos" on in
  // Settings changed nothing for any post already rendered, and in a thread —
  // where rows mount once and stay — that is every post you are looking at.
  const autoplaySetting = useAutoplayMediaSetting();
  const autoplayVerdict = useMemo(
    () => autoplayDecision(readAutoplayEnvironment({
      settingEnabled: autoplaySetting,
      contentWarning: hasCW && !cwRevealed,
    })),
    [autoplaySetting, hasCW, cwRevealed],
  );
  const autoplayEnabled = autoplayVerdict === "allow";

  useEffect(() => {
    const el = videoRef.current;
    if (!el || error) return;
    if (!autoplayEnabled && !manualPlay) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (theaterTransitionRef.current) return;
        if (entry.isIntersecting) {
          if (!(isPiP && pipVideoSrc === src)) {
            // Feed autoplay is ALWAYS muted (X / Instagram style). Sound is
            // opt-in per video via the controls and never carries to the next
            // video as you scroll past it. Starting muted also means browsers
            // never block the autoplay.
            setMutedSafely(el, true);
            setMuted(true);
            el.play().catch(() => {});
          }
        } else {
          el.pause();
        }
      },
      // Well past a sliver: a video that starts while a corner shows has
      // already spent the bandwidth by the time it is scrolled past.
      { threshold: AUTOPLAY_VISIBILITY_THRESHOLD }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // `videoLive` is load-bearing in these deps, not decoration. The element
    // now MOUNTS LATE — it does not exist until the budget lets it in — so an
    // effect that grabs videoRef.current and bails on null would bail once, at
    // first render, and never attach an observer at all. The video would sit
    // fully on screen, muted and correct in every other way, and simply never
    // start. Any effect here that reads videoRef must re-run on this.
  }, [error, isPiP, pipVideoSrc, src, autoplayEnabled, manualPlay, setMutedSafely, videoLive]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // One video at a time: starting playback pauses whatever was playing before.
    const onPlay = () => { wasPlayingRef.current = true; setActiveVideo(el); };
    const onPause = () => { wasPlayingRef.current = false; };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      clearActiveVideo(el);
    };
    // Same reason as the observer above: the element mounts late, so an empty
    // dep array would bind these listeners to nothing and "one video at a time"
    // would quietly stop being enforced.
  }, [videoLive]);

  useEffect(() => {
    const videoSrc = src;
    const el = videoRef.current;
    return () => {
      if (wasPlayingRef.current && el && !el.paused) {
        handoffVideo(videoSrc, el.currentTime, el.muted);
      }
      notifyUnmount(videoSrc);
    };
  }, [src, notifyUnmount, handoffVideo]);

  const theaterAutoplayRef = useRef(true);

  // Inline play state drives the custom (native-controls-free) play/pause button.
  const [isPlaying, setIsPlaying] = useState(false);
  const togglePlayInline = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { setManualPlay(true); el.play().catch(() => {}); }
    else { el.pause(); }
    // Keep controls up for a beat after interacting (mobile auto-hide).
    if (treatAsMobile) {
      setMobileControlsVisible(true);
      if (mobileControlsTimerRef.current) clearTimeout(mobileControlsTimerRef.current);
      mobileControlsTimerRef.current = setTimeout(() => { setMobileControlsVisible(false); mobileControlsTimerRef.current = null; }, 3000);
    }
  }, [treatAsMobile]);

  const openTheater = useCallback(() => {
    theaterTransitionRef.current = true;
    const el = videoRef.current;
    if (el) {
      theaterAutoplayRef.current = !el.paused;
      handoffVideo(src, el.currentTime, el.muted);
      el.pause();
    }
    setTheaterOpen(true);
  }, [src, handoffVideo]);

  const handleVideoDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openTheater();
  }, [openTheater]);

  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    if (hasCW && !cwRevealed) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    didMoveRef.current = false;
  }, [hasCW, cwRevealed]);

  const handleVideoTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      didMoveRef.current = true;
    }
  }, []);

  const handleVideoTouchEnd = useCallback((e: React.TouchEvent) => {
    if (hasCW && !cwRevealed) {
      touchStartRef.current = null;
      return;
    }
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const moved = didMoveRef.current;
    didMoveRef.current = false;

    if (!start || moved) {
      // Treated as a scroll, not a tap. Do nothing.
      return;
    }
    const elapsed = Date.now() - start.time;
    if (elapsed >= 300) {
      // Long press, not a tap.
      return;
    }

    const now = Date.now();
    if (now - lastTapTimeRef.current < 300) {
      e.preventDefault();
      lastTapTimeRef.current = 0;
      if (mobileControlsTimerRef.current) {
        clearTimeout(mobileControlsTimerRef.current);
        mobileControlsTimerRef.current = null;
      }
      setMobileControlsVisible(false);
      openTheater();
      return;
    }
    lastTapTimeRef.current = now;

    if (treatAsMobile) {
      setMobileControlsVisible((v) => {
        const next = !v;
        if (mobileControlsTimerRef.current) {
          clearTimeout(mobileControlsTimerRef.current);
          mobileControlsTimerRef.current = null;
        }
        if (next) {
          mobileControlsTimerRef.current = setTimeout(() => {
            setMobileControlsVisible(false);
            mobileControlsTimerRef.current = null;
          }, 3000);
        }
        return next;
      });
    }
  }, [openTheater, hasCW, cwRevealed, treatAsMobile]);

  const handleTheaterClose = useCallback((finalTime: number, wasMuted: boolean, wasPlaying: boolean) => {
    setTheaterOpen(false);
    const el = videoRef.current;
    if (el) {
      el.currentTime = finalTime;
      el.muted = wasMuted;
      if (wasPlaying) {
        setManualPlay(true);
        el.play().catch(() => {});
      }
    }
    setTimeout(() => { theaterTransitionRef.current = false; }, 500);
  }, []);

  if (error || heal.exhausted) {
    return <WalledGardenFallback type="video" url={src} />;
  }

  return (
    // `relative` is load-bearing, not tidiness. This frame owns the
    // overflow-hidden that clips to the rounded corners, but it had no
    // positioning context — so the absolutely-positioned controls anchored to
    // whichever inner box happened to be positioned instead. That box is sized
    // by aspectRatio AND capped by maxHeight, so the two stop agreeing the
    // moment the cap binds, and a control inset from one gets sliced by the
    // other. Reported from a phone: the volume button cut in half at the right
    // edge of a video. Anchoring to the frame that does the clipping is the
    // only arrangement where "inset from the edge" and "the edge" are the same
    // edge.
    <div
      className="relative rounded-[var(--media-radius,0.75rem)] overflow-hidden bg-black group/video"
      data-testid="media-inline-video"
      // The comment above autoplayVerdict says the verdict is kept so a "why
      // isn't this playing" report has an answer sitting on the element rather
      // than needing a bisect. It was never actually put on the element — the
      // value existed only to become a boolean. Now it IS here: inspect any
      // video and read reduced-motion / content-warning / save-data /
      // slow-connection / low-end-device / off / allow straight off the node.
      data-autoplay={autoplayVerdict}
      onClick={(e) => e.stopPropagation()}
    >
      {isHls && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-950/95 border-b border-white/5">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600/90 text-white text-[10px] font-semibold uppercase tracking-wide">
            <Radio className="w-2.5 h-2.5 animate-pulse" />
            LIVE
          </div>
          {liveStreamLink && (
            <Link
              href={liveStreamLink}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand/90 hover:bg-brand/90 text-white text-[10px] font-semibold transition-colors"
            >
              <MessageCircle className="w-2.5 h-2.5" />
              {liveStreamLink === "/live" ? "Live Streams" : "Join Live"}
            </Link>
          )}
        </div>
      )}
      <div ref={videoBoxRef} className="relative w-full mx-auto" style={reservedVideoStyle}>
        {/* Beyond a screen away this is a poster in the same reserved box, not
            a decoder. The box is already the right shape (the ratio is learned
            and cached), so swapping back to a real player when you approach
            costs no layout change — only the poster showing for a beat on a
            very fast scroll. Jank is felt continuously; a 200ms poster is felt
            once. */}
        {!videoLive && (
          poster
            ? <img src={poster} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-contain" />
            : <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
        )}
        {videoLive && (
        <video
          ref={videoRef}
          poster={poster}
          className={`absolute inset-0 w-full h-full object-contain ${hasCW && !cwRevealed ? "blur-xl scale-105" : ""}`}
          muted={muted}
          loop={!isHls}
          playsInline
          preload="metadata"
          // The clip's real shape, from the metadata we were already fetching.
          // Media mounts 1500px early, so this lands well off-screen and the
          // box has settled long before anyone sees it.
          onLoadedMetadata={(e) => box.learn(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          onError={() => {
            // Dead file: walk the bounded Blossom alternates before giving up.
            // HLS keeps its own fatal-error path (live streams don't heal by hash).
            if (isHls || !heal.advance()) setError(true);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onDoubleClick={(!hasCW || cwRevealed) ? handleVideoDoubleClick : undefined}
          onTouchStart={handleVideoTouchStart}
          onTouchMove={handleVideoTouchMove}
          onTouchEnd={handleVideoTouchEnd}
        />
        )}
      {/* Mute — the one affordance kept visible on idle (X-style muted autoplay). */}
      {(!hasCW || cwRevealed) && (autoplayEnabled || manualPlay) && (
        <button
          onClick={toggleMute}
          className="absolute bottom-3 right-3 z-20 p-2 rounded-full bg-black/55 text-white/90 backdrop-blur-sm hover:bg-black/75 transition-colors"
          aria-label={muted ? "Unmute video" : "Mute video"}
          title={muted ? "Unmute" : "Mute"}
          data-testid="button-video-mute"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      )}
      {/* Expand — revealed only on tap (mobile) / hover (desktop); no native fullscreen behind it now. */}
      {(!hasCW || cwRevealed) && (autoplayEnabled || manualPlay) && (
        <button
          onClick={(e) => { e.stopPropagation(); openTheater(); }}
          className={`absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/50 text-white/90 backdrop-blur-sm hover:bg-black/70 transition-opacity ${treatAsMobile ? (mobileControlsVisible ? "opacity-100" : "opacity-0 pointer-events-none") : "opacity-0 pointer-events-none sm:group-hover/video:opacity-100 sm:group-hover/video:pointer-events-auto"}`}
          aria-label="Expand video"
          title="Expand"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
      {/* Center play/pause — revealed only on tap/hover; kept small so taps around it still toggle controls / double-tap to expand. */}
      {(!hasCW || cwRevealed) && (autoplayEnabled || manualPlay) && (
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${treatAsMobile ? (mobileControlsVisible ? "opacity-100" : "opacity-0") : "opacity-0 sm:group-hover/video:opacity-100"}`}>
          <button
            onClick={togglePlayInline}
            className="pointer-events-auto p-3 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause" : "Play"}
            data-testid="button-video-playpause"
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
          </button>
        </div>
      )}
      {hasCW && !cwRevealed && (
        <SensitiveContentOverlay
          reason={contentWarning!}
          onReveal={() => {
            setCwRevealed(true);
            if (cwKey) markCwRevealed(cwKey);
          }}
        />
      )}
      {(!hasCW || cwRevealed) && !autoplayEnabled && !manualPlay && (
        <button
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            const el = videoRef.current;
            setManualPlay(true);
            // WITH SOUND. Muted-by-default is the rule for AUTOplay — a video
            // that starts on its own must not make noise. This button is the
            // opposite: someone deliberately asked for this one video, and a
            // user gesture is exactly the thing browsers require before audio
            // is allowed. Starting it silent meant tapping play, hearing
            // nothing, and hunting for a second control to get the sound.
            if (el) {
              setMutedSafely(el, false);
              setMuted(false);
              el.play().catch(() => {
                // Some engines still refuse; fall back to muted so the tap at
                // least starts the picture rather than doing nothing at all.
                setMutedSafely(el, true);
                setMuted(true);
                el.play().catch(() => {});
              });
            }
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/40 cursor-pointer group/play"
          data-testid="button-video-manual-play"
        >
          <div className="relative flex items-center justify-center">
            <div className="absolute w-[4.5rem] h-[4.5rem] rounded-full border border-brand/[0.08] group-hover/play:border-brand/20 transition-colors" />
            <div
              className="relative w-14 h-14 rounded-full border border-brand/15 flex items-center justify-center shadow-[0_0_15px_rgba(88,28,135,0.3)] group-hover/play:shadow-[0_0_25px_rgba(88,28,135,0.5)] group-hover/play:scale-105 transition-all overflow-hidden"
              style={{ background: "radial-gradient(circle at 30% 30%, rgba(99,102,241,0.25), rgba(30,10,60,0.95) 60%, rgba(5,2,15,0.98))" }}
            >
              <div className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(1px 1px at 20% 30%, rgba(167,139,250,0.7), transparent), radial-gradient(1px 1px at 70% 20%, rgba(129,140,248,0.5), transparent), radial-gradient(1px 1px at 45% 70%, rgba(192,132,252,0.6), transparent), radial-gradient(0.5px 0.5px at 80% 60%, rgba(167,139,250,0.4), transparent), radial-gradient(0.5px 0.5px at 15% 80%, rgba(129,140,248,0.3), transparent), radial-gradient(1px 1px at 60% 45%, rgba(139,92,246,0.5), transparent)" }} />
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-6 h-6 relative z-10 opacity-90 group-hover/play:opacity-100 transition-opacity drop-shadow-[0_0_3px_rgba(255,255,255,0.3)]">
                <g clipPath="url(#clip0_play)">
                  <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" />
                  <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" />
                </g>
                <defs>
                  <clipPath id="clip0_play">
                    <rect width="24" height="24" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
          </div>
        </button>
      )}
      </div>
      {theaterOpen && (
        <VideoLightbox
          src={src}
          startTime={videoRef.current?.currentTime || 0}
          startMuted={videoRef.current?.muted ?? true}
          autoplay={theaterAutoplayRef.current}
          onClose={handleTheaterClose}
          authorInfo={authorInfo}
          loop={!isHls}
        />
      )}
    </div>
  );
}

export function VideoEmbed({
  type,
  embedId,
  url,
  compact,
  contentWarning,
  cwKey,
}: {
  type: EmbedType;
  embedId?: string;
  url: string;
  compact?: boolean;
  contentWarning?: string | null;
  cwKey?: string;
}) {
  // Hooks first (Rules of Hooks) — then the no-id early return below.
  const [cwRevealed, setCwRevealed] = useState(() => (cwKey ? isCwRevealed(cwKey) : false));

  const id = embedId ?? resolveEmbedId(url, type) ?? undefined;

  // Couldn't resolve a playable id (e.g. a bare playlist/channel link). Show a
  // rich video link preview (thumbnail + play affordance) rather than our
  // branded "open in browser" card, so it still feels native.
  if (!id) {
    return <LinkPreviewCard url={url} compact={compact} isVideo />;
  }

  const hasCW = !!contentWarning && getSensitiveContentSetting();

  const vertical = type === "youtube" && isYouTubeShort(url);
  // 16:9 by default; Shorts are vertical (9:16) and capped so they don't dominate the feed.
  const aspect = vertical ? "aspect-[9/16] max-h-[70vh] sm:max-h-[560px] mx-auto w-auto" : "aspect-video w-full";
  const maxW = vertical ? "max-w-[315px]" : "";

  return (
    <div className={`relative my-1 overflow-hidden rounded-lg border border-border bg-black ${aspect} ${maxW}`}>
      {(!hasCW || cwRevealed) && (
        <InlineEmbedPlayer
          type={type}
          embedId={id}
          className={compact ? "rounded-md" : ""}
          testId={`embed-${type}`}
        />
      )}
      {hasCW && !cwRevealed && (
        <SensitiveContentOverlay
          reason={contentWarning!}
          onReveal={() => {
            setCwRevealed(true);
            if (cwKey) markCwRevealed(cwKey);
          }}
        />
      )}
    </div>
  );
}

function ZapStreamCard({ url }: { url: string }) {
  const naddr = useMemo(() => extractZapStreamNaddr(url), [url]);
  if (!naddr) return null;

  return (
    <Link
      href={`/live/${naddr}`}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className="group/stream block rounded-xl overflow-hidden border border-border/60 hover:border-primary/40 bg-card transition-colors"
    >
      {/* Token-driven surface so the card reads as intentional in BOTH themes
          (was a hardcoded dark gradient with white text — invisible/washed-out
          in light mode). A brand-tinted wash + accent rail keep it on-brand. */}
      <div className="relative flex items-center gap-3.5 p-3.5 bg-gradient-to-r from-primary/[0.07] via-transparent to-transparent">
        <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-brand to-brand" aria-hidden />
        <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-gradient-to-br from-brand/15 to-brand/10 border border-brand/20 text-brand">
          <Cast className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Live
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Live stream</span>
          </div>
          <p className="text-sm font-semibold text-foreground truncate">Watch the live stream</p>
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <RelayOutpostIcon className="w-3 h-3 text-brand/70" />
            Opens in Relay Outpost
          </p>
        </div>
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 text-primary group-hover/stream:bg-primary group-hover/stream:text-primary-foreground transition-colors">
            <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
          </div>
        </div>
      </div>
    </Link>
  );
}


interface LinkPreviewCardProps {
  url: string;
  compact?: boolean;
  displayedImageUrls?: Set<string>;
  hideImage?: boolean;
  isVideo?: boolean;
}

/**
 * Compact fixed-height link preview (X/Slack style). ONE box for every state
 * — loading skeleton, resolved-with-image, resolved-without-image, OG fetch
 * failed — so the card's height never changes as the preview resolves and the
 * feed can't shift under the reader. Square thumbnail on the left (OG image,
 * else favicon/glyph placeholder), title + domain on the right.
 *
 * Group-chat invite links (CORD-05, ANY Concord client's host) are detected
 * purely from the URL shape BEFORE the OG fetch and render as a same-height
 * Join card pointing at OUR internal /invite accept flow instead — no network,
 * no layout shift, and the #fragment secret never leaves the client.
 */
export function LinkPreviewCard(props: LinkPreviewCardProps) {
  const invite = detectGroupInvite(props.url);
  if (invite) return <GroupInviteCard invite={invite} compact={props.compact} />;
  return <OgLinkPreviewCard {...props} />;
}

function OgLinkPreviewCard({
  url,
  compact = false,
  displayedImageUrls,
  hideImage = false,
  isVideo = false,
}: LinkPreviewCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const { data: ogData, isLoading } = useQuery<{
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    video?: boolean;
    /** Directly-playable audio (podcast enclosure via og:audio) — inline player. */
    audioUrl?: string;
  }>({
    queryKey: [`/api/og?url=${encodeURIComponent(url)}`],
    staleTime: 60 * 60 * 1000,
    retry: 1,
    retryDelay: 2000,
  });

  // Show the play affordance when the caller knows it's a video host, or when the
  // fetched OpenGraph metadata says so (e.g. an X/Twitter post that contains video).
  const showVideo = isVideo || ogData?.video === true;

  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    hostname = url;
  }

  const resolved = !isLoading;
  const hasOg = !!ogData && !!(ogData.title || ogData.image || ogData.description);
  const imageUrl =
    ogData?.image && !thumbFailed && !hideImage && !displayedImageUrls?.has(ogData.image)
      ? ogData.image
      : null;
  const trimmedUrl = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 80);
  const title = hasOg && ogData?.title
    ? ogData.title
    : showVideo
      ? `Watch on ${hostname}`
      : trimmedUrl;
  const domainLabel = (hasOg && ogData?.siteName) || hostname;
  const testId = !resolved
    ? "media-link-loading"
    : hasOg
      ? "media-link-preview"
      : showVideo
        ? "media-video-link-fallback"
        : "media-link-fallback";

  // Podcast/audio share page that exposed a playable enclosure (og:audio) →
  // inline player. NOT wrapped in the card <a> (so the audio controls don't
  // navigate); the title/domain stay a link to the original. isVideo hosts still
  // take the video path above. Client-only SPAs (fountain.fm) expose no audioUrl
  // and fall through to the normal link card.
  if (resolved && ogData?.audioUrl && !showVideo) {
    return (
      <div
        className="rounded-xl border border-border/40 bg-muted/10 p-2.5 overflow-hidden"
        data-testid="media-audio-link-preview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className={`relative ${compact ? "w-12 h-12" : "w-14 h-14"} rounded-lg shrink-0 overflow-hidden bg-muted/30 flex items-center justify-center`}>
            {imageUrl ? (
              <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" onError={() => setThumbFailed(true)} />
            ) : (
              <Play className="w-5 h-5 text-muted-foreground/60" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{title}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground hover:text-brand truncate inline-flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3 shrink-0" /> {domainLabel}
            </a>
          </div>
        </div>
        <audio
          controls
          preload="none"
          src={ogData.audioUrl}
          className="w-full mt-2 h-9"
          onClick={(e) => e.stopPropagation()}
          data-testid="media-audio-player"
        />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-3 rounded-xl border border-border/40 bg-muted/10 p-2.5 overflow-hidden hover-elevate transition-all ${compact ? "h-[84px]" : "h-[100px]"}`}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Fixed square thumbnail slot — identical box whether it ends up holding
          the OG image, a favicon placeholder, a play glyph, or the skeleton. */}
      <div className={`relative ${compact ? "w-16 h-16" : "w-20 h-20"} rounded-lg shrink-0 overflow-hidden bg-muted/30 flex items-center justify-center`}>
        {!resolved ? (
          <div className="absolute inset-0 bg-muted/40 animate-pulse" aria-hidden="true" />
        ) : imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={ogData?.title || ""}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              onError={() => setThumbFailed(true)}
            />
            {showVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/25 pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center shadow-lg">
                  <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                </div>
              </div>
            )}
          </>
        ) : showVideo ? (
          <div className="w-9 h-9 rounded-full bg-foreground/10 flex items-center justify-center">
            <Play className="w-4 h-4 text-foreground/80 fill-current ml-0.5" />
          </div>
        ) : !faviconFailed ? (
          <img
            src={`https://icons.duckduckgo.com/ip3/${hostname}.ico`}
            alt=""
            className="w-8 h-8 rounded object-contain"
            loading="lazy"
            onError={() => setFaviconFailed(true)}
          />
        ) : (
          <Link2 className="w-6 h-6 text-muted-foreground/50" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!resolved ? (
          <div className="space-y-1.5" aria-hidden="true">
            <div className="h-2.5 w-24 rounded bg-muted/40 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-muted/40 animate-pulse" />
            <span className="sr-only">{url.length > 60 ? url.slice(0, 60) + "..." : url}</span>
          </div>
        ) : (
          <>
            <div className="text-[11px] text-muted-foreground/70 uppercase tracking-wider truncate">
              {domainLabel}
            </div>
            <div className={`font-medium text-foreground/90 mt-0.5 ${compact ? "text-xs line-clamp-2" : "text-sm line-clamp-2"}`}>
              {title}
            </div>
          </>
        )}
      </div>

      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 hidden sm:block" />
    </a>
  );
}

function NostrNoteEmbed({ noteId }: { noteId: string }) {
  let eventId: string;
  try {
    const decoded = nip19.decode(noteId);
    if (decoded.type === "note") {
      eventId = decoded.data;
    } else if (decoded.type === "nevent") {
      eventId = decoded.data.id;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const event = use$(eventStore.event(eventId));

  if (!event) {
    return (
      <a
        href={`/thread/${eventId}`}
        className="flex items-center gap-2 text-xs text-brand p-3 rounded-xl border border-border/40 bg-muted/10 min-h-[84px]"
        data-testid="media-nostr-note-link"
      >
        <span className="truncate">nostr:{noteId.slice(0, 20)}...</span>
        <ExternalLink className="w-3 h-3 shrink-0" />
      </a>
    );
  }

  const profileObs = eventStore.replaceable(0, event.pubkey);

  return <NostrNoteEmbedInner event={event} profileObs={profileObs} noteId={noteId} />;
}

function NostrNoteEmbedInner({
  event,
  profileObs,
  noteId,
}: {
  event: Event;
  profileObs: any;
  noteId: string;
}) {
  const profileEvent = use$(profileObs) as Event | undefined;
  let displayName = event.pubkey.slice(0, 8) + "...";
  let avatarUrl = "";

  if (profileEvent) {
    try {
      const meta = JSON.parse(profileEvent.content);
      displayName = meta.display_name || meta.name || displayName;
      avatarUrl = meta.picture || "";
    } catch {}
  }

  const npub = formatNpub(event.pubkey);
  const contentPreview = event.content.length > 200
    ? event.content.slice(0, 200) + "..."
    : event.content;

  return (
    <div
      className="rounded-xl border border-border/40 bg-muted/10 p-3 space-y-2 min-h-[84px]"
      data-testid="media-nostr-note-embed"
    >
      <div className="flex items-center gap-2">
        <Link href={`/profile/${npub}`}>
          <Avatar className="w-5 h-5 border border-border cursor-pointer">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback className="bg-muted text-[8px]">
              {displayName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Link>
        <Link href={`/profile/${npub}`} className="text-xs font-medium text-foreground/90 truncate cursor-pointer">
          {displayName}
        </Link>
        <span className="text-[11px] text-muted-foreground/70">{shortenNpub(npub)}</span>
      </div>
      <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
        {contentPreview}
      </p>
      <a
        href={`/thread/${event.id}`}
        className="inline-flex items-center gap-1 text-[11px] text-brand/70"
      >
        View full note <ExternalLink className="w-2.5 h-2.5" />
      </a>
    </div>
  );
}

function NostrProfileEmbed({ npubStr }: { npubStr: string }) {
  let pubkey: string;
  try {
    const decoded = nip19.decode(npubStr);
    if (decoded.type === "npub") {
      pubkey = decoded.data;
    } else if (decoded.type === "nprofile") {
      pubkey = decoded.data.pubkey;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const profileEvent = use$(eventStore.replaceable(0, pubkey));
  const npub = formatNpub(pubkey);

  let displayName = pubkey.slice(0, 8) + "...";
  let avatarUrl = "";
  let about = "";

  if (profileEvent) {
    try {
      const meta = JSON.parse(profileEvent.content);
      displayName = meta.display_name || meta.name || displayName;
      avatarUrl = meta.picture || "";
      about = meta.about || "";
    } catch {}
  }

  return (
    <Link href={`/profile/${npub}`}>
      <div
        className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-muted/10 cursor-pointer hover-elevate"
        data-testid="media-nostr-profile-embed"
      >
        <Avatar className="w-8 h-8 border border-border">
          <AvatarImage src={avatarUrl} alt={displayName} />
          <AvatarFallback className="bg-muted text-xs">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground/90 truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground/70">{shortenNpub(npub)}</div>
          {about && (
            <div className="text-xs text-muted-foreground/80 line-clamp-1 mt-0.5">{about}</div>
          )}
        </div>
      </div>
    </Link>
  );
}

function LiveStreamEventCard({ stream }: { stream: LiveEventData }) {
  const [imgError, setImgError] = useState(false);
  const profile = use$(eventStore.replaceable(0, stream.pubkey));
  const displayName = useMemo(() => {
    if (!profile) return shortenNpub(formatNpub(stream.pubkey));
    try {
      const p = JSON.parse(profile.content);
      return getDisplayName(p, formatNpub(stream.pubkey));
    } catch { return shortenNpub(formatNpub(stream.pubkey)); }
  }, [profile, stream.pubkey]);

  const naddr = useMemo(() => {
    try {
      return nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT });
    } catch { return null; }
  }, [stream.dTag, stream.pubkey]);

  const liveLink = naddr ? `/live/${naddr}` : "/live";
  const isLive = stream.status === "live";
  const posterUrl = stream.image && needsProxy(stream.image) ? proxyUrl(stream.image) : stream.image;

  return (
    <Link
      href={liveLink}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className="block rounded-xl overflow-hidden border border-brand/15 dark:border-brand/10 hover:border-brand/30 dark:hover:border-brand/20 transition-all duration-300 group/stream"
      data-testid="live-stream-event-card"
    >
      <div className="relative aspect-video overflow-hidden bg-black/50">
        {posterUrl && !imgError ? (
          <img
            src={posterUrl}
            alt={stream.title}
            className="w-full h-full object-cover opacity-80 group-hover/stream:opacity-100 group-hover/stream:scale-105 transition-all duration-500"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#0e0a1a] via-[#0c0818] to-[#080610]">
            <Radio className="w-12 h-12 text-brand/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          {isLive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-600/90 text-white text-xs font-semibold uppercase tracking-wide shadow-lg">
              <Radio className="w-3 h-3 animate-pulse" />
              LIVE
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-700/80 text-zinc-300 text-xs font-semibold shadow-lg">
              {stream.status === "ended" ? "Ended" : "Planned"}
            </div>
          )}
        </div>
        {stream.currentParticipants != null && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white/80 text-xs backdrop-blur-sm">
            {stream.currentParticipants} watching
          </div>
        )}
        <div className="absolute bottom-3 left-3 right-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand/90 text-white text-xs font-semibold shadow-lg transition-colors">
              <MessageCircle className="w-3.5 h-3.5" />
              {isLive ? "Join Live" : "View Stream"}
            </div>
          </div>
        </div>
      </div>
      <div className="px-3.5 py-2.5 bg-black/20 dark:bg-white/[0.02]">
        <h3 className="font-semibold text-sm text-foreground/90 line-clamp-1 group-hover/stream:text-brand transition-colors">
          {stream.title}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground/70">{displayName}</span>
          {stream.hashtags.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {stream.hashtags.slice(0, 3).map(tag => (
                <span key={tag} className="text-[10px] text-brand/60 dark:text-brand/50">#{tag}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export interface MediaRendererProps {
  event: Event;
  compact?: boolean;
  priority?: boolean;
}

export function MediaRenderer({ event, compact = false, priority = false }: MediaRendererProps) {
  const profileEvent = use$(eventStore.replaceable(0, event.pubkey));
  const videoAuthorInfo = useMemo(() => {
    const npub = formatNpub(event.pubkey);
    const postUrl = `/post/${nip19.noteEncode(event.id)}`;
    if (!profileEvent) return { displayName: shortenNpub(npub), postUrl };
    try {
      const p = JSON.parse(profileEvent.content);
      return {
        avatarUrl: getAvatarUrl(p),
        displayName: getDisplayName(p, npub),
        postUrl,
      };
    } catch {
      return { displayName: shortenNpub(npub), postUrl };
    }
  }, [profileEvent, event.pubkey, event.id]);
  const contentWarning = useMemo(() => getContentWarning(event), [event]);

  const liveEventData = useMemo(() => {
    if (event.kind !== KIND_LIVE_EVENT) return null;
    return parseLiveEvent(event);
  }, [event]);

  // Normalize Nostr-web-client links (njump/nostrudel/…) to `nostr:<bech32>`
  // first, so an event link isn't extracted as a generic 'link' media card — it
  // renders as a proper embedded note via NostrPost's reference cards instead.
  const { media } = useMemo(() => extractMediaFromContent(normalizeNostrClientLinks(event.content)), [event.content]);
  const imetaData = useMemo(() => {
    const parsed = parseImetaTags(event.tags);
    if (parsed.length > 0) return parsed;
    if (event.kind === 20 || event.kind === 1063) {
      const urlTag = event.tags.find((t) => t[0] === "url");
      const mimeTag = event.tags.find((t) => t[0] === "m");
      const dimTag = event.tags.find((t) => t[0] === "dim");
      const altTag = event.tags.find((t) => t[0] === "alt");
      const thumbTag = event.tags.find((t) => t[0] === "thumb" || t[0] === "image");
      if (urlTag?.[1]) {
        const item: ImetaData = { url: urlTag[1] };
        if (mimeTag?.[1]) item.mimeType = mimeTag[1];
        if (dimTag?.[1]) {
          const [w, h] = dimTag[1].split("x").map(Number);
          if (w && h) item.dimensions = { width: w, height: h };
        }
        if (altTag?.[1]) item.alt = altTag[1];
        if (thumbTag?.[1]) item.thumbnail = thumbTag[1];
        return [item];
      }
    }
    if (event.kind === 34235 || event.kind === 34236) {
      const urlTag = event.tags.find((t) => t[0] === "url");
      const mimeTag = event.tags.find((t) => t[0] === "m");
      const thumbTag = event.tags.find((t) => t[0] === "thumb" || t[0] === "image");
      if (urlTag?.[1]) {
        const item: ImetaData = { url: urlTag[1], mimeType: mimeTag?.[1] || "video/mp4" };
        if (thumbTag?.[1]) item.thumbnail = thumbTag[1];
        return [item];
      }
    }
    if (event.kind === 31337 || event.kind === 32123 || event.kind === 1808) {
      const mediaTag = event.tags.find((t) => t[0] === "media" || t[0] === "url" || t[0] === "stream_url");
      const coverTag = event.tags.find((t) => t[0] === "cover" || t[0] === "image" || t[0] === "thumb");
      if (mediaTag?.[1]) {
        const item: ImetaData = { url: mediaTag[1], mimeType: "audio/mpeg" };
        if (coverTag?.[1]) item.thumbnail = coverTag[1];
        return [item, ...parsed];
      }
    }
    return parsed;
  }, [event.tags, event.kind]);

  const audioMeta = useMemo(() => {
    const titleTag = event.tags.find((t) => t[0] === "title");
    const artistTag = event.tags.find((t) => t[0] === "c" && t[2] === "artist") || event.tags.find((t) => t[0] === "artist");
    if (!titleTag?.[1] && !artistTag?.[1]) return null;
    // Native Nostr music events (Wavlake/Zapstr/Stemstr) are authored by the
    // artist, so we can credit + support them directly. Regular notes that just
    // link an audio file are NOT — event.pubkey there is the poster, not the
    // artist — so credit data is only built for music kinds.
    const isMusicKind = event.kind === 31337 || event.kind === 32123 || event.kind === 1808;
    const credit: ArtistCreditData | undefined = isMusicKind
      ? {
          artist: artistTag?.[1] || "",
          artistPubkey: event.pubkey,
          zapSplits: extractZapSplits(event),
          source: event.kind === 32123 ? "wavlake" : "nostr",
        }
      : undefined;
    return {
      title: titleTag?.[1],
      artist: artistTag?.[1],
      credit,
    };
  }, [event.tags, event.kind, event.pubkey]);

  const imetaImages = useMemo(() => {
    return imetaData.filter((d) => {
      if (d.mimeType) return getMediaTypeFromMime(d.mimeType) === "image";
      return classifyUrl(d.url) === "image";
    });
  }, [imetaData]);

  const imetaVideos = useMemo(() => {
    return imetaData.filter((d) => {
      if (d.mimeType) return getMediaTypeFromMime(d.mimeType) === "video";
      return classifyUrl(d.url) === "video";
    });
  }, [imetaData]);

  const imetaAudio = useMemo(() => {
    return imetaData.filter((d) => {
      if (d.mimeType) return getMediaTypeFromMime(d.mimeType) === "audio";
      return classifyUrl(d.url) === "audio";
    });
  }, [imetaData]);

  const contentImages = media.filter((m) => m.type === "image");
  const contentVideos = media.filter((m) => m.type === "video");
  const contentAudio = media.filter((m) => m.type === "audio");
  const contentEmbeds = media.filter((m) => isEmbedType(m.type));
  const contentZapStreams = media.filter((m) => m.type === "zapstream");
  const contentMusicLinksRaw = media.filter((m) => m.type === "musiclink" && m.musicService);

  const allImageUrls = useMemo(() => {
    const urls = new Set<string>();
    imetaImages.forEach((d) => urls.add(d.url));
    contentImages.forEach((m) => urls.add(m.url));
    return urls;
  }, [imetaImages, contentImages]);

  const allVideoUrls = useMemo(() => {
    const urls = new Set<string>();
    imetaVideos.forEach((d) => urls.add(d.url));
    contentVideos.forEach((m) => urls.add(m.url));
    return urls;
  }, [imetaVideos, contentVideos]);

  const allAudioUrls = useMemo(() => {
    const urls = new Set<string>();
    imetaAudio.forEach((d) => urls.add(d.url));
    contentAudio.forEach((m) => urls.add(m.url));
    return urls;
  }, [imetaAudio, contentAudio]);

  const contentMusicLinks = useMemo(() => {
    if (allAudioUrls.size === 0 || !audioMeta) return contentMusicLinksRaw;
    const rTagUrls = new Set(event.tags.filter((t) => t[0] === "r" && t[1]).map((t) => t[1]));
    return contentMusicLinksRaw.filter((m) => !rTagUrls.has(m.url));
  }, [contentMusicLinksRaw, allAudioUrls, audioMeta, event.tags]);

  const imetaUrlSet = useMemo(() => new Set(imetaData.map((d) => d.url)), [imetaData]);
  const contentLinks = useMemo(() => {
    const audioSet = new Set<string>();
    imetaAudio.forEach((d) => audioSet.add(d.url));
    contentAudio.forEach((m) => audioSet.add(m.url));
    const imageSet = new Set<string>();
    imetaImages.forEach((d) => imageSet.add(d.url));
    contentImages.forEach((m) => imageSet.add(m.url));
    const videoSet = new Set<string>();
    imetaVideos.forEach((d) => videoSet.add(d.url));
    contentVideos.forEach((m) => videoSet.add(m.url));

    return media
      .filter((m) => m.type === "link")
      .filter((m) => !imetaUrlSet.has(m.url) && !audioSet.has(m.url) && !imageSet.has(m.url) && !videoSet.has(m.url))
      .filter((m, i, arr) => arr.findIndex((a) => a.url === m.url) === i);
  }, [media, imetaUrlSet, imetaAudio, imetaImages, imetaVideos, contentAudio, contentImages, contentVideos]);

  const hasMedia = allImageUrls.size > 0 || allVideoUrls.size > 0 || allAudioUrls.size > 0 || contentEmbeds.length > 0 || contentLinks.length > 0 || contentZapStreams.length > 0 || contentMusicLinks.length > 0;

  if (liveEventData) {
    return (
      <div className="space-y-3 mt-3" data-testid="media-renderer">
        <LiveStreamEventCard stream={liveEventData} />
      </div>
    );
  }

  if (!hasMedia) return null;

  const imageItems = Array.from(allImageUrls).map((url) => {
    const imeta = imetaImages.find((d) => d.url === url);
    return {
      src: url,
      alt: imeta?.alt,
      dimensions: imeta?.dimensions,
      blurhash: imeta?.blurhash,
      sha256: imeta?.sha256,
      fallbacks: imeta?.fallbacks,
    };
  });

  return (
    <div className="space-y-3 mt-3" data-testid="media-renderer">
      {imageItems.length > 0 && (
        <ImageGallery images={imageItems} compact={compact} contentWarning={contentWarning} cwKey={event.id} priority={priority} />
      )}

      {Array.from(allVideoUrls).map((url) => {
        const imeta = imetaVideos.find((d) => d.url === url);
        return (
          <InlineVideo
            key={url}
            src={url}
            poster={imeta?.thumbnail}
            dimensions={imeta?.dimensions}
            sha256={imeta?.sha256}
            fallbacks={imeta?.fallbacks}
            compact={compact}
            contentWarning={contentWarning}
            cwKey={event.id}
            authorInfo={videoAuthorInfo}
            authorPubkey={event.pubkey}
          />
        );
      })}

      {contentEmbeds.map((embed) => (
        <VideoEmbed
          key={embed.url}
          type={embed.type as EmbedType}
          embedId={embed.embedId}
          url={embed.url}
          compact={compact}
          contentWarning={contentWarning}
          cwKey={event.id}
        />
      ))}

      {contentZapStreams.map((stream) => (
        <ZapStreamCard key={stream.url} url={stream.url} />
      ))}

      {Array.from(allAudioUrls).map((url) => {
        const imeta = imetaAudio.find((d) => d.url === url);
        return (
          <InlineAudio
            key={url}
            src={url}
            waveform={imeta?.waveform}
            duration={imeta?.duration}
            sha256={imeta?.sha256}
            fallbacks={imeta?.fallbacks}
            compact={compact}
            coverArt={imeta?.thumbnail}
            title={audioMeta?.title}
            artist={audioMeta?.artist}
            credit={audioMeta?.credit}
          />
        );
      })}

      {contentMusicLinks.map((link) =>
        link.musicService === "wavlake" ? (
          <WavlakeInlinePlayer key={link.url} url={link.url} compact={compact} />
        ) : (
          <MusicLinkCard
            key={link.url}
            url={link.url}
            service={link.musicService!}
            compact={compact}
          />
        )
      )}

      {contentLinks.map((link) => {
        const hidePreviewImage = allImageUrls.size > 0 && allAudioUrls.size > 0;
        return (
          <LinkPreviewCard key={link.url} url={link.url} compact={compact} displayedImageUrls={allImageUrls} hideImage={hidePreviewImage} isVideo={isKnownVideoLink(link.url)} />
        );
      })}
    </div>
  );
}

export function NostrReferenceRenderer({
  type,
  encoded,
}: {
  type: "npub" | "nprofile" | "note" | "nevent" | "naddr";
  encoded: string;
}) {
  if (type === "npub" || type === "nprofile") {
    return <NostrProfileEmbed npubStr={encoded} />;
  }
  if (type === "note" || type === "nevent") {
    return <NostrNoteEmbed noteId={encoded} />;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground p-2 rounded-xl border border-border/40 bg-muted/10">
      <span className="truncate">nostr:{encoded.slice(0, 20)}...</span>
    </span>
  );
}
