/**
 * Full-screen "channel surf" video theater — plays ONE video at a time (so a
 * grid of clips never all autoplay at once), with ◀ ▶ to flip through them like
 * channels, a position counter, and a thumbnail strip to jump.
 *
 * Rendered through a portal to <body> and pinned at z-[9999]: the profile page
 * sits inside transformed/glass containers, and a bare `position: fixed` would
 * anchor to THAT container (landing at the top of the page, not locking scroll).
 * Portaling + body scroll-lock is the same pattern ImageLightbox/VideoLightbox
 * use, and is what makes this behave like a real full-screen overlay.
 *
 * The current <video> carries native `controls` — volume, scrubber, fullscreen,
 * PiP — and is the only element that plays; strip thumbnails are muted,
 * metadata-only posters, so exactly one stream is ever active.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { LazyVideoPoster } from "@/components/LazyVideoPoster";

export function VideoChannelTheater({ urls, startIndex, onClose }: { urls: string[]; startIndex: number; onClose: () => void }) {
  const [i, setI] = useState(Math.max(0, Math.min(startIndex, urls.length - 1)));
  const many = urls.length > 1;
  const go = useCallback((d: number) => setI((p) => (p + d + urls.length) % urls.length), [urls.length]);

  // Esc closes. (Arrow keys are left to the native video controls for ±seek —
  // channel-surfing is the on-screen ◀ ▶ / thumbnail strip, so the two don't clash.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock background scroll while the theater is open, restore on close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const current = urls[i];

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col select-none" data-testid="video-channel-theater" onClick={onClose}>
      {/* Top bar — scrim so the counter/close read over bright footage */}
      <div
        className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 shrink-0 bg-gradient-to-b from-black/70 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-white/80 text-sm tabular-nums font-medium" data-testid="theater-counter">
          {i + 1} <span className="text-white/40">/</span> {urls.length}
        </span>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium pl-3 pr-2.5 py-1.5 transition-colors"
          aria-label="Close video"
          data-testid="theater-close"
        >
          Close
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stage */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative px-2" onClick={(e) => e.stopPropagation()}>
        {many && (
          <button onClick={() => go(-1)} className="absolute left-2 md:left-6 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" aria-label="Previous video" data-testid="theater-prev">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {/* keyed by url → remounts on channel change, so only ONE video element exists */}
        <video
          key={current}
          src={current}
          controls
          autoPlay
          playsInline
          className="max-h-full max-w-full object-contain rounded-lg"
          data-testid="theater-video"
        />
        {many && (
          <button onClick={() => go(1)} className="absolute right-2 md:right-6 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors" aria-label="Next video" data-testid="theater-next">
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Channel strip */}
      {many && (
        <div className="shrink-0 flex gap-2 overflow-x-auto px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] bg-gradient-to-t from-black/70 to-transparent" onClick={(e) => e.stopPropagation()}>
          {urls.map((u, idx) => (
            <button
              key={u}
              onClick={() => setI(idx)}
              className={`shrink-0 w-20 h-12 rounded-md overflow-hidden ring-2 transition-all ${idx === i ? "ring-primary" : "ring-transparent opacity-50 hover:opacity-90"}`}
              aria-label={`Video ${idx + 1}`}
              data-testid={`theater-thumb-${idx}`}
            >
              <LazyVideoPoster src={u} className="w-full h-full" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
