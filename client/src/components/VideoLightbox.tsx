import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useBackClosable } from "@/hooks/use-back-closable";
import { createPortal } from "react-dom";
import { X, Download, Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2, Radio } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePiP } from "@/contexts/PiPContext";
import { supportsNativeHls } from "@/contexts/PiPContext";
import { usePersistentMedia } from "@/contexts/PersistentMediaContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import type Hls from "hls.js";
import { loadHls } from "@/lib/load-hls";
import { needsProxy, proxyUrl } from "@/lib/live-events";
import { setVideoMuted } from "@/lib/video-prefs";

export interface VideoLightboxAuthorInfo {
  avatarUrl?: string;
  displayName: string;
  timestamp?: string;
  postUrl?: string;
}

interface VideoLightboxProps {
  src: string;
  startTime?: number;
  startMuted?: boolean;
  autoplay?: boolean;
  onClose: (finalTime: number, wasMuted: boolean, wasPlaying: boolean) => void;
  authorInfo?: VideoLightboxAuthorInfo;
  loop?: boolean;
  testIdPrefix?: string;
}

const DISMISS_THRESHOLD = 100;
const CONTROLS_FADE_MS = 3000;
const TAP_MOVE_TOLERANCE = 10;

export function VideoLightbox({
  src,
  startTime = 0,
  startMuted = false,
  autoplay = true,
  onClose,
  authorInfo,
  loop = true,
  testIdPrefix = "video-lightbox" }: VideoLightboxProps) {
  const isMobile = useIsMobile();
  const { enterPiP, isPiP, pipVideoSrc, pipSupported, notifyUnmount } = usePiP();
  const { claimVideo, handoffVideo } = usePersistentMedia();
  const isHls = src.includes(".m3u8");
  const hlsRef = useRef<Hls | null>(null);
  const isThisPiP = isPiP && pipVideoSrc === src;
  const claimedRef = useRef(false);

  const effectiveSrc = useMemo(() => {
    if (isHls && needsProxy(src)) return proxyUrl(src);
    return src;
  }, [src, isHls]);

  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [hlsError, setHlsError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoveringControls, setHoveringControls] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(startMuted);
  const [currentTime, setCurrentTime] = useState(startTime);
  const [duration, setDuration] = useState(0);
  const [dismissY, setDismissY] = useState(0);
  const [dismissX, setDismissX] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDismissingRef = useRef(false);
  const didMoveRef = useRef(false);
  const swipeDirectionRef = useRef<"horizontal" | "vertical" | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isHls) return;
    if (supportsNativeHls) {
      el.src = effectiveSrc;
      return;
    }
    // hls.js loads on demand (it's ~1.3MB) — only when an HLS video is opened.
    let cancelled = false;
    loadHls()
      .then((HlsCtor) => {
        if (cancelled) return;
        if (HlsCtor.isSupported()) {
          const hls = new HlsCtor({
            enableWorker: true,
            lowLatencyMode: true,
            maxBufferLength: 10,
            maxMaxBufferLength: 30,
          });
          hlsRef.current = hls;
          hls.loadSource(effectiveSrc);
          hls.attachMedia(el);
          hls.on(HlsCtor.Events.ERROR, (_evt: any, data: any) => {
            if (data.fatal) {
              setHlsError(true);
              hls.destroy();
              hlsRef.current = null;
            }
          });
        } else {
          el.src = effectiveSrc;
        }
      })
      .catch(() => {
        if (!cancelled) el.src = effectiveSrc;
      });
    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [effectiveSrc, isHls]);

  const scheduleHideControls = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    setControlsVisible(true);
    controlsTimerRef.current = setTimeout(() => {
      if (!hoveringControls && !seekingRef.current) setControlsVisible(false);
    }, CONTROLS_FADE_MS);
  }, [hoveringControls]);

  useEffect(() => {
    scheduleHideControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [scheduleHideControls]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
  }, []);

  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    const v = videoRef.current;
    if (!v) return;
    const handoff = claimVideo(src);
    if (handoff) {
      v.currentTime = handoff.currentTime;
      v.muted = handoff.muted;
      setMuted(handoff.muted);
    } else {
      v.currentTime = startTime;
      v.muted = startMuted;
    }
    if (autoplay) {
      v.play().catch(() => {});
    } else {
      setPlaying(false);
    }
  }, [src, claimVideo, startTime, startMuted, autoplay]);

  useEffect(() => {
    const videoSrc = src;
    return () => {
      notifyUnmount(videoSrc);
    };
  }, [src, notifyUnmount]);

  const getFinalState = useCallback(() => {
    const v = videoRef.current;
    return {
      time: v ? v.currentTime : currentTime,
      muted: v ? v.muted : muted,
      playing: v ? !v.paused : playing };
  }, [currentTime, muted, playing]);

  const handleClose = useCallback(() => {
    const state = getFinalState();
    const v = videoRef.current;
    if (v) {
      handoffVideo(src, state.time, state.muted);
      v.pause();
    }
    setExiting(true);
    setTimeout(() => onClose(state.time, state.muted, state.playing), 220);
  }, [onClose, getFinalState, src, handoffVideo]);

  // Modal-back contract: Back closes the theater through the same animated
  // path as the X (handoff + final playback state preserved).
  // Gate on the REAL visible-open state, not a constant true: handleClose sets
  // `exiting` and defers unmount ~220ms, and during that window a
  // constant-true would re-push a fresh guard (leaking an entry + eating the
  // next Back). `!exiting` flips false the instant Back fires, so the
  // reconcile deregisters instead of re-arming.
  useBackClosable(!exiting, handleClose);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      else if (e.key === " ") {
        e.preventDefault();
        const v = videoRef.current;
        if (v) {
          if (v.paused) v.play().catch(() => {});
          else v.pause();
        }
      } else if (e.key === "m") {
        const v = videoRef.current;
        if (v) {
          v.muted = !v.muted;
          setMuted(v.muted);
          setVideoMuted(v.muted);
        }
      } else if (e.key === "ArrowLeft") {
        const v = videoRef.current;
        if (v) v.currentTime = Math.max(0, v.currentTime - 5);
      } else if (e.key === "ArrowRight") {
        const v = videoRef.current;
        if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
      } else if (e.key === "f") {
        const v = videoRef.current;
        if (v) {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else v.requestFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [handleClose]);

  const handleDesktopMouseMove = useCallback(() => {
    if (!isMobile) scheduleHideControls();
  }, [isMobile, scheduleHideControls]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      let filename = "video";
      try {
        const pathname = new URL(src).pathname;
        const lastSegment = pathname.split("/").pop();
        if (lastSegment && lastSegment.includes(".")) {
          filename = lastSegment;
        } else {
          const ext = blob.type.split("/")[1] || "mp4";
          filename = `video.${ext}`;
        }
      } catch {
        filename = "video.mp4";
      }
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    } finally {
      setDownloading(false);
    }
  }, [src]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    didMoveRef.current = false;
    isDismissingRef.current = false;
    swipeDirectionRef.current = null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
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
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isDismissingRef.current) {
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

    if (isMobile && touchStartRef.current && !didMoveRef.current) {
      const elapsed = Date.now() - touchStartRef.current.time;
      if (elapsed < 300) {
        setControlsVisible((v) => !v);
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_FADE_MS);
      }
    }
    touchStartRef.current = null;
  }, [isMobile, dismissY, handleClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    scheduleHideControls();
  }, [scheduleHideControls]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    setVideoMuted(v.muted);
    scheduleHideControls();
  }, [scheduleHideControls]);

  const handleFullscreen = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else v.requestFullscreen().catch(() => {});
  }, []);

  const handlePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    await enterPiP(video, src, !isHls, isHls);
  }, [src, enterPiP, isHls]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    const bar = progressBarRef.current;
    const v = videoRef.current;
    if (!bar || !v || !isFinite(v.duration)) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    scheduleHideControls();
  }, [scheduleHideControls]);

  const handleProgressTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    seekingRef.current = true;
    const bar = progressBarRef.current;
    const v = videoRef.current;
    if (!bar || !v || !isFinite(v.duration)) return;
    const rect = bar.getBoundingClientRect();
    const t = e.touches[0];
    const ratio = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
  }, []);

  const handleProgressTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    const bar = progressBarRef.current;
    const v = videoRef.current;
    if (!bar || !v || !isFinite(v.duration)) return;
    const rect = bar.getBoundingClientRect();
    const t = e.touches[0];
    const ratio = Math.max(0, Math.min(1, (t.clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
  }, []);

  const handleProgressTouchEnd = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    seekingRef.current = false;
    scheduleHideControls();
  }, [scheduleHideControls]);

  const dismissAbs = Math.abs(dismissY);
  const dismissProgress = Math.min(dismissAbs / (DISMISS_THRESHOLD * 2.5), 1);
  const bgOpacity = 1 - dismissProgress * 0.85;
  const dismissScale = 1 - dismissProgress * 0.08;
  const dismissOpacity = 1 - dismissProgress * 0.4;

  const showUI = controlsVisible && dismissAbs < 20;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] select-none"
      onMouseMove={handleDesktopMouseMove}
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

        {isHls && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-600/90 text-white text-xs font-semibold uppercase tracking-wide">
            <Radio className="w-3 h-3 animate-pulse" />
            LIVE
          </div>
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`flex items-center justify-center w-full h-full ${isMobile ? "p-0" : "p-4 sm:px-16 sm:py-12"}`}
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
          <video
            ref={videoRef}
            src={isHls ? undefined : src}
            className="max-w-full max-h-full object-contain select-none rounded-sm"
            playsInline
            loop={loop}
            onClick={(e) => {
              e.stopPropagation();
              if (!isMobile) togglePlay();
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={() => {
              const v = videoRef.current;
              if (v) setCurrentTime(v.currentTime);
            }}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v) setDuration(v.duration);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleFullscreen();
            }}
            data-testid={`${testIdPrefix}-video`}
          />
          {hlsError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
              <p className="text-white/80 text-sm mb-3">Stream unavailable</p>
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        className={`absolute bottom-0 left-0 right-0 z-30 px-3 sm:px-5 pb-3 sm:pb-4 pt-10 transition-opacity duration-300 ${showUI && !exiting ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)",
          ...(isMobile ? { paddingBottom: "max(12px, env(safe-area-inset-bottom))" } : {}) }}
        onMouseEnter={() => setHoveringControls(true)}
        onMouseLeave={() => setHoveringControls(false)}
      >
        <div
          ref={progressBarRef}
          className="w-full h-6 flex items-center cursor-pointer group/progress mb-2"
          onClick={handleProgressClick}
          onTouchStart={handleProgressTouchStart}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
          data-testid={`${testIdPrefix}-progress`}
        >
          <div className="w-full h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full relative transition-all">
            <div
              className="absolute inset-y-0 left-0 bg-white rounded-full"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover/progress:opacity-100 transition-opacity"
              style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
              data-testid={`${testIdPrefix}-play-pause`}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button
              onClick={toggleMute}
              className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
              data-testid={`${testIdPrefix}-mute`}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <span className="text-white/50 text-xs font-mono tabular-nums ml-1">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {authorInfo ? (
              <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                <Avatar className="w-6 h-6 border border-white/20 shrink-0">
                  <AvatarImage src={authorInfo.avatarUrl} alt={authorInfo.displayName} />
                  <AvatarFallback className="text-[9px] bg-white/10 text-white font-mono">
                    {authorInfo.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-white/70 truncate hidden sm:block" data-testid={`${testIdPrefix}-author`}>
                  {authorInfo.displayName}
                </span>
                {authorInfo.postUrl && (
                  <Link
                    href={authorInfo.postUrl}
                    className="shrink-0 text-[11px] text-white/50 hover:text-white transition-colors"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`${testIdPrefix}-view-post`}
                  >
                    View Post
                  </Link>
                )}
              </div>
            ) : null}
            {!isMobile && pipSupported && (
              <button
                onClick={handlePiP}
                className={`p-1.5 rounded-full transition-all ${isThisPiP ? "text-green-300 bg-green-500/20" : "text-white/80 hover:text-white hover:bg-white/10"}`}
                data-testid={`${testIdPrefix}-pip`}
                title={isThisPiP ? "Playing in Picture-in-Picture" : "Picture-in-Picture"}
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>
            )}
            {!isMobile && (
              <button
                onClick={handleFullscreen}
                className="p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all"
                data-testid={`${testIdPrefix}-fullscreen`}
                title="Fullscreen (f)"
              >
                <Maximize className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
