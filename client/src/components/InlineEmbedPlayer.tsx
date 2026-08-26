import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Play } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { getEmbedIframeSrc, getEmbedThumbnail } from "@/lib/media-utils";

/**
 * Shared X-style embed player for YouTube / Vimeo / Rumble.
 *
 * Renders a lightweight thumbnail "facade" with a play button; the actual
 * <iframe> is only mounted when the user taps play (YouTube) or the card
 * scrolls into view (Vimeo/Rumble). This keeps the feed fast — we never load
 * dozens of heavy player iframes at once — and removes the "image first, video
 * later" flicker since the poster thumbnail is shown instantly.
 *
 * `onPlay` lets callers run a side-effect when playback starts (the video page
 * uses it to scroll to top); the feed passes nothing so the timeline isn't
 * hijacked.
 */
export function InlineEmbedPlayer({
  type,
  embedId,
  autoplay = false,
  className = "",
  testId,
  onPlay,
}: {
  type: string;
  embedId: string;
  autoplay?: boolean;
  className?: string;
  testId?: string;
  onPlay?: () => void;
}) {
  // Click-to-play platforms (heavy player / parent-domain requirement) wait for a
  // tap; the rest muted-autoplay when scrolled into view, matching Vimeo/Rumble.
  const clickToPlay = type === "youtube" || type === "twitch";
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnail = getEmbedThumbnail(type, embedId);

  useEffect(() => {
    if (clickToPlay) return;
    if (autoplay) {
      setVisible(true);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoplay, clickToPlay]);

  const showIframe = clickToPlay ? playing : visible;

  const iframeSrc = useMemo(() => getEmbedIframeSrc(type, embedId, true), [type, embedId]);

  const handlePlay = useCallback(() => {
    setPlaying(true);
    onPlay?.();
  }, [onPlay]);

  return (
    <div ref={containerRef} className={`relative w-full h-full ${className}`} data-testid={testId}>
      {thumbnail && !iframeLoaded && (
        <img
          src={thumbnail}
          alt={`${type} video`}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      )}
      {!iframeLoaded && (
        <div
          className={`absolute inset-0 flex items-center justify-center z-10 ${!showIframe ? "cursor-pointer" : "pointer-events-none"}`}
          {...(!showIframe ? {
            role: "button",
            tabIndex: 0,
            onClick: handlePlay,
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePlay(); } },
            "aria-label": `Play ${type} video`,
          } : {})}
        >
          {!showIframe ? (
            <div className="w-16 h-11 bg-black/50 dark:bg-white/15 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </div>
          ) : (
            <RelayOutpostInlineLoader className="w-6 h-6 text-white" />
          )}
        </div>
      )}
      {showIframe && iframeSrc && (
        <iframe
          src={iframeSrc}
          className="absolute inset-0 w-full h-full z-[5]"
          {...(!clickToPlay ? { sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation allow-popups-to-escape-sandbox allow-forms" } : {})}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => setIframeLoaded(true)}
        />
      )}
    </div>
  );
}
