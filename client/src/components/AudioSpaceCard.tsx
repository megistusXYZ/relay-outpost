/**
 * Audio-space surfaces: the feed Join card and the in-app room lightbox.
 *
 * A Corny Chat/Nests/HiveTalk room link in a post used to render as a
 * generic gray link preview; a room that is joinable in two taps deserves a
 * card that says so. Detection and the embeddability decision live in
 * lib/audio-space.ts — embeddable services open in-app in an iframe (mic and
 * camera delegated so people can actually speak), frame-blocked ones open in
 * a browser tab, from the SAME card.
 *
 * Embedding also requires OUR OWN CSP to allow the host: server/index.ts
 * frame-src is an allowlist, and a service missing from it renders Chrome's
 * "This content is blocked" inside the lightbox (live report, 2026-08-26).
 * Promote a service to embeddable in BOTH places.
 *
 * The lightbox iframe is the third-party room itself: users sign in there
 * with the room's own flow. We never inject identity or keys into it.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink, Radio } from "lucide-react";
import { useBackClosable } from "@/hooks/use-back-closable";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import type { AudioSpace } from "@/lib/audio-space";

export function AudioSpaceLightbox({ space, onClose }: { space: AudioSpace; onClose: () => void }) {
  useBackClosable(true, onClose);
  const [frameLoaded, setFrameLoaded] = useState(false);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="audio-space-lightbox">
      <div className="flex items-center gap-2.5 px-3.5 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] shrink-0 text-white/90 border-b border-white/10">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-sm font-semibold truncate">{space.room}</span>
        <span className="text-xs text-white/50 shrink-0">{space.service}</span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <a
            href={space.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Open in browser"
            data-testid="button-audio-space-external"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
            data-testid="button-audio-space-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        {!frameLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/60 text-sm" data-testid="audio-space-loading">
            <RelayOutpostInlineLoader className="w-5 h-5" />
            Joining {space.room}…
          </div>
        )}
        <iframe
          src={space.joinUrl}
          title={`${space.service} — ${space.room}`}
          className="absolute inset-0 w-full h-full border-0 bg-transparent"
          allow="microphone; camera; autoplay; fullscreen; clipboard-write; display-capture"
          onLoad={() => setFrameLoaded(true)}
          data-testid="audio-space-iframe"
        />
      </div>
    </div>,
    document.body,
  );
}

export function AudioSpaceCard({ space, compact = false }: { space: AudioSpace; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  // The service's own artwork (e.g. the Corny Chat corn) via the same
  // server-proxied OpenGraph endpoint every link card uses — no hardcoded
  // logo assets to go stale. The Radio glyph is the no-art fallback state.
  const { data: ogData } = useQuery<{ image?: string }>({
    queryKey: [`/api/og?url=${encodeURIComponent(space.joinUrl)}`],
    staleTime: 60 * 60 * 1000,
    retry: 1,
    retryDelay: 2000,
  });
  const art = ogData?.image && !artFailed ? ogData.image : null;

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (space.embeddable) setOpen(true);
          else window.open(space.joinUrl, "_blank", "noopener,noreferrer");
        }}
        /* Opaque bg-card, fixed height, stopPropagation: same contract as
           GroupInviteCard — this renders inside clickable post cards and DM
           bubbles, and must not navigate the post underneath. */
        className={`group/space flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden hover:border-emerald-500/50 transition-colors cursor-pointer text-left ${compact ? "h-[84px]" : "h-[100px]"}`}
        data-testid="media-audio-space"
      >
        <div className={`shrink-0 rounded-lg overflow-hidden bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center ${compact ? "w-[64px] h-[64px]" : "w-[76px] h-[76px]"}`}>
          {art ? (
            <img
              src={art}
              alt={space.service}
              className="w-full h-full object-contain p-1"
              loading="lazy"
              onError={() => setArtFailed(true)}
            />
          ) : (
            <Radio className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase text-emerald-700 dark:text-emerald-400">
            <Radio className="w-3 h-3 shrink-0" />
            Audio space · {space.service}
          </div>
          <div className="text-sm font-semibold text-foreground truncate mt-0.5">{space.room}</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {space.embeddable ? "Listen or hop in — without leaving the app." : `Opens on ${space.service}.`}
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1.5 h-8 px-4 rounded-full bg-emerald-600 group-hover/space:bg-emerald-500 text-white text-xs font-semibold transition-colors" data-testid="button-audio-space-join">
          Join
        </span>
      </button>
      {open && <AudioSpaceLightbox space={space} onClose={() => setOpen(false)} />}
    </>
  );
}
