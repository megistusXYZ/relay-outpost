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
 * The lightbox iframe is the third-party room itself: users sign in there
 * with the room's own flow. We never inject identity or keys into it.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, Radio } from "lucide-react";
import { useBackClosable } from "@/hooks/use-back-closable";
import type { AudioSpace } from "@/lib/audio-space";

export function AudioSpaceLightbox({ space, onClose }: { space: AudioSpace; onClose: () => void }) {
  useBackClosable(true, onClose);
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="audio-space-lightbox">
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] shrink-0 text-white/90">
        {/* Always-black header: the 500 shade reads in both themes and stays
            outside the status-contrast sweep's guarded 300/400 class. */}
        <Radio className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-medium truncate">{space.room}</span>
        <span className="text-xs text-white/50 shrink-0">· {space.service}</span>
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
      <iframe
        src={space.joinUrl}
        title={`${space.service} — ${space.room}`}
        className="flex-1 w-full border-0 bg-black"
        allow="microphone; camera; autoplay; fullscreen; clipboard-write; display-capture"
        data-testid="audio-space-iframe"
      />
    </div>,
    document.body,
  );
}

export function AudioSpaceCard({ space, compact = false }: { space: AudioSpace; compact?: boolean }) {
  const [open, setOpen] = useState(false);

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
        className={`group/space flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden hover:border-primary/40 transition-colors cursor-pointer text-left ${compact ? "h-[84px]" : "h-[100px]"}`}
        data-testid="media-audio-space"
      >
        <div className={`shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center ${compact ? "w-[64px] h-[64px]" : "w-[76px] h-[76px]"}`}>
          <Radio className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-wide uppercase text-emerald-700 dark:text-emerald-400">
            Audio space · {space.service}
          </div>
          <div className="text-sm font-medium text-foreground truncate mt-0.5">{space.room}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {space.embeddable ? "Tap to listen or join — right here in the app." : `Opens on ${space.service}.`}
          </div>
        </div>
      </button>
      {open && <AudioSpaceLightbox space={space} onClose={() => setOpen(false)} />}
    </>
  );
}
