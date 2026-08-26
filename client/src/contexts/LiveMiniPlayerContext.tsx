import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import type Hls from "hls.js";
import { loadHls } from "@/lib/load-hls";
import { X, Maximize2, Volume2, VolumeX, GripVertical } from "lucide-react";

/**
 * X-style in-app floating mini-player for live streams. "Pop Out" hands the
 * stream to this global player, which keeps playing in a small draggable card as
 * you navigate the app, until you expand it back to the full stream or close it.
 *
 * Unlike OS picture-in-picture (fragile for live HLS in an iOS PWA), this stays
 * inside the app and behaves the same on desktop, mobile, and installed PWA.
 */
export interface LiveMiniState {
  src: string;
  isHls: boolean;
  title: string;
  /** nip19 naddr so "expand" can route back to /live/:naddr. Optional. */
  naddr?: string;
  startTime?: number;
  muted?: boolean;
}

interface LiveMiniCtx {
  active: boolean;
  openMini: (s: LiveMiniState) => void;
  closeMini: () => void;
}

const Ctx = createContext<LiveMiniCtx>({ active: false, openMini: () => {}, closeMini: () => {} });
export const useLiveMiniPlayer = () => useContext(Ctx);

export function LiveMiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveMiniState | null>(null);
  const openMini = useCallback((s: LiveMiniState) => setState(s), []);
  const closeMini = useCallback(() => setState(null), []);
  return (
    <Ctx.Provider value={{ active: !!state, openMini, closeMini }}>
      {children}
      {state && <FloatingPlayer state={state} onClose={closeMini} />}
    </Ctx.Provider>
  );
}

const CARD_W = 240;
const CARD_H = 135 + 30; // 16:9 video + control bar
const MARGIN = 12;
const BOTTOM_NAV = 92; // leave room above the mobile bottom nav

function clampPos(x: number, y: number) {
  const maxX = window.innerWidth - CARD_W - MARGIN;
  const maxY = window.innerHeight - CARD_H - MARGIN;
  return {
    x: Math.max(MARGIN, Math.min(x, maxX)),
    y: Math.max(MARGIN, Math.min(y, maxY)),
  };
}

function FloatingPlayer({ state, onClose }: { state: LiveMiniState; onClose: () => void }) {
  const [, navigate] = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [muted, setMuted] = useState(state.muted ?? true);
  const [pos, setPos] = useState(() =>
    clampPos(window.innerWidth - CARD_W - MARGIN, window.innerHeight - CARD_H - MARGIN - BOTTOM_NAV),
  );
  // Drag bookkeeping — distinguish a tap (expand) from a drag.
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  // Attach the stream to the mini video (native HLS where supported, else hls.js).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    const nativeHls = v.canPlayType("application/vnd.apple.mpegurl") !== "";
    let cancelled = false;
    const start = () => {
      if (state.startTime && Number.isFinite(state.startTime)) {
        try { v.currentTime = state.startTime; } catch {}
      }
      v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", start, { once: true });
    if (state.isHls && !nativeHls) {
      // hls.js loads on demand (it's ~1.3MB) — only when a stream is popped out.
      loadHls()
        .then((HlsCtor) => {
          if (cancelled) return;
          if (HlsCtor.isSupported()) {
            const hls = new HlsCtor({ enableWorker: true });
            hlsRef.current = hls;
            hls.loadSource(state.src);
            hls.attachMedia(v);
            v.play().catch(() => {});
          } else {
            v.src = state.src;
            v.play().catch(() => {});
          }
        })
        .catch(() => {
          if (cancelled) return;
          v.src = state.src;
          v.play().catch(() => {});
        });
    } else {
      v.src = state.src;
      v.play().catch(() => {});
    }
    return () => {
      cancelled = true;
      v.removeEventListener("loadedmetadata", start);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      v.removeAttribute("src");
      try { v.load(); } catch {}
    };
  }, [state.src, state.isHls]);

  // Keep it on-screen through rotation / resize.
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = e.clientX - drag.current.dx;
    const ny = e.clientY - drag.current.dy;
    if (Math.abs(e.clientX - (drag.current.dx + pos.x)) > 4 || Math.abs(e.clientY - (drag.current.dy + pos.y)) > 4) {
      drag.current.moved = true;
    }
    setPos(clampPos(nx, ny));
  };
  const onPointerUp = () => { drag.current = null; };

  const expand = () => {
    if (drag.current?.moved) return;
    onClose();
    if (state.naddr) navigate(`/live/${state.naddr}`);
  };

  return createPortal(
    <div
      className="fixed z-[60] w-[240px] overflow-hidden rounded-xl border border-border/40 bg-black shadow-2xl shadow-black/50 select-none"
      style={{ left: pos.x, top: pos.y, touchAction: "none" }}
      data-testid="live-mini-player"
    >
      {/* Drag handle + controls */}
      <div
        className="flex items-center gap-1 px-1.5 h-[30px] bg-background/95 cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-[11px] text-foreground/70 truncate flex-1">{state.title || "Live"}</span>
        <button
          onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={muted ? "Unmute" : "Mute"}
          data-testid="button-mini-mute"
        >
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); expand(); }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Expand"
          data-testid="button-mini-expand"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label="Close"
          data-testid="button-mini-close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Tapping the video expands back to the full stream. */}
      <video
        ref={videoRef}
        className="block w-full aspect-video bg-black cursor-pointer"
        playsInline
        autoPlay
        onClick={expand}
        data-testid="live-mini-video"
      />
    </div>,
    document.body,
  );
}
