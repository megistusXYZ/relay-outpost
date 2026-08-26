/**
 * "This person is on air right now — watch."
 *
 * Live status existed before this and was a 9px pill tucked under the avatar on
 * one layout, absent entirely on the other. It said someone was streaming; it
 * did not offer to take you there, and at that size it lost to every other badge
 * on the page. Meanwhile the desktop identity layout — the default on desktop —
 * had no live awareness at all.
 *
 * So this is deliberately the loudest thing on a profile while it is showing,
 * and it is showing rarely: a broadcast is the most time-sensitive thing an
 * account can be doing, and unlike a post it is gone if you miss it.
 *
 * The small avatar pill stays. It is the at-a-glance marker in lists and beside
 * the picture; this is the thing you can act on.
 */
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import { Radio, Play, Users } from "lucide-react";
import { useLiveStatus } from "@/contexts/LiveStatusContext";
import { KIND_LIVE_EVENT } from "@/lib/nostr-helpers";

export function LiveNowBanner({ pubkey, className = "" }: { pubkey: string; className?: string }) {
  const { getLiveStream } = useLiveStatus();
  const stream = pubkey ? getLiveStream(pubkey) : undefined;
  if (!stream) return null;

  /**
   * The address is the AUTHOR's, never the profile's.
   *
   * These are routinely different people — the streamer hosts, the platform
   * publishes — which is the whole reason this banner can appear on a profile
   * whose owner did not author the event. Encoding the viewed profile here would
   * mint an naddr for an event that does not exist.
   */
  let href = "/live";
  try {
    href = `/live/${nip19.naddrEncode({ identifier: stream.dTag, pubkey: stream.pubkey, kind: KIND_LIVE_EVENT })}`;
  } catch { /* keep the index; a broken address must not cost the banner */ }

  const viewers = stream.currentParticipants;

  return (
    <Link
      href={href}
      className={`group block rounded-xl overflow-hidden border border-red-500/40 bg-red-500/[0.06] hover:bg-red-500/[0.10] transition-colors ${className}`}
      data-testid="profile-live-banner"
    >
      <div className="flex items-stretch gap-3 p-3">
        {stream.image && (
          // Decoration, so it earns no alt text and never blocks the row. If the
          // thumbnail 404s the banner must still read as a live banner.
          <span className="relative shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-black/20 hidden sm:block">
            <img
              src={stream.image}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          </span>
        )}

        <span className="min-w-0 flex-1 flex flex-col justify-center gap-1">
          <span className="flex items-center gap-2">
            {/* Solid red + white, not a status-tinted text colour: this pill has
                to read identically in both themes, and it is the one place on
                the page allowed to shout. */}
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider">
              {/* The one place in the app allowed a standing animation: live is
                  the industry's pulsing idiom, and a static pill undersold the
                  most time-sensitive state a profile can be in. motion-safe so
                  reduced-motion users get the calm pill. */}
              <span className="relative flex w-2.5 h-2.5 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-white/50 motion-safe:animate-ping" aria-hidden="true" />
                <Radio className="relative w-2.5 h-2.5" />
              </span>
              Live
            </span>
            {typeof viewers === "number" && viewers > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="profile-live-viewers">
                <Users className="w-3 h-3" />
                {viewers.toLocaleString()}
              </span>
            )}
          </span>
          <span className="text-sm font-medium text-foreground truncate">
            {stream.title?.trim() || "Streaming now"}
          </span>
        </span>

        <span className="shrink-0 self-center inline-flex items-center gap-1.5 rounded-full bg-red-600 group-hover:bg-red-500 text-white text-xs font-semibold px-3 py-2 transition-colors">
          <Play className="w-3.5 h-3.5" />
          Watch
        </span>
      </div>
    </Link>
  );
}
