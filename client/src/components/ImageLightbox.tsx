import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useBackClosable } from "@/hooks/use-back-closable";
import { createPortal } from "react-dom";
import { X, Download, ChevronLeft, ChevronRight, Heart, MessageCircle, ArrowUpRight } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { useInteractionCounts } from "@/contexts/InteractionIndexContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

export interface LightboxImage {
  src: string;
  alt?: string;
  /** The post text that accompanied this image (media URLs already stripped). */
  caption?: string;
  /** Route to the full post/thread, e.g. `/thread/<nevent>`. */
  postUrl?: string;
  /** Source event id — powers the read-only resonance (reaction count). */
  eventId?: string;
  /** Per-image posted-at label (a gallery spans many posts). */
  timestamp?: string;
}

/** Caption entities: URLs → links, #tags → search, everything else plain. Keeps
 *  the immersive viewer self-contained (no note-renderer dependency). */
function renderCaption(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+|#[A-Za-z0-9_]+)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (/^https?:\/\//.test(part)) {
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-sky-300 hover:underline break-all">{part.replace(/^https?:\/\//, "")}</a>;
    }
    if (/^#[A-Za-z0-9_]+$/.test(part)) {
      return <Link key={i} href={`/search?tab=hashtags&q=${encodeURIComponent(part)}`} onClick={(e) => e.stopPropagation()} className="text-sky-300 hover:underline">{part}</Link>;
    }
    return <span key={i}>{part}</span>;
  });
}

export interface LightboxAuthorInfo {
  avatarUrl?: string;
  displayName: string;
  timestamp?: string;
  postUrl?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  startIndex?: number;
  onClose: () => void;
  authorInfo?: LightboxAuthorInfo;
  testIdPrefix?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SWIPE_THRESHOLD = 50;
const DOUBLE_TAP_DELAY = 300;
const DISMISS_THRESHOLD = 100;
const CONTROLS_FADE_MS = 3000;
const TAP_MOVE_TOLERANCE = 10;

export function ImageLightbox({
  images,
  startIndex = 0,
  onClose,
  authorInfo,
  testIdPrefix = "lightbox" }: ImageLightboxProps) {
  const isMobile = useIsMobile();
  const safeImages = images && images.length > 0 ? images : [{ src: "", alt: "" }];
  const isEmpty = !images || images.length === 0;

  const [index, setIndex] = useState(Math.min(startIndex, safeImages.length - 1));
  const [downloading, setDownloading] = useState(false);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);

