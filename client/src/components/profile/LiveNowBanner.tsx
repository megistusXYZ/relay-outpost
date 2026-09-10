/**
 * "This person is on air right now — watch."
 *
 * A broadcast is the most time-sensitive thing an account can be doing, and
 * unlike a post it is gone if you miss it, so while it is showing it is the
 * loudest thing on the profile. It used to be a separate red card between the
 * cover and the identity card, which cost a whole row on a phone; now the
 * COVER carries it: a red ring and glow around the banner, the broadcast
 * overlaid on it, and the whole cover is the tap target (owner request,
 * 2026-09-10). Controls already on the cover sit above the overlay (z-20).
 *
 * The small avatar pill stays. It is the at-a-glance marker in lists and
 * beside the picture; this is the thing you can act on.
 */
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Radio, Play, Users } from "lucide-react";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { KIND_LIVE_EVENT } from "@/lib/nostr-helpers";
import type { LiveEventData } from "@/lib/live-events";

type BannerStream = Pick<LiveEventData, "dTag" | "pubkey" | "title" | "currentParticipants" | "image">;

/**
 * The address is the AUTHOR's, never the profile's.
 *
 * These are routinely different people — the streamer hosts, the platform
 * publishes — which is the whole reason the live treatment can appear on a
 * profile whose owner did not author the event. Encoding the viewed profile
 * here would mint an naddr for an event that does not exist.
 */
export function liveStreamHref(stream: Pick<LiveEventData, "dTag" | "pubkey">): string {
  try {
    return `/live/${nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT })}`;
  } catch {
    return "/live";
  }
}

/** The broadcast this profile is live in, if any — the avatar pill's source. */
export function useProfileLiveStream(pubkey: string | null | undefined): LiveEventData | undefined {
  const { getLiveStream } = useLiveStatus();
  return pubkey ? getLiveStream(pubkey) : undefined;
}

/** Ring + glow for a cover that carries LiveBannerOverlay. */
export const LIVE_BANNER_RING = "ring-2 ring-red-500/70 shadow-[0_0_28px_-6px_rgba(239,68,68,0.6)]";

/**
 * Covers its (positioned) parent: scrim, LIVE pill, title, Watch. `placement`
 * picks the edge that nothing else on that cover is using.
 */
export function LiveBannerOverlay({ stream, placement = "bottom", contentClassName = "" }: {
  stream: BannerStream;
  placement?: "top" | "bottom";
  contentClassName?: string;
}) {
  const title = stream.title?.trim();
  const viewers = stream.currentParticipants;
  const top = placement === "top";
  return (
    <Link
      href={liveStreamHref(stream)}
      aria-label={title ? `Watch ${title} live` : "Watch this live stream"}
      className={`group absolute inset-0 z-10 flex ${top ? "items-start" : "items-end"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white`}
      data-testid="profile-live-banner"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 ${top ? "top-0 bg-gradient-to-b" : "bottom-0 bg-gradient-to-t"} h-3/4 from-black/80 via-black/40 to-transparent pointer-events-none`}
      />
      <span className={`relative flex w-full items-center gap-3 p-3 ${contentClassName}`}>
        <span className="min-w-0 flex-1 flex flex-col gap-1">
          <span className="flex items-center gap-2">
            {/* Solid red + white: reads the same in both themes and over any
                cover image. The one standing animation in the app — live is
                the industry's pulsing idiom; motion-safe keeps it calm for
                reduced-motion users. */}
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider">
              <span className="relative flex w-2.5 h-2.5 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-white/50 motion-safe:animate-ping" aria-hidden="true" />
                <Radio className="relative w-2.5 h-2.5" />
              </span>
              Live
            </span>
            {typeof viewers === "number" && viewers > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white/85" data-testid="profile-live-viewers">
                <Users className="w-3 h-3" />
                {viewers.toLocaleString()}
              </span>
            )}
          </span>
          <span className="text-sm font-semibold text-white truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            {title || "Streaming now"}
          </span>
        </span>
        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-red-600 group-hover:bg-red-500 text-white text-xs font-semibold px-3.5 min-h-[36px] transition-colors shadow-lg shadow-black/30">
          <Play className="w-3.5 h-3.5" />
          Watch
        </span>
      </span>
    </Link>
  );
}
