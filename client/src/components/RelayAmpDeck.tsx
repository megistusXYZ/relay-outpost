/**
 * RelayAmp — a compact "deck" that sits atop the profile's Audio · Music list
 * and makes it feel like a little player instead of a plain list. Winamp in
 * spirit (an always-on dark LCD readout + a spectrum analyzer + ⏮ ⏯ ⏭), Relay
 * Outpost in style (violet, mono, restrained — no skeuomorphic skin).
 *
 * It's a presentation layer over the global AudioPlayerContext: it reflects
 * whatever is playing and drives transport through the same queue the list
 * seeds, so ⏭/⏮ walk the tracks you're looking at.
 */
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import type { MusicTrack } from "@/lib/music";
import { Play, Pause, SkipBack, SkipForward, Music, Radio } from "lucide-react";

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Static per-bar tuning for the analyzer — stable across renders so bars don't
// jump on every state change (no Math.random at render time).
const BARS = [
  { h: 42, d: "0s" }, { h: 78, d: "0.15s" }, { h: 58, d: "0.3s" }, { h: 92, d: "0.1s" },
  { h: 66, d: "0.35s" }, { h: 100, d: "0.2s" }, { h: 48, d: "0.4s" }, { h: 84, d: "0.05s" },
  { h: 72, d: "0.25s" }, { h: 54, d: "0.45s" }, { h: 88, d: "0.12s" }, { h: 62, d: "0.32s" },
  { h: 96, d: "0.18s" }, { h: 50, d: "0.38s" },
];

export function RelayAmpDeck({ tracks }: { tracks: MusicTrack[] }) {
  const { currentTrack, isPlaying, togglePlay, next, previous, seek, play, currentTime, duration } = useAudioPlayer();

  // Is the thing playing one of THIS list's tracks? (So the deck reflects the
  // list you're on, but still shows a cross-tab track rather than going blank.)
  const inThisList = !!currentTrack && tracks.some((t) => t.id === currentTrack.id);
  const track = currentTrack;
  const isPod = track?.source === "podcast";
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const onPlayPause = () => {
    if (!track && tracks.length > 0) play(tracks[0], tracks);
    else togglePlay();
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden shadow-sm" data-testid="relay-amp-deck">
      <div className="flex items-stretch gap-3 p-3">
        {/* Cover */}
        <div className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-muted/30 ring-1 ring-border/30">
          {track?.coverUrl ? (
            <img src={track.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-primary/5">
              {isPod ? <Radio className="w-5 h-5 text-brand/40" /> : <Music className="w-5 h-5 text-brand/40" />}
            </div>
          )}
        </div>

        {/* LCD screen — always dark, so it reads as a device screen in both themes */}
        <div className="flex-1 min-w-0 rounded-lg bg-zinc-950 ring-1 ring-inset ring-brand/20 px-3 py-2 flex flex-col justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-brand/50">RelayAmp</span>
              <span className={`w-1 h-1 rounded-full ${isPlaying ? "bg-brand animate-pulse" : "bg-brand/30"}`} />
            </div>
            <p className="text-[13px] font-mono text-brand truncate leading-tight mt-0.5" data-testid="amp-title">
              {track ? track.title : "— no signal —"}
            </p>
            <p className="text-[10px] font-mono text-brand/60 truncate leading-tight">
              {track ? track.artist : "select a track below"}
            </p>
          </div>
          {/* Analyzer + time */}
          <div className="flex items-end justify-between gap-2 mt-1">
            <div className="flex items-end gap-[2px] h-3" aria-hidden="true">
              {BARS.map((b, i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-gradient-to-t from-brand to-brand"
                  style={
                    isPlaying
                      ? { height: `${b.h}%`, animation: `equalizer 0.8s ease-in-out infinite`, animationDelay: b.d }
                      : { height: "22%", opacity: 0.35 }
                  }
                />
              ))}
            </div>
            <span className="text-[10px] font-mono text-brand/80 tabular-nums shrink-0" data-testid="amp-time">
              {fmt(currentTime)} <span className="text-brand/40">/</span> {fmt(duration || track?.duration || 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Seek */}
      <div className="px-3">
        <input
          type="range"
          min={0}
          max={duration || track?.duration || 0}
          value={currentTime}
          step={1}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!track}
          aria-label="Seek"
          className="w-full h-1.5 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"
          data-testid="amp-seek"
        />
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-2 px-3 py-2.5">
        <button
          onClick={previous}
          disabled={!track}
          className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-30 transition-colors"
          aria-label="Previous track"
          data-testid="amp-prev"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={onPlayPause}
          className="w-11 h-11 rounded-full flex items-center justify-center bg-primary text-primary-foreground hover:brightness-110 shadow-sm shadow-primary/30 transition-all"
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="amp-playpause"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button
          onClick={next}
          disabled={!track}
          className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-30 transition-colors"
          aria-label="Next track"
          data-testid="amp-next"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        {inThisList && (
          <span className="ml-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/40">now playing</span>
        )}
      </div>
    </div>
  );
}