  const [dismissY, setDismissY] = useState(0);
  const [dismissX, setDismissX] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoveringControls, setHoveringControls] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = useRef<number>(0);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const isDismissingRef = useRef(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMoveRef = useRef(false);
  const wasDoubleTapRef = useRef(false);
  const swipeDirectionRef = useRef<"horizontal" | "vertical" | null>(null);

  const total = safeImages.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;
  const isZoomed = scale > 1;
  const current = safeImages[index];
  // Read-only "resonance" for the current image's source post — meaning without
  // importing a troll surface; real engagement happens in the moderated thread.
  const { reactionCount } = useInteractionCounts(current.eventId ?? "");
  const captionText = (current.caption ?? "").trim();
  const postUrl = current.postUrl;
  // Dots read clean for a handful (a feed post's 2–4 images); a big Media-tab
  // album needs a scrollable filmstrip instead, so you can see where you are.
  const showFilmstrip = total > 4;
  const filmstripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEmpty) onClose();
  }, [isEmpty, onClose]);

  // Keep the active filmstrip thumb centered as you surf.
  useEffect(() => {
    if (!showFilmstrip) return;
    const active = filmstripRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [index, showFilmstrip]);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const goNext = useCallback(() => {
    resetZoom();
    setIndex((i) => Math.min(i + 1, total - 1));
  }, [total, resetZoom]);

  const goPrev = useCallback(() => {
    resetZoom();
    setIndex((i) => Math.max(i - 1, 0));
  }, [resetZoom]);

  const handleClose = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose(), 220);
  }, [onClose]);

  // Fullscreen overlay = modal-back contract: system Back closes the lightbox
  // (through the same animated path as the X), never the page under it. The
  // component mounts open, so the layer lives for the mount.
  // Gate on the REAL visible-open state, not a constant true: handleClose sets
  // `exiting` and defers unmount ~220ms, and during that window a
  // constant-true would re-push a fresh guard (leaking an entry + eating the
  // next Back). `!exiting` flips false the instant Back fires, so the
  // reconcile deregisters instead of re-arming.
  useBackClosable(!exiting, handleClose);

  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    if (s <= 1) return { x: 0, y: 0 };
    const img = imageRef.current;
    if (!img) return { x: tx, y: ty };
    const rect = img.getBoundingClientRect();
    const containerW = window.innerWidth;
    const containerH = window.innerHeight;
    const imgW = (rect.width / s) * s;
    const imgH = (rect.height / s) * s;
    const maxX = Math.max(0, (imgW - containerW) / 2);
    const maxY = Math.max(0, (imgH - containerH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)) };
  }, []);

  const handleZoomToggle = useCallback(() => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2);
    }
  }, [scale, resetZoom]);

  const handleDownload = useCallback(async () => {
    const imgSrc = safeImages[index].src;
    setDownloading(true);
    try {
      const res = await fetch(imgSrc);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      let filename = "image";
      try {
        const pathname = new URL(imgSrc).pathname;
        const lastSegment = pathname.split("/").pop();
        if (lastSegment && lastSegment.includes(".")) {
          filename = lastSegment;
        } else {
          const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
          filename = `image.${ext}`;
        }
      } catch {
        const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
        filename = `image.${ext}`;
      }
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(imgSrc, "_blank");
    } finally {
      setDownloading(false);
    }
  }, [safeImages, index]);

  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setControlsVisible(true);
    controlsTimerRef.current = setTimeout(() => {
      if (!hoveringControls) setControlsVisible(false);
    }, CONTROLS_FADE_MS);
  }, [hoveringControls]);

  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    };
  }, [scheduleHideControls]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setScale((s) => {
      const next = Math.min(s + 0.5, MAX_SCALE);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => {
      const next = Math.max(s - 0.5, MIN_SCALE);
      if (next <= 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      else if (!isZoomed && (e.key === "ArrowRight" || e.key === "ArrowDown")) goNext();
      else if (!isZoomed && (e.key === "ArrowLeft" || e.key === "ArrowUp")) goPrev();
      else if (e.key === "+" || e.key === "=") handleZoomIn();
      else if (e.key === "-") handleZoomOut();
      else if (e.key === "0") resetZoom();
    };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleClose, goNext, goPrev, isZoomed, handleZoomIn, handleZoomOut, resetZoom]);

  const handleDesktopMouseMove = useCallback(() => {
    if (!isMobile) scheduleHideControls();
  }, [isMobile, scheduleHideControls]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      setScale((s) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta));
        if (next <= 1) setTranslate({ x: 0, y: 0 });
        return next;
      });
    },
    [],
  );

  const getTouchDist = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartRef.current = { dist: getTouchDist(e.touches), scale };
        isDismissingRef.current = false;
        setDismissY(0);
        setDismissX(0);
        swipeDirectionRef.current = null;
        return;
      }
      const t = e.touches[0];
      const now = Date.now();
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: now };
      didMoveRef.current = false;
      isDismissingRef.current = false;
      wasDoubleTapRef.current = false;
      swipeDirectionRef.current = null;

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        lastTapRef.current = 0;
        wasDoubleTapRef.current = true;
        handleZoomToggle();
        return;
      }
      lastTapRef.current = now;

      if (isZoomed) {
        isPanningRef.current = true;
        panStartRef.current = { x: t.clientX, y: t.clientY, tx: translate.x, ty: translate.y };
      }
    },
    [scale, isZoomed, translate, handleZoomToggle],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        const dist = getTouchDist(e.touches);
        const ratio = dist / pinchStartRef.current.dist;
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartRef.current.scale * ratio));
        setScale(next);
        if (next <= 1) setTranslate({ x: 0, y: 0 });
        return;
      }
      if (isPanningRef.current && panStartRef.current && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - panStartRef.current.x;
        const dy = t.clientY - panStartRef.current.y;
        const clamped = clampTranslate(panStartRef.current.tx + dx, panStartRef.current.ty + dy, scale);
        setTranslate(clamped);
        didMoveRef.current = true;
        return;
      }

      if (isMobile && !isZoomed && touchStartRef.current && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - touchStartRef.current.x;
        const dy = t.clientY - touchStartRef.current.y;

        if (Math.abs(dy) > TAP_MOVE_TOLERANCE || Math.abs(dx) > TAP_MOVE_TOLERANCE) {
          didMoveRef.current = true;
        }

        if (!swipeDirectionRef.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          swipeDirectionRef.current = Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
        }

        if (swipeDirectionRef.current === "vertical" && !isDismissingRef.current && Math.abs(dy) > 10) {
          isDismissingRef.current = true;
        }

        if (isDismissingRef.current) {
          setDismissY(dy);
          setDismissX(dx * 0.3);
        }
      }
    },
    [scale, clampTranslate, isMobile, isZoomed],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (pinchStartRef.current && e.touches.length < 2) {
        pinchStartRef.current = null;
        setDismissY(0);
        setDismissX(0);
        isDismissingRef.current = false;
        swipeDirectionRef.current = null;
        return;
      }

      isPanningRef.current = false;
      panStartRef.current = null;

      if (isMobile && isDismissingRef.current) {
        isDismissingRef.current = false;
        swipeDirectionRef.current = null;
        if (Math.abs(dismissY) > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          setDismissY(0);
          setDismissX(0);
        }
        touchStartRef.current = null;
        return;
      }

      swipeDirectionRef.current = null;

      if (isMobile && !isZoomed && touchStartRef.current && !didMoveRef.current && !wasDoubleTapRef.current) {
        const elapsed = Date.now() - touchStartRef.current.time;
        if (elapsed < 300) {
          if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = setTimeout(() => {
            if (lastTapRef.current !== 0) {
              setControlsVisible((v) => !v);
              if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
              controlsTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_FADE_MS);
            }
            tapTimeoutRef.current = null;
          }, DOUBLE_TAP_DELAY);
        }
        touchStartRef.current = null;
        return;
      }

      if (!touchStartRef.current || isZoomed) {
        touchStartRef.current = null;
        return;
      }
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      touchStartRef.current = null;

      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < Math.abs(dx)) {
        if (dx < 0) goNext();
        else goPrev();
      }
    },
    [isZoomed, goNext, goPrev, isMobile, dismissY, handleClose],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isZoomed) return;
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    },
    [isZoomed, translate],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current || !panStartRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      const clamped = clampTranslate(panStartRef.current.tx + dx, panStartRef.current.ty + dy, scale);
      setTranslate(clamped);
    },
    [scale, clampTranslate],
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    panStartRef.current = null;
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        resetZoom();
        handleClose();
      }
    },
    [handleClose, resetZoom],
  );

  const dismissAbs = Math.abs(dismissY);
  const dismissProgress = Math.min(dismissAbs / (DISMISS_THRESHOLD * 2.5), 1);
  const bgOpacity = 1 - dismissProgress * 0.85;
  const dismissScale = 1 - dismissProgress * 0.08;
  const dismissOpacity = 1 - dismissProgress * 0.4;

  const showUI = controlsVisible && dismissAbs < 20;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseMove={(e) => { handleMouseMove(e); handleDesktopMouseMove(); }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      data-testid={`${testIdPrefix}-overlay`}
      style={{ touchAction: "none" }}
    >
      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out"
        style={{
          background: "black",
          opacity: exiting ? 0 : entered ? bgOpacity : 0 }}
      />

      <div
        className={`absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-3 sm:px-5 pt-3 sm:pt-4 pb-8 transition-opacity duration-300 ${showUI && !exiting ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)" }}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
      >
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="p-2 sm:p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
          data-testid={`${testIdPrefix}-download`}
          title="Download"
        >
          {downloading ? (
            <RelayOutpostInlineLoader className="w-5 h-5" />
          ) : (
            <Download className="w-5 h-5" />
          )}
        </button>

        {total > 1 && (
          <span className="text-white/60 text-xs font-mono tracking-wider">
            {index + 1} / {total}
          </span>
        )}

        <button
          onClick={handleClose}
          className="p-2 sm:p-2.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
          data-testid={`${testIdPrefix}-close`}
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="absolute inset-0 flex items-center justify-center"
        onClick={isMobile ? undefined : handleBackdropClick}
      >
        {hasPrev && !isZoomed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className={`hidden sm:flex absolute left-3 md:left-5 z-20 p-2 md:p-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all duration-300 ${showUI && !exiting ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onMouseEnter={() => setHoveringControls(true)}
            onMouseLeave={() => setHoveringControls(false)}
            data-testid={`${testIdPrefix}-prev`}
          >
            <ChevronLeft className="w-6 h-6 md:w-7 md:h-7" />
          </button>
        )}

        <div
          className={`flex items-center justify-center w-full h-full ${isMobile ? "p-2" : "p-4 sm:px-16 sm:py-12"} ${isZoomed ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          style={
            dismissAbs > 0
              ? {
                  transform: `translate(${dismissX}px, ${dismissY}px) scale(${dismissScale})`,
                  opacity: dismissOpacity,
                  transition: "none" }
              : entered && !exiting
                ? { transition: "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease-out" }
                : exiting
                  ? { transform: "scale(0.92)", opacity: 0, transition: "transform 0.22s ease-in, opacity 0.22s ease-in" }
                  : { transform: "scale(0.92)", opacity: 0, transition: "transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), opacity 0.3s ease-out" }
          }
        >
          <img
            ref={imageRef}
            src={safeImages[index].src}
            alt={safeImages[index].alt || ""}
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              willChange: "transform",
              transition: isPanningRef.current ? "none" : "transform 0.15s ease-out" }}
            decoding="async"
            draggable={false}
            onDoubleClick={handleZoomToggle}
            onClick={(e) => e.stopPropagation()}
            data-testid={`${testIdPrefix}-image`}
          />
        </div>

        {hasNext && !isZoomed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className={`hidden sm:flex absolute right-3 md:right-5 z-20 p-2 md:p-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all duration-300 ${showUI && !exiting ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onMouseEnter={() => setHoveringControls(true)}
            onMouseLeave={() => setHoveringControls(false)}
            data-testid={`${testIdPrefix}-next`}
          >
            <ChevronRight className="w-6 h-6 md:w-7 md:h-7" />
          </button>
        )}
      </div>

      <div
        className={`absolute bottom-0 left-0 right-0 z-30 px-3 sm:px-5 pb-3 sm:pb-4 pt-10 transition-opacity duration-300 ${showUI && !exiting ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)",
          ...(isMobile ? { paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : {}) }}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
      >
        {/* Caption bubble — the words the image was posted with, so it carries
            its meaning. URLs/#tags are live; the raw media URL is stripped upstream. */}
        {captionText && (
          <div className="mb-2.5 max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="inline-block rounded-2xl rounded-bl-md bg-white/10 backdrop-blur-md ring-1 ring-white/15 px-3.5 py-2.5 text-[13px] leading-relaxed text-white/90 whitespace-pre-wrap break-words max-h-36 overflow-y-auto" data-testid={`${testIdPrefix}-caption`}>
              {renderCaption(captionText)}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          {authorInfo ? (
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Avatar className="w-7 h-7 border border-white/20 shrink-0">
                <AvatarImage src={authorInfo.avatarUrl} alt={authorInfo.displayName} />
                <AvatarFallback className="text-[10px] bg-white/10 text-white font-mono">
                  {authorInfo.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-white/90 truncate block" data-testid={`${testIdPrefix}-author`}>
                  {authorInfo.displayName}
                </span>
                {(current.timestamp || authorInfo.timestamp) && (
                  <span className="text-[11px] text-white/40 font-mono block" data-testid={`${testIdPrefix}-time`}>
                    {current.timestamp || authorInfo.timestamp}
                  </span>
                )}
              </div>
              {reactionCount > 0 && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[12px] text-white/60" data-testid={`${testIdPrefix}-resonance`}>
                  <Heart className="w-3.5 h-3.5" /> {reactionCount}
                </span>
              )}
              {(postUrl || authorInfo.postUrl) && (
                <Link
                  href={postUrl || authorInfo.postUrl || "#"}
                  className="shrink-0 inline-flex items-center gap-1 text-xs text-white/70 hover:text-white transition-colors font-medium"
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`${testIdPrefix}-view-post`}
                >
                  Open post <ArrowUpRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {total > 1 && !showFilmstrip && (
            <div className="flex items-center gap-1.5 shrink-0">
              {safeImages.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    resetZoom();
                    setIndex(i);
                  }}
                  className={`rounded-full cursor-pointer transition-all duration-200 ${
                    i === index
                      ? "w-2 h-2 bg-white shadow-[0_0_6px_rgba(255,255,255,0.4)]"
                      : "w-1.5 h-1.5 bg-white/30 hover:bg-white/50"
                  }`}
                  data-testid={`${testIdPrefix}-dot-${i}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Filmstrip — the Media-album channel-strip. Active thumb ringed in the
            Relay Outpost violet; scrolls to keep the current shot centered. */}
        {showFilmstrip && (
          <div
            ref={filmstripRef}
            className="flex gap-1.5 overflow-x-auto pt-3 -mx-1 px-1 scrollbar-none"
            style={{ scrollbarWidth: "none" }}
          >
            {safeImages.map((img, i) => (
              <button
                key={i}
                data-active={i === index}
                onClick={() => {
                  resetZoom();
                  setIndex(i);
                }}
                className={`relative shrink-0 w-12 h-12 rounded-md overflow-hidden ring-2 transition-all duration-200 ${
                  i === index ? "ring-primary" : "ring-transparent opacity-45 hover:opacity-90"
                }`}
                data-testid={`${testIdPrefix}-thumb-${i}`}
              >
                <img src={img.src} alt="" className="w-full h-full object-cover pointer-events-none" loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
