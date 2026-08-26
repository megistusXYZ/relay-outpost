import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ExternalLink, Play, Pause, RotateCcw, RotateCw } from "lucide-react";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";
import { usePersistentMedia } from "@/contexts/PersistentMediaContext";
import { ArtistCredit } from "@/components/ArtistCredit";
import { resolveArtistLink, resolveArtistZapTarget, type ArtistCreditData } from "@/lib/artist-credit";
import { useBlossomHeal } from "@/hooks/use-blossom-heal";

export interface InlineAudioProps {
  src: string;
  waveform?: number[];
  duration?: number;
  compact?: boolean;
  coverArt?: string;
  title?: string;
  artist?: string;
  artistHref?: string;
  /** NIP-92 imeta `x` fingerprint — enables Blossom self-healing on dead links. */
  sha256?: string;
  /** NIP-92 imeta `fallback` mirror URLs. */
  fallbacks?: string[];
  /**
   * Rich artist-credit data (pubkey / Wavlake / zap-splits). When present and
   * it yields a link or a support target, the plain artist line is replaced by
   * the linked credit + subtle "Support the artist" control.
   */
  credit?: ArtistCreditData;
}

export function InlineAudio({
  src,
  waveform,
  duration,
  compact = false,
  coverArt,
  title,
  artist,
  artistHref,
  sha256,
  fallbacks,
  credit,
}: InlineAudioProps) {
  void compact;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrent] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [error, setError] = useState(false);
  // Blossom resilience: dead audio walks the bounded alternate list (imeta
  // fallbacks, then other servers by sha256 — derived from the URL if needed).
  const heal = useBlossomHeal(src, { sha256, fallbacks });
  const [coverError, setCoverError] = useState(false);
  const audioIdRef = useRef(`inline-audio-${src.slice(-16)}`);
  const { handoffAudio, claimAudio } = usePersistentMedia();
  const claimedRef = useRef(false);

  useEffect(() => {
    if (claimedRef.current) return;
    claimedRef.current = true;
    const handoff = claimAudio(src);
    if (handoff && audioRef.current) {
      audioRef.current.currentTime = handoff.currentTime;
      registerAudioSource(audioIdRef.current, () => {
        audioRef.current?.pause();
        setPlaying(false);
      });
      audioRef.current.play().catch(() => {});
    }
  }, [src, claimAudio]);

  useEffect(() => {
    const audioSrc = src;
    const el = audioRef.current;
    const audioId = audioIdRef.current;
    return () => {
      if (el && !el.paused) {
        unregisterAudioSource(audioId);
        handoffAudio(audioSrc, el.currentTime);
      }
    };
  }, [src, handoffAudio]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      unregisterAudioSource(audioIdRef.current);
    } else {
      registerAudioSource(audioIdRef.current, () => {
        audioRef.current?.pause();
        setPlaying(false);
      });
      audioRef.current.play();
    }
  }, [playing]);

  const skip = useCallback((seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.currentTime + seconds, totalDuration));
  }, [totalDuration]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const fallbackWaveform = useMemo(() => {
    const bars: number[] = [];
    let seed = 42;
    for (let i = 0; i < 40; i++) {
      seed = (seed * 16807 + 7) % 2147483647;
      bars.push((seed % 60) + 20);
    }
    return bars;
  }, []);

  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
  const normalizedWaveform = waveform && waveform.length > 0 ? waveform : fallbackWaveform;
  const maxVal = Math.max(...normalizedWaveform, 1);
  const hasRichCredit = useMemo(
    () => Boolean(credit && (resolveArtistLink(credit) || resolveArtistZapTarget(credit))),
    [credit],
  );
  const hasMeta = Boolean(coverArt || title || artist || (credit?.artist) || hasRichCredit);

  // NOTE: this return must stay below every hook — `error`/`exhausted` flip
  // mid-lifecycle, and an earlier return would change the hook order.
  if (error || heal.exhausted) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-brand p-3 rounded-xl border border-border/40 bg-muted/20"
      >
        <Play className="w-4 h-4" />
        <span className="truncate">{src}</span>
        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
      </a>
    );
  }

  return (
    <div
      className="p-3 rounded-xl border border-border/40 bg-muted/10 space-y-2"
      data-testid="media-inline-audio"
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={heal.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (!duration) setTotalDuration(e.currentTarget.duration);
        }}
        onError={() => {
          // Dead file: try the next Blossom alternate before the link fallback.
          if (!heal.advance()) setError(true);
        }}
      />

      {hasMeta && (
        <div className="flex items-center gap-3 pb-1">
          {coverArt && !coverError ? (
            <img
              src={coverArt}
              alt={title || "Cover art"}
              className="w-12 h-12 rounded-lg object-cover bg-muted/30 border border-white/5 shrink-0"
              loading="lazy"
              onError={() => setCoverError(true)}
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
              <Play className="w-5 h-5 text-brand/60" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            {title && (
              <p className="text-sm font-medium text-foreground/90 truncate">{title}</p>
            )}
            {hasRichCredit ? (
              <div className="mt-0.5">
                <ArtistCredit track={credit!} />
              </div>
            ) : (
              (credit?.artist || artist) && (
                artistHref ? (
                  <Link
                    href={artistHref}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-brand/80 hover:text-brand-strong dark:hover:text-brand hover:underline transition-colors truncate block max-w-full cursor-pointer"
                    data-testid="inline-audio-artist-link"
                  >
                    {credit?.artist || artist}
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground/80 truncate">{credit?.artist || artist}</p>
                )
              )
            )}
          </div>
        </div>
      )}

      <div
        className="flex items-end gap-[2px] h-8 cursor-pointer"
        onClick={(e) => {
          if (!audioRef.current || totalDuration <= 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          audioRef.current.currentTime = x * totalDuration;
        }}
        data-testid="audio-waveform"
      >
        {normalizedWaveform.map((val, i) => {
          const barProgress = (i / normalizedWaveform.length) * 100;
          const isActive = barProgress <= progress;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-colors ${isActive ? "bg-primary/70" : "bg-muted-foreground/20"}`}
              style={{
                height: `${Math.max((val / maxVal) * 100, 8)}%`,
                minWidth: "2px",
              }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/80 tabular-nums w-12">{formatTime(currentTime)}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => skip(-15)}
            title="Rewind 15s"
          >
            <div className="relative flex items-center justify-center">
              <RotateCcw className="w-4 h-4" />
              <span className="absolute text-[7px] font-bold mt-[1px]">15</span>
            </div>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={togglePlay}
            data-testid="button-audio-play"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => skip(30)}
            title="Forward 30s"
          >
            <div className="relative flex items-center justify-center">
              <RotateCw className="w-4 h-4" />
              <span className="absolute text-[7px] font-bold mt-[1px]">30</span>
            </div>
          </Button>
        </div>
        <span className="text-[11px] text-muted-foreground/80 tabular-nums w-12 text-right">{formatTime(totalDuration)}</span>
      </div>
    </div>
  );
}
