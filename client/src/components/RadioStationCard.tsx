/**
 * An internet radio station linked in a post: Listen without leaving the app.
 *
 * Asked 2026-09-10 about Bowl After Bowl ("could we join from the post like
 * we do Corny Chat?"). The show streams through AzuraCast, radio software
 * whose stream is plain audio, so instead of embedding their web player the
 * station plays in the app's OWN audio player: it keeps playing while you
 * browse, and the header player shows it as LIVE (no seek bar, no skips).
 * The station's chat is a separate link in the same post, with its own card;
 * this card's external link opens the station's own page.
 *
 * Detection: lib/radio-station.ts (from the URL alone). Station details come
 * through our server (/api/radio/station), so rendering a post never connects
 * the viewer to the station. Only pressing Listen does, by playing the stream.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Pause, Play, Radio } from "lucide-react";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { radioTrack, type RadioStationInfo, type RadioStationRef } from "@/lib/radio-station";

export function RadioStationCard({ station, compact = false }: { station: RadioStationRef; compact?: boolean }) {
  const { data, isLoading } = useQuery<{ station: RadioStationInfo | null }>({
    queryKey: [`/api/radio/station?url=${encodeURIComponent(station.pageUrl)}`],
    staleTime: 60 * 1000,
    retry: 1,
    retryDelay: 2000,
  });
  const { currentTrack, isPlaying, isBuffering, play, togglePlay } = useAudioPlayer();
  const [artFailed, setArtFailed] = useState(false);

  const info = data?.station ?? null;
  const track = info ? radioTrack(station, info) : null;
  const isThisStation = !!track && currentTrack?.id === track.id;
  const playingThis = isThisStation && isPlaying;
  const art = info?.art && !artFailed ? info.art : null;
  const name = info?.name || station.shortcode;

  const status = info?.isLive
    ? `Live now${info.streamer ? ` · ${info.streamer}` : ""}`
    : info && !info.isOnline
      ? "Off air"
      : "Live radio";
  const detail = info?.nowPlaying
    || (isLoading ? "Tuning in…" : track ? "Listen without leaving the app." : "Opens on the station's page.");

  const onListen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track) {
      window.open(station.pageUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (isThisStation) togglePlay();
    else play(track);
  };

  return (
    <div
      /* Opaque bg-card, fixed height, stopPropagation: same contract as
         AudioSpaceCard — this renders inside clickable post cards and DM
         bubbles, and must not navigate the post underneath. */
      onClick={(e) => e.stopPropagation()}
      className={`flex w-full items-center gap-2.5 sm:gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden ${compact ? "h-[84px]" : "h-[100px]"}`}
      data-testid="media-radio-station"
    >
      <div className={`shrink-0 rounded-lg overflow-hidden bg-brand/10 border border-brand/20 flex items-center justify-center ${compact ? "w-[64px] h-[64px]" : "w-[64px] h-[64px] sm:w-[76px] sm:h-[76px]"}`}>
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setArtFailed(true)} />
        ) : (
          <Radio className="w-6 h-6 text-brand" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase ${info?.isLive ? "text-red-600 dark:text-red-400" : "text-brand"}`}>
          {info?.isLive ? (
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
          ) : (
            <Radio className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">{status}</span>
        </div>
        <div className="text-sm font-semibold text-foreground truncate mt-0.5">{name}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5" data-testid="text-radio-now-playing">{detail}</div>
      </div>
      <div className="flex items-center shrink-0">
        <a
          href={station.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="h-11 w-8 sm:w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
          aria-label={`Open ${name}'s page`}
          data-testid="link-radio-station-page"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        {/* Icon-only on phones so the station's name and what is on air keep
            their room; the label joins from sm up. 44px either way. */}
        <button
          type="button"
          onClick={onListen}
          className="inline-flex items-center justify-center gap-1.5 h-11 w-11 sm:w-auto sm:px-4 rounded-full bg-brand hover:bg-brand/90 text-white text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={playingThis ? `Pause ${name}` : `Listen to ${name}`}
          data-testid="button-radio-listen"
        >
          {isThisStation && isBuffering ? (
            <RelayOutpostInlineLoader className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          ) : playingThis ? (
            <Pause className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          ) : (
            <Play className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          )}
          <span className="hidden sm:inline">{playingThis ? "Pause" : "Listen"}</span>
        </button>
      </div>
    </div>
  );
}
