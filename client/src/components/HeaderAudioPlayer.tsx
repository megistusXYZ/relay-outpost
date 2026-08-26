import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTTS, type EdgeVoice, RECOMMENDED_VOICES } from "@/contexts/TextToSpeechContext";
import { useAudioPlayer } from "@/contexts/AudioPlayerContext";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  AudioLines,
  Music2,
  ChevronDown,
  ChevronUp,
  Volume2,
  VolumeX,
  ExternalLink,
  Square,
  Star,
  Gauge,
  Share2,
  Send,
  Rewind,
  FastForward,
  ListMusic,
  GripVertical,
  ArrowUp,
  ArrowDown,
  User } from "lucide-react";
import { ZapDialog } from "@/components/ZapDialog";
import { ShareTrackDialog } from "@/pages/AudioFeed";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle } from "@/components/ui/alert-dialog";
import { getCachedProfile, publishEvent, eventStore, getEventRelays } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { getProfileContent, KIND_REPOST, getRelayHintForEvent, clientTags } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { resolveWavlakeArtistPubkey, ensureWavlakeMapLoaded } from "@/lib/music";
import { useLocation } from "wouter";
import { nip19 } from "nostr-tools";
import { useIsMobile } from "@/hooks/use-mobile";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";
import { useSyncExternalStore } from "react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { ChapterSection, TranscriptSection } from "@/components/PodcastExtras";
import { usePodcastChapters } from "@/hooks/use-podcast-extras";

const TTS_RATES = [1, 1.25, 1.5, 1.75, 2];
const VOICE_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const MUSIC_RATE_OPTIONS = [0.8, 1, 1.25, 1.5, 1.75, 2];
const SKIP_BACK_SECONDS = 15;
const SKIP_FORWARD_SECONDS = 30;

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatVoiceName(name: string): string {
  return name
    .replace("Microsoft Server Speech Text to Speech Voice ", "")
    .replace(/\(.*\)/, "")
    .replace(/Microsoft\s*/gi, "")
    .replace(/\bOnline\b/gi, "")
    .replace(/\bNeural\b/gi, "")
    .replace(/\bMultilingual\b/gi, "")
    .replace(/\s{2 }/g, " ")
    .trim();
}

function CompactSeekBar({
  progress,
  onSeek,
  colorClass,
  bgClass }: {
  progress: number;
  onSeek: (pct: number) => void;
  colorClass: string;
  bgClass: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const calcPct = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSeek(calcPct(e.clientX));
  }, [onSeek, calcPct]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    dragging.current = true;
    onSeek(calcPct(e.touches[0].clientX));
  }, [onSeek, calcPct]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    onSeek(calcPct(e.touches[0].clientX));
  }, [onSeek, calcPct]);

  const handleTouchEnd = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <div
      className="absolute bottom-0 left-0 right-0 h-5 md:h-3 flex items-end pointer-events-none"
      data-testid="header-audio-seekbar"
    >
      <div
        ref={barRef}
        className={`w-full h-[3px] md:h-[2px] overflow-hidden ${bgClass} cursor-pointer touch-none pointer-events-auto`}
        style={{ touchAction: "none" }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`h-full ${colorClass} transition-[width] duration-150 ease-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function ExpandedSeekBar({
  progress,
  duration,
  seek,
  currentTime,
  markers }: {
  progress: number;
  duration: number;
  seek: (time: number) => void;
  currentTime: number;
  /** Chapter start positions as percentages (0-100) — rendered as tick marks. */
  markers?: number[];
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);

  const calcProgress = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return 0;
      const rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [duration]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const pct = calcProgress(e.clientX);
      seek(pct * duration);
    },
    [duration, seek, calcProgress]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      setDragging(true);
      setDragProgress(calcProgress(e.touches[0].clientX));
    },
    [duration, calcProgress]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!dragging || duration <= 0) return;
      setDragProgress(calcProgress(e.touches[0].clientX));
    },
    [dragging, duration, calcProgress]
  );

  const handleTouchEnd = useCallback(() => {
    if (dragging && duration > 0) {
      seek(dragProgress * duration);
    }
    setDragging(false);
  }, [dragging, dragProgress, duration, seek]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      setDragging(true);
      setDragProgress(calcProgress(e.clientX));
      const onMove = (ev: MouseEvent) => {
        const bar = barRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        setDragProgress(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)));
      };
      const onUp = (ev: MouseEvent) => {
        const bar = barRef.current;
        if (bar) {
          const rect = bar.getBoundingClientRect();
          const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          seek(p * duration);
        }
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [duration, seek, calcProgress]
  );

  const displayProgress = dragging ? dragProgress * 100 : progress;
  const displayTime = dragging ? dragProgress * duration : currentTime;

  return (
    <div className="flex items-center gap-2.5 w-full">
      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right shrink-0">
        {formatTime(displayTime)}
      </span>
      <div
        ref={barRef}
        className="flex-1 h-6 cursor-pointer group relative select-none touch-none flex items-center"
        style={{ touchAction: "none" }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration) || 0}
        aria-valuenow={Math.floor(displayTime) || 0}
        aria-valuetext={`${formatTime(displayTime)} of ${formatTime(duration)}`}
        data-testid="header-expanded-seekbar"
      >
        {/* Track — clearly visible so the whole scrub range reads as draggable. */}
        <div className="absolute left-0 right-0 h-[5px] bg-foreground/15 rounded-full overflow-hidden group-hover:h-1.5 transition-[height]">
          <div
            className="h-full bg-primary rounded-full transition-[width] duration-75"
            style={{ width: `${displayProgress}%` }}
          />
          {/* Chapter tick marks — static positions, cheap to paint. */}
          {markers?.map((pct, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-background/70"
              style={{ left: `${pct}%` }}
            />
          ))}
        </div>
        {/* Always-visible handle at the playhead → signals you can drag/scrub. */}
        <div
          className="absolute"
          style={{ left: `${displayProgress}%`, top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <div
            className={`rounded-full bg-primary ring-2 ring-background shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform ${dragging ? "w-4 h-4 scale-110" : "w-3.5 h-3.5 group-hover:scale-110"}`}
          />
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums w-9 shrink-0">
        {formatTime(duration)}
      </span>
    </div>
  );
}

const previewStore = {
  activeVoiceId: null as string | null,
  audio: null as HTMLAudioElement | null,
  sessionId: 0,
  listeners: new Set<() => void>(),
  subscribe(cb: () => void) { previewStore.listeners.add(cb); return () => { previewStore.listeners.delete(cb); }; },
  getSnapshot() { return previewStore.activeVoiceId; },
  notify() { previewStore.listeners.forEach((fn) => fn()); },
  stop() {
    previewStore.sessionId++;
    previewStore.activeVoiceId = null;
    if (previewStore.audio) {
      previewStore.audio.pause();
      previewStore.audio.src = "";
      previewStore.audio = null;
      unregisterAudioSource("voice-preview");
    }
    previewStore.notify();
  } };

function VoicePreviewButton({ voiceId }: { voiceId: string }) {
  const activeVoice = useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot);
  const isActive = activeVoice === voiceId;

  const handlePreview = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const wasThisPlaying = previewStore.activeVoiceId === voiceId;
    previewStore.stop();
    if (wasThisPlaying) return;

    previewStore.activeVoiceId = voiceId;
    previewStore.notify();
    const session = ++previewStore.sessionId;
    try {
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Welcome to Relay Outpost. This is how I'll sound as I read your feed, your articles, and everything in between.", voice: voiceId }) });
      if (session !== previewStore.sessionId) return;
      if (!resp.ok) throw new Error("Preview failed");
      const blob = await resp.blob();
      if (session !== previewStore.sessionId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const onDone = () => { URL.revokeObjectURL(url); previewStore.activeVoiceId = null; previewStore.audio = null; unregisterAudioSource("voice-preview"); previewStore.notify(); };
      previewStore.audio = audio;
      registerAudioSource("voice-preview", () => { audio.pause(); audio.src = ""; onDone(); });
      audio.onended = onDone;
      audio.onerror = onDone;
      await audio.play();
    } catch {
      if (session === previewStore.sessionId) { previewStore.activeVoiceId = null; previewStore.notify(); }
    }
  }, [voiceId]);

  return (
    <button
      onClick={handlePreview}
      className={`shrink-0 w-7 h-7 md:w-5 md:h-5 rounded-full flex items-center justify-center transition-colors ${
        isActive ? "bg-brand/20 text-brand" : "hover:bg-muted/30 text-muted-foreground/40"
      }`}
      title={isActive ? "Stop preview" : "Preview voice"}
    >
      {isActive ? <Square className="w-3 h-3 md:w-2.5 md:h-2.5 fill-current" /> : <Play className="w-3 h-3 md:w-2.5 md:h-2.5" />}
    </button>
  );
}

function UpNextList() {
  const { queue, queueIndex, jumpTo, removeFromQueue, reorderQueue } = useAudioPlayer();
  const isMobile = useIsMobile();
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Only the tracks AFTER the current one are "up next".
  const upNext = queue
    .map((track, index) => ({ track, index }))
    .filter(({ index }) => index > queueIndex);

  const handleDrop = useCallback((toIndex: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from == null || from === toIndex) return;
    reorderQueue(from, toIndex);
  }, [reorderQueue]);

  return (
    <div className="pt-2 md:pt-1.5 border-t border-border/15 dark:border-brand/10">
      <div className="flex items-center gap-1.5 mb-2 md:mb-1.5 px-0.5 text-muted-foreground/60">
        <ListMusic className="w-4 h-4 md:w-3.5 md:h-3.5" />
        <span className="text-xs md:text-[11px] font-medium">Up Next</span>
        {upNext.length > 0 && (
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">{upNext.length}</span>
        )}
      </div>
      {upNext.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/40 px-0.5 py-2">Nothing queued</p>
      ) : (
        <div className="max-h-48 md:max-h-44 overflow-y-auto -mx-1 px-1 space-y-0.5">
          {upNext.map(({ track, index }, listPos) => (
            <div
              key={`${track.id}-${index}`}
              className={`flex items-center gap-2 rounded-lg px-1 py-1 min-h-[44px] transition-colors group ${
                dragOver === index ? "bg-primary/10" : "hover:bg-muted/15"
              }`}
              draggable={!isMobile}
              onDragStart={() => { dragFrom.current = index; }}
              onDragOver={(e) => { if (!isMobile) { e.preventDefault(); setDragOver(index); } }}
              onDragLeave={() => { if (dragOver === index) setDragOver(null); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(index); }}
              data-testid="up-next-row"
            >
              {!isMobile && (
                <span className="shrink-0 text-muted-foreground/30 group-hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing" title="Drag to reorder">
                  <GripVertical className="w-3.5 h-3.5" />
                </span>
              )}
              <button
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
                onClick={() => jumpTo(index)}
                title={`Play "${track.title}"`}
              >
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0 border border-primary/10" />
                ) : (
                  <div className="w-9 h-9 rounded bg-brand/5 dark:bg-brand/10 shrink-0 flex items-center justify-center border border-brand/10">
                    <Music2 className="w-4 h-4 text-brand/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs md:text-[12px] font-medium text-foreground/80 truncate leading-tight">{track.title}</p>
                  <p className="text-[11px] text-muted-foreground/50 truncate leading-tight mt-0.5">{track.artist}</p>
                </div>
              </button>
              {isMobile && (
                <div className="flex flex-col shrink-0">
                  <button
                    className="w-9 h-[22px] flex items-center justify-center text-muted-foreground/40 hover:text-foreground disabled:opacity-25"
                    onClick={() => reorderQueue(index, index - 1)}
                    disabled={listPos === 0}
                    title="Move up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="w-9 h-[22px] flex items-center justify-center text-muted-foreground/40 hover:text-foreground disabled:opacity-25"
                    onClick={() => reorderQueue(index, index + 1)}
                    disabled={listPos === upNext.length - 1}
                    title="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <button
                className="shrink-0 w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-muted-foreground/40 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors"
                onClick={() => removeFromQueue(index)}
                title="Remove from queue"
                data-testid="up-next-remove"
              >
                <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpandedMusicPanel({
  onCollapse }: {
  onCollapse: () => void;
}) {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    togglePlay,
    seek,
    skip,
    setVolume,
    playbackRate,
    setPlaybackRate,
    next,
    previous,
    queueIndex,
    queue,
    stop } = useAudioPlayer();
  const [muted, setMuted] = useState(false);
  const [prevVolume, setPrevVolume] = useState(0.8);
  const [showSpeed, setShowSpeed] = useState(false);
  const [zapOpen, setZapOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [isReposting, setIsReposting] = useState(false);
  const [repostConfirmOpen, setRepostConfirmOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { signer } = useNostrAuth();

  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (currentTrack?.artistId && !currentTrack?.artistPubkey) {
      let cancelled = false;
      ensureWavlakeMapLoaded().then(() => {
        if (!cancelled) setMapLoaded(true);
      });
      return () => { cancelled = true; };
    }
  }, [currentTrack?.artistId, currentTrack?.artistPubkey]);

  const effectivePubkey = useMemo(() => {
    if (currentTrack?.artistPubkey) return currentTrack.artistPubkey;
    if (currentTrack?.artistId) return resolveWavlakeArtistPubkey(currentTrack.artistId);
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.artistPubkey, currentTrack?.artistId, mapLoaded]);

  const confirmRepost = useCallback(async () => {
    if (!currentTrack?.event) return;
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to repost.", variant: "destructive" });
      return;
    }
    setRepostConfirmOpen(false);
    setIsReposting(true);
    try {
      const ev = currentTrack.event;
      const hint = getRelayHintForEvent(ev.id, getEventRelays);
      const repostKind = ev.kind === 1 ? KIND_REPOST : 16;
      const tags: string[][] = [
        ["e", ev.id, hint || ""],
        ["p", ev.pubkey, hint || ""],
        ["k", String(ev.kind)],
        ...clientTags(),
      ];
      const eventTemplate = {
        kind: repostKind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(ev) };
      const signedEvent = await signWithTimeout(signer, eventTemplate);
      const { relays: userRelays, userSelected: isUserSelected } = getPublishTarget();
      await publishEvent(signedEvent, userRelays, ev.pubkey, isUserSelected);
      eventStore.add(signedEvent);
      toast({ title: "Reposted", description: `Shared "${currentTrack.title}" to your followers.` });
    } catch (err) {
      console.error(err);
      toast({ title: "Failed", description: "Could not repost.", variant: "destructive" });
    } finally {
      setIsReposting(false);
    }
  }, [currentTrack, signer, toast]);

  const handleRepost = useCallback(() => {
    if (!currentTrack?.event) return;
    if (!signer) {
      toast({ title: "Sign in required", description: "Sign in to repost.", variant: "destructive" });
      return;
    }
    setRepostConfirmOpen(true);
  }, [currentTrack, signer, toast]);

  const toggleMute = useCallback(() => {
    if (muted) {
      setVolume(prevVolume);
      setMuted(false);
    } else {
      setPrevVolume(volume);
      setVolume(0);
      setMuted(true);
    }
  }, [muted, volume, prevVolume, setVolume]);

  const artistProfile = useMemo(() => {
    if (!effectivePubkey) return null;
    const cached = getCachedProfile(effectivePubkey);
    if (!cached) return null;
    return getProfileContent(cached);
  }, [effectivePubkey]);

  const artistAvatarUrl = currentTrack?.artistAvatarUrl || artistProfile?.picture || null;

  const canNavigateToArtist = !!(effectivePubkey || currentTrack?.artistId);

  // Podcasting 2.0 extras — empty arrays / undefined URLs render nothing at all.
  const chapters = usePodcastChapters(currentTrack?.chaptersUrl);
  const chapterMarkers = useMemo(() => {
    if (chapters.length === 0 || duration <= 0) return undefined;
    const pcts = chapters
      .map((ch) => (ch.startTime / duration) * 100)
      .filter((p) => p > 0.5 && p < 99.5);
    return pcts.length > 0 ? pcts : undefined;
  }, [chapters, duration]);

  const navigateToArtist = useCallback(() => {
    if (currentTrack?.artistId) {
      navigate(`/audio?artist=${currentTrack.artistId}`);
      return;
    }
    if (!effectivePubkey) return;
    try {
      const npub = nip19.npubEncode(effectivePubkey);
      navigate(`/profile/${npub}`);
    } catch {}
  }, [effectivePubkey, currentTrack?.artistId, navigate]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasNext = queueIndex < queue.length - 1;
  const hasPrev = queueIndex > 0 || currentTime > 3;

  return (
    <>
      <div className="p-4 md:p-3.5 space-y-4 md:space-y-3">
        <div className="flex items-center gap-4 md:gap-3">
          {artistAvatarUrl && canNavigateToArtist ? (
            <img
              src={artistAvatarUrl}
              alt={currentTrack.artist}
              className="w-14 h-14 md:w-11 md:h-11 rounded-lg object-cover shrink-0 border border-brand/15 dark:border-brand/20 cursor-pointer hover:border-brand/50 transition-colors ring-1 ring-primary/5"
              onClick={navigateToArtist}
            />
          ) : currentTrack.coverUrl ? (
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="w-14 h-14 md:w-11 md:h-11 rounded-lg object-cover shrink-0 border border-primary/10"
            />
          ) : (
            <div className="w-14 h-14 md:w-11 md:h-11 rounded-lg bg-brand/5 dark:bg-brand/10 shrink-0 flex items-center justify-center border border-brand/10">
              <Music2 className="w-6 h-6 md:w-5 md:h-5 text-brand/60" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm md:text-[13px] font-medium text-foreground/90 leading-snug line-clamp-2">
              {currentTrack.title}
            </p>
            {canNavigateToArtist ? (
              <button
                className="text-xs md:text-[11px] text-brand/70 truncate cursor-pointer hover:text-brand transition-colors text-left bg-transparent border-none p-0 block max-w-full mt-0.5"
                onClick={navigateToArtist}
              >
                {currentTrack.artist}
              </button>
            ) : (
              <p className="text-xs md:text-[11px] text-muted-foreground/60 truncate mt-0.5">
                {currentTrack.artist}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 md:gap-0.5 shrink-0">
            {canNavigateToArtist && (
              <button
                className="w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-brand/60 hover:text-brand hover:bg-brand/10 transition-colors"
                onClick={() => { onCollapse(); navigateToArtist(); }}
                title="Go to artist"
              >
                <User className="w-5 h-5 md:w-4 md:h-4" />
              </button>
            )}
            {effectivePubkey && (
              <button
                className="w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-amber-500/60 hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                onClick={() => setZapOpen(true)}
                title="Zap artist"
              >
                <BtcZapIcon className="w-5 h-5 md:w-4 md:h-4" />
              </button>
            )}
            <button
              className="w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/20 transition-colors"
              onClick={onCollapse}
              title="Collapse"
            >
              <ChevronUp className="w-5 h-5 md:w-4 md:h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-3 md:space-y-2">
          <div className="flex items-center justify-center gap-2 md:gap-1">
            <button className="h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors" onClick={previous} disabled={!hasPrev} title="Previous track">
              <SkipBack className="w-5 h-5 md:w-4 md:h-4" />
            </button>
            <button
              className="relative h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors"
              onClick={() => skip(-SKIP_BACK_SECONDS)}
              title={`Back ${SKIP_BACK_SECONDS}s`}
              data-testid="button-music-skip-back"
            >
              <Rewind className="w-5 h-5 md:w-4 md:h-4" />
              <span className="absolute -bottom-0.5 text-[8px] font-bold tabular-nums leading-none">{SKIP_BACK_SECONDS}</span>
            </button>
            <button
              className="h-12 w-12 md:h-9 md:w-9 rounded-full flex items-center justify-center bg-brand/10 dark:bg-brand/15 hover:bg-brand/20 text-foreground transition-all shadow-[0_0_8px_rgba(139,92,246,0.15)] dark:shadow-[0_0_12px_rgba(139,92,246,0.2)] hover:shadow-[0_0_14px_rgba(139,92,246,0.25)] dark:hover:shadow-[0_0_18px_rgba(139,92,246,0.3)]"
              onClick={togglePlay}
              disabled={isBuffering}
            >
              {isBuffering ? <RelayOutpostInlineLoader className="w-5 h-5 md:w-4.5 md:h-4.5" /> : isPlaying ? <Pause className="w-5 h-5 md:w-4.5 md:h-4.5" /> : <Play className="w-5 h-5 md:w-4.5 md:h-4.5 ml-0.5" />}
            </button>
            <button
              className="relative h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors"
              onClick={() => skip(SKIP_FORWARD_SECONDS)}
              title={`Forward ${SKIP_FORWARD_SECONDS}s`}
              data-testid="button-music-skip-forward"
            >
              <FastForward className="w-5 h-5 md:w-4 md:h-4" />
              <span className="absolute -bottom-0.5 text-[8px] font-bold tabular-nums leading-none">{SKIP_FORWARD_SECONDS}</span>
            </button>
            <button className="h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors" onClick={next} disabled={!hasNext} title="Next track">
              <SkipForward className="w-5 h-5 md:w-4 md:h-4" />
            </button>
          </div>
          <ExpandedSeekBar
            progress={progress}
            duration={duration}
            seek={seek}
            currentTime={currentTime}
            markers={chapterMarkers}
          />
        </div>

        <div className="flex items-center justify-between pt-2 md:pt-1.5 border-t border-border/15 dark:border-brand/10">
          <div className="flex items-center gap-2 flex-1 max-w-[160px] md:max-w-[140px]">
            <button className="shrink-0 w-9 h-9 md:w-auto md:h-auto flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors" onClick={toggleMute}>
              {muted || volume === 0 ? <VolumeX className="w-4 h-4 md:w-3.5 md:h-3.5" /> : <Volume2 className="w-4 h-4 md:w-3.5 md:h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              className="w-full h-1 accent-primary cursor-pointer"
              style={{ fontSize: 16 }}
            />
          </div>
          <div className="flex items-center gap-1 md:gap-0.5 shrink-0">
            <div className="relative">
              <button
                className="h-9 md:h-7 px-2 rounded-lg flex items-center gap-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors shrink-0"
                onClick={() => setShowSpeed((v) => !v)}
                title="Playback speed"
                data-testid="button-music-speed"
              >
                <Gauge className="w-4 h-4 md:w-3.5 md:h-3.5" />
                <span className="text-xs md:text-[11px] font-medium tabular-nums">{playbackRate}x</span>
              </button>
              {showSpeed && (
                <div className="absolute bottom-full right-0 mb-1.5 z-10 flex flex-col gap-0.5 p-1 rounded-lg border border-border/30 dark:border-brand/15 bg-popover shadow-xl min-w-[3.5rem]">
                  {MUSIC_RATE_OPTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => { setPlaybackRate(r); setShowSpeed(false); }}
                      className={`px-2.5 py-2 md:py-1.5 rounded-md text-xs md:text-[11px] font-medium tabular-nums text-center transition-colors ${
                        playbackRate === r
                          ? "bg-brand/15 text-brand dark:bg-brand/20"
                          : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/15"
                      }`}
                    >
                      {r}x
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="w-9 h-9 md:w-7 md:h-7 rounded-lg flex items-center justify-center text-brand/70 hover:text-brand hover:bg-brand/10 transition-colors shrink-0"
              onClick={() => setShareOpen(true)}
              title="Share"
              data-testid="button-header-player-share"
            >
              <Send className="w-4 h-4 md:w-3.5 md:h-3.5" />
            </button>
            {currentTrack.event && (
              <button
                className="w-9 h-9 md:w-7 md:h-7 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/15 transition-colors shrink-0 disabled:opacity-40"
                onClick={handleRepost}
                disabled={isReposting}
                title="Repost"
                data-testid="button-header-player-repost"
              >
                {isReposting ? <RelayOutpostInlineLoader className="w-4 h-4 md:w-3.5 md:h-3.5" /> : <Share2 className="w-4 h-4 md:w-3.5 md:h-3.5" />}
              </button>
            )}
          </div>
        </div>

        <ChapterSection chapters={chapters} currentTime={currentTime} onSeek={seek} />

        <TranscriptSection
          transcriptUrl={currentTrack.transcriptUrl}
          transcriptType={currentTrack.transcriptType}
          currentTime={currentTime}
          onSeek={seek}
        />

        <UpNextList />
      </div>

      <ShareTrackDialog
        track={currentTrack}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {effectivePubkey && (
        <ZapDialog
          open={zapOpen}
          onOpenChange={setZapOpen}
          pubkey={effectivePubkey}
          event={currentTrack.event}
          recipientName={currentTrack.artist}
        />
      )}

      <AlertDialog open={repostConfirmOpen} onOpenChange={setRepostConfirmOpen}>
        <AlertDialogContent className="glass-dialog max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Repost</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="flex items-start gap-3 px-1 py-2">
            {currentTrack.coverUrl ? (
              <img
                src={currentTrack.coverUrl}
                alt={currentTrack.title}
                className="w-14 h-14 rounded-lg object-cover shrink-0 border border-primary/15"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-brand/[0.08] dark:bg-brand/12 shrink-0 flex items-center justify-center border border-brand/10">
                <Music2 className="w-6 h-6 text-brand/60" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2">
                {currentTrack.title}
              </p>
              <p className="text-[12px] text-brand/70 mt-0.5 truncate">
                {currentTrack.artist}
              </p>
              {currentTrack.genre && (
                <p className="text-[11px] text-muted-foreground/50 mt-1 truncate">
                  {currentTrack.genre}
                </p>
              )}
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground/70 leading-relaxed px-1">
            This will share this track with your followers by publishing a repost to your relays.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRepost}>
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Repost
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ExpandedTTSPanel({
  onCollapse }: {
  onCollapse: () => void;
}) {
  const {
    isReading,
    isPaused,
    isLoading,
    title,
    sourceUrl,
    progress,
    currentSentence,
    totalSentences,
    rate,
    voice,
    voices,
    togglePause,
    stop,
    skipForward,
    skipBack,
    setRate,
    setVoice,
    seekToChunk,
    inline,
    multiVoice } = useTTS();
  const [showVoices, setShowVoices] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [, navigate] = useLocation();

  const currentVoiceName = useMemo(() => {
    if (!voice) return "Default";
    const found = Array.isArray(voices) ? voices.find((v) => v.shortName === voice) : undefined;
    if (!found) return voice.replace("Neural", "").replace(/^en-\w+-/, "");
    return formatVoiceName(found.name);
  }, [voice, voices]);

  const recommended = useMemo(() =>
    Array.isArray(voices) ? voices.filter((v) => RECOMMENDED_VOICES.includes(v.shortName)) : [],
    [voices]
  );

  if (!isReading || inline) return null;

  const handleSeek = (pct: number) => {
    const target = Math.round(pct * totalSentences);
    seekToChunk(target);
  };

  return (
    <div className="p-4 md:p-3.5 space-y-4 md:space-y-3">
      <div className="flex items-center gap-4 md:gap-3">
        <div className="w-12 h-12 md:w-10 md:h-10 rounded-lg bg-primary/8 dark:bg-primary/12 border border-primary/15 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(139,92,246,0.08)] dark:shadow-[0_0_10px_rgba(139,92,246,0.15)]">
          {isLoading ? <RelayOutpostInlineLoader className="w-5 h-5 md:w-4.5 md:h-4.5 text-brand/70" /> : <AudioLines className="w-5 h-5 md:w-4.5 md:h-4.5 text-brand/70" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm md:text-[13px] font-medium text-foreground/90 leading-snug line-clamp-2">
            {title}
          </p>
          <p className="text-xs md:text-[11px] text-muted-foreground/60 mt-0.5">
            {isLoading ? "Generating..." : `Section ${currentSentence} of ${totalSentences}`}
          </p>
        </div>
        <div className="flex items-center gap-1 md:gap-0.5 shrink-0">
          {sourceUrl && (
            <button className="w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/20 transition-colors" onClick={() => navigate(sourceUrl)} title="Go to source">
              <ExternalLink className="w-4 h-4 md:w-3.5 md:h-3.5" />
            </button>
          )}
          <button
            className="w-10 h-10 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/20 transition-colors"
            onClick={onCollapse}
            title="Collapse"
          >
            <ChevronUp className="w-5 h-5 md:w-4 md:h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-3 md:space-y-2">
        <div className="flex items-center gap-2 w-full">
          <span className="text-[11px] text-muted-foreground/50 tabular-nums w-8 text-right shrink-0">
            {Math.round(progress)}%
          </span>
          <div
            className="flex-1 h-6 md:h-1.5 relative rounded-full bg-muted/15 dark:bg-muted/10 cursor-pointer group touch-none flex items-center"
            style={{ touchAction: "none" }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              handleSeek(pct);
            }}
            onTouchStart={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
              handleSeek(pct);
            }}
          >
            <div className="absolute left-0 right-0 h-1.5 bg-muted/15 dark:bg-muted/10 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-primary/60 rounded-full transition-[width] duration-300 ease-out shadow-[0_0_6px_rgba(139,92,246,0.3)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              className="absolute rounded-full bg-primary shadow-[0_0_8px_rgba(139,92,246,0.4)] md:hidden"
              style={{
                width: 14,
                height: 14,
                top: "50%",
                left: `${progress}%`,
                transform: "translate(-50%, -50%)" }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">
            {currentSentence}/{totalSentences}
          </span>
        </div>

        <div className="flex items-center justify-center gap-3 md:gap-1">
          <button className="h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors" onClick={skipBack} disabled={isLoading}>
            <SkipBack className="w-5 h-5 md:w-4 md:h-4" />
          </button>
          <button
            className="h-12 w-12 md:h-9 md:w-9 rounded-full flex items-center justify-center bg-primary/10 dark:bg-primary/15 hover:bg-primary/20 text-foreground transition-all shadow-[0_0_8px_rgba(139,92,246,0.15)] dark:shadow-[0_0_12px_rgba(139,92,246,0.2)] hover:shadow-[0_0_14px_rgba(139,92,246,0.25)] dark:hover:shadow-[0_0_18px_rgba(139,92,246,0.3)]"
            onClick={togglePause}
            disabled={isLoading}
          >
            {isLoading ? <RelayOutpostInlineLoader className="w-5 h-5 md:w-4.5 md:h-4.5" /> : isPaused ? <Play className="w-5 h-5 md:w-4.5 md:h-4.5 ml-0.5" /> : <Pause className="w-5 h-5 md:w-4.5 md:h-4.5" />}
          </button>
          <button className="h-11 w-11 md:h-8 md:w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/15 transition-colors" onClick={skipForward} disabled={isLoading}>
            <SkipForward className="w-5 h-5 md:w-4 md:h-4" />
          </button>
        </div>
      </div>

      <div className="pt-2 md:pt-1.5 border-t border-border/15 dark:border-primary/10">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <button
              className="flex items-center gap-1.5 text-xs md:text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1.5 md:py-1"
              onClick={() => setShowSpeed((v) => !v)}
            >
              <Gauge className="w-4 h-4 md:w-3.5 md:h-3.5" />
              <span className="font-medium">{rate}x</span>
              <ChevronDown className={`w-3.5 h-3.5 md:w-3 md:h-3 transition-transform ${showSpeed ? "rotate-180" : ""}`} />
            </button>
            {showSpeed && (
              <div className="flex flex-wrap gap-2 md:gap-1.5 mt-2 md:mt-1.5 pl-0.5">
                {VOICE_RATE_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => { setRate(r); setShowSpeed(false); }}
                    className={`min-w-[2.75rem] md:min-w-[2.25rem] px-2.5 md:px-2 py-1.5 md:py-1 rounded-md text-xs md:text-[11px] font-medium transition-colors text-center ${
                      rate === r
                        ? "bg-brand/15 text-brand dark:bg-brand/20"
                        : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/15"
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {!multiVoice && (
            <div className="flex-1 min-w-0">
              <button
                className="flex items-center gap-1.5 text-xs md:text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors py-1.5 md:py-1"
                onClick={() => setShowVoices((v) => !v)}
              >
                <Volume2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                <span className="font-medium truncate">{currentVoiceName}</span>
                <ChevronDown className={`w-3.5 h-3.5 md:w-3 md:h-3 shrink-0 transition-transform ${showVoices ? "rotate-180" : ""}`} />
              </button>
              {showVoices && recommended.length > 0 && (
                <div className="flex flex-wrap gap-2 md:gap-1.5 mt-2 md:mt-1.5 pl-0.5">
                  {recommended.map((v) => {
                    const isSelected = voice === v.shortName;
                    const shortLabel = formatVoiceName(v.name);
                    return (
                      <div
                        key={v.shortName}
                        className={`inline-flex items-center gap-1 rounded-full text-xs md:text-[11px] pl-3 md:pl-2.5 pr-1.5 md:pr-1 py-1.5 md:py-1 border transition-colors cursor-pointer ${ isSelected ? "bg-brand/[0.12] dark:bg-brand/12 border-brand/25 text-foreground" : "bg-muted/10 border-transparent text-muted-foreground/60 hover:bg-muted/20 hover:text-muted-foreground" }`}
                        onClick={() => setVoice(v.shortName)}
                      >
                        <span>{shortLabel}</span>
                        <VoicePreviewButton voiceId={v.shortName} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export function HeaderAudioPlayer() {
  const {
    isReading,
    isPaused,
    isLoading: ttsLoading,
    title: ttsTitle,
    togglePause,
    stop: ttsStop,
    skipForward,
    skipBack,
    seekToChunk,
    inline,
    progress: ttsProgress,
    totalSentences,
    rate,
    setRate } = useTTS();
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    togglePlay,
    stop: musicStop,
    next,
    previous,
    seek,
    skip: musicSkip,
    currentTime,
    duration,
    queueIndex,
    queue } = useAudioPlayer();

  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const isMobile = useIsMobile();

  const sheetDragY = useRef(0);
  const sheetStartY = useRef(0);
  const sheetDragging = useRef(false);
  const [sheetTranslate, setSheetTranslate] = useState(0);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    const el = dropdownRef.current;
    if (!el || !isMobile) return;
    if (el.scrollTop > 0) return;
    sheetStartY.current = e.touches[0].clientY;
    sheetDragY.current = 0;
    sheetDragging.current = true;
  }, [isMobile]);

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    if (!sheetDragging.current) return;
    const delta = e.touches[0].clientY - sheetStartY.current;
    if (delta < 0) {
      sheetDragY.current = 0;
      setSheetTranslate(0);
      return;
    }
    sheetDragY.current = delta;
    setSheetTranslate(delta);
  }, []);

  const handleSheetTouchEnd = useCallback(() => {
    if (!sheetDragging.current) return;
    sheetDragging.current = false;
    if (sheetDragY.current > 80) {
      setExpanded(false);
    }
    setSheetTranslate(0);
    sheetDragY.current = 0;
  }, []);

  const showTTS = isReading && !inline;
  const showMusic = !!currentTrack && !showTTS;

  const [, headerNavigate] = useLocation();
  const [stripMapLoaded, setStripMapLoaded] = useState(false);

  useEffect(() => {
    if (currentTrack?.artistId && !currentTrack?.artistPubkey) {
      let cancelled = false;
      ensureWavlakeMapLoaded().then(() => { if (!cancelled) setStripMapLoaded(true); });
      return () => { cancelled = true; };
    }
  }, [currentTrack?.artistId, currentTrack?.artistPubkey]);

  const stripArtistPubkey = useMemo(() => {
    if (currentTrack?.artistPubkey) return currentTrack.artistPubkey;
    if (currentTrack?.artistId) return resolveWavlakeArtistPubkey(currentTrack.artistId);
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.artistPubkey, currentTrack?.artistId, stripMapLoaded]);

  const canNavigateToArtistFromStrip = !!(stripArtistPubkey || currentTrack?.artistId);

  const navigateToArtistFromStrip = useCallback(() => {
    setExpanded(false);
    if (currentTrack?.artistId) {
      headerNavigate(`/audio?artist=${currentTrack.artistId}`);
      return;
    }
    if (!stripArtistPubkey) return;
    try {
      const npub = nip19.npubEncode(stripArtistPubkey);
      headerNavigate(`/profile/${npub}`);
    } catch {}
  }, [stripArtistPubkey, currentTrack?.artistId, headerNavigate]);

  useEffect(() => {
    if (!expanded) return;
    const updatePosition = () => {
      if (!panelRef.current || isMobile) return;
      const rect = panelRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
        width: 320 });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [expanded, isMobile]);

  useEffect(() => {
    if (!expanded || isMobile) return;
    const handleClickOutside = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-state="open"]')) return;
      setExpanded(false);
    };
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handleClickOutside);
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleClickOutside);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [expanded, isMobile]);

  useEffect(() => {
    if (!showTTS && !showMusic) {
      setExpanded(false);
    }
  }, [showTTS, showMusic]);

  if (!showTTS && !showMusic) return null;

  const handleCollapse = () => setExpanded(false);

  if (showTTS) {
    const handleTTSSeek = (pct: number) => {
      const targetChunk = Math.round(pct * totalSentences);
      seekToChunk(targetChunk);
    };

    const nextRate = () => {
      const idx = TTS_RATES.indexOf(rate);
      const next = TTS_RATES[(idx + 1) % TTS_RATES.length];
      setRate(next);
    };

    return (
      <div ref={panelRef} // Fixed geometry standard: the pill is a CONSTANT size per breakpoint and
      // the title truncates inside it — content never sizes the container
      // (Spotify/YouTube miniplayer convention). Mobile: fill the header slot
      // (uniform by definition). Desktop: fixed 360px (matches the 320px
      // dropdown it anchors), with a 45vw guard for narrow windows.
      className="relative flex-1 min-w-0 md:flex-none md:w-[360px] md:max-w-[45vw]">
        <div
          className="media-compact-strip flex flex-col min-w-0 rounded-lg bg-primary/10 border border-primary/20 animate-in fade-in slide-in-from-right-4 duration-300 relative overflow-hidden"
          data-testid="header-audio-player-tts"
        >
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-2 relative z-[1]">
            <div
              className="flex items-center gap-1 min-w-0 overflow-hidden cursor-pointer"
              style={{ flex: "1 1 0%", maxWidth: "calc(100% - 8rem)" }}
              onClick={() => setExpanded((v) => !v)}
            >
              {ttsLoading ? (
                <RelayOutpostInlineLoader className="w-3.5 h-3.5 md:w-3 md:h-3 text-brand/70 shrink-0" />
              ) : (
                <AudioLines className="w-3.5 h-3.5 md:w-3 md:h-3 text-brand/70 shrink-0" />
              )}
              <span className="text-xs md:text-[11px] font-medium text-foreground/80 truncate leading-tight block" data-testid="header-audio-title">
                {ttsTitle}
              </span>
            </div>

            <div className="flex items-center shrink-0 ml-auto">
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={skipBack} disabled={ttsLoading} data-testid="header-audio-back">
                <SkipBack className="w-2.5 h-2.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={togglePause} disabled={ttsLoading} data-testid="header-audio-toggle">
                {ttsLoading ? <RelayOutpostInlineLoader className="w-3 h-3" /> : isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={skipForward} disabled={ttsLoading} data-testid="header-audio-forward">
                <SkipForward className="w-2.5 h-2.5" />
              </Button>
              <button
                className="h-5 px-0.5 text-[9px] font-bold tabular-nums text-brand/70 hover:text-brand transition-colors rounded hidden sm:block"
                onClick={nextRate}
                data-testid="header-audio-speed"
              >
                {rate}x
              </button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5 text-red-700/80 dark:text-red-400/80" onClick={ttsStop} data-testid="header-audio-stop">
                <X className="w-3 h-3" />
              </Button>
              <button
                className="h-6 w-6 md:h-5 md:w-5 flex items-center justify-center"
                onClick={() => setExpanded((v) => !v)}
              >
                {isMobile ? (
                  <ChevronUp className={`w-3 h-3 text-muted-foreground/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
                ) : (
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
                )}
              </button>
            </div>
          </div>

          <CompactSeekBar
            progress={ttsProgress}
            onSeek={handleTTSSeek}
            colorClass="bg-primary/50"
            bgClass="bg-primary/10"
          />
        </div>

        {expanded && createPortal(
          <>
            {isMobile && (
              <div
                className="fixed inset-0 z-[199] bg-black/40 animate-in fade-in duration-200"
                onClick={() => setExpanded(false)}
              />
            )}
            <div
              ref={dropdownRef}
              className={`z-[200] media-dropdown-glass border border-brand/10 dark:border-brand/15 animate-in fade-in duration-200 ${ isMobile ? "rounded-t-2xl overflow-y-auto shadow-2xl" : "rounded-xl overflow-y-auto slide-in-from-top-2" }`}
              style={isMobile
                ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "calc(85svh - env(safe-area-inset-bottom, 0px))", paddingBottom: "env(safe-area-inset-bottom, 0px)", transform: `translateY(${sheetTranslate}px)`, transition: sheetDragging.current ? "none" : "transform 0.2s ease-out" }
                : { ...dropdownStyle, maxHeight: "calc(100dvh - 5rem)" }
              }
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
            >
              {isMobile && (
                <div className="flex justify-center pt-3 pb-2 sticky top-0 z-10 cursor-grab" onClick={() => setExpanded(false)}>
                  <div className="w-10 h-1.5 rounded-full bg-white/30" />
                </div>
              )}
              <ExpandedTTSPanel onCollapse={handleCollapse} />
            </div>
          </>,
          document.body
        )}
      </div>
    );
  }

  if (showMusic && currentTrack) {
    const hasNext = queueIndex < queue.length - 1;
    const hasPrev = queueIndex > 0 || currentTime > 3;
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    const handleMusicSeek = (pct: number) => {
      if (duration > 0) seek(pct * duration);
    };

    return (
      <div ref={panelRef} // Fixed geometry standard: the pill is a CONSTANT size per breakpoint and
      // the title truncates inside it — content never sizes the container
      // (Spotify/YouTube miniplayer convention). Mobile: fill the header slot
      // (uniform by definition). Desktop: fixed 360px (matches the 320px
      // dropdown it anchors), with a 45vw guard for narrow windows.
      className="relative flex-1 min-w-0 md:flex-none md:w-[360px] md:max-w-[45vw]">
        <div
          className="media-compact-strip flex flex-col min-w-0 rounded-lg bg-primary/10 border border-primary/20 animate-in fade-in slide-in-from-right-4 duration-300 relative overflow-hidden"
          data-testid="header-audio-player-music"
        >
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-2 relative z-[1]">
            <div
              className="flex items-center gap-1 min-w-0 overflow-hidden cursor-pointer"
              style={{ flex: "1 1 0%", maxWidth: "calc(100% - 9.5rem)" }}
              onClick={() => setExpanded((v) => !v)}
            >
              <Music2 className="w-3.5 h-3.5 md:w-3 md:h-3 text-brand/70 shrink-0" />
              <span className="text-xs md:text-[11px] font-medium text-foreground/80 truncate leading-tight block" data-testid="header-audio-title">
                {currentTrack.title}
              </span>
            </div>

            <div className="flex items-center shrink-0 ml-auto">
              {canNavigateToArtistFromStrip && (
                <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5 text-brand/70 hover:text-brand" onClick={navigateToArtistFromStrip} title="Go to artist">
                  <User className="w-2.5 h-2.5" />
                </Button>
              )}
              <span className="text-[9px] tabular-nums text-muted-foreground/50 mr-0.5 hidden sm:inline" data-testid="header-audio-time">
                {formatTime(currentTime)}/{formatTime(duration)}
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={previous} disabled={!hasPrev || isBuffering} data-testid="header-audio-back">
                <SkipBack className="w-2.5 h-2.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5 hidden sm:inline-flex" onClick={() => musicSkip(-SKIP_BACK_SECONDS)} disabled={isBuffering} title={`Back ${SKIP_BACK_SECONDS}s`} data-testid="header-audio-skip-back">
                <Rewind className="w-2.5 h-2.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={togglePlay} disabled={isBuffering} data-testid="header-audio-toggle">
                {isBuffering ? <RelayOutpostInlineLoader className="w-3 h-3" /> : isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5 hidden sm:inline-flex" onClick={() => musicSkip(SKIP_FORWARD_SECONDS)} disabled={isBuffering} title={`Forward ${SKIP_FORWARD_SECONDS}s`} data-testid="header-audio-skip-forward">
                <FastForward className="w-2.5 h-2.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5" onClick={next} disabled={!hasNext} data-testid="header-audio-forward">
                <SkipForward className="w-2.5 h-2.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 md:h-5 md:w-5 text-red-700/80 dark:text-red-400/80" onClick={musicStop} data-testid="header-audio-stop">
                <X className="w-3 h-3" />
              </Button>
              <button
                className="h-6 w-6 md:h-5 md:w-5 flex items-center justify-center"
                onClick={() => setExpanded((v) => !v)}
              >
                {isMobile ? (
                  <ChevronUp className={`w-3 h-3 text-muted-foreground/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
                ) : (
                  <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
                )}
              </button>
            </div>
          </div>

          <CompactSeekBar
            progress={progress}
            onSeek={handleMusicSeek}
            colorClass="bg-primary/50"
            bgClass="bg-primary/10"
          />
        </div>

        {expanded && createPortal(
          <>
            {isMobile && (
              <div
                className="fixed inset-0 z-[199] bg-black/40 animate-in fade-in duration-200"
                onClick={() => setExpanded(false)}
              />
            )}
            <div
              ref={dropdownRef}
              className={`z-[200] media-dropdown-glass border border-brand/10 dark:border-brand/15 animate-in fade-in duration-200 ${ isMobile ? "rounded-t-2xl overflow-y-auto shadow-2xl" : "rounded-xl overflow-y-auto slide-in-from-top-2" }`}
              style={isMobile
                ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "calc(85svh - env(safe-area-inset-bottom, 0px))", paddingBottom: "env(safe-area-inset-bottom, 0px)", transform: `translateY(${sheetTranslate}px)`, transition: sheetDragging.current ? "none" : "transform 0.2s ease-out" }
                : { ...dropdownStyle, maxHeight: "calc(100dvh - 5rem)" }
              }
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
            >
              {isMobile && (
                <div className="flex justify-center pt-3 pb-2 sticky top-0 z-10 cursor-grab" onClick={() => setExpanded(false)}>
                  <div className="w-10 h-1.5 rounded-full bg-white/30" />
                </div>
              )}
              <ExpandedMusicPanel onCollapse={handleCollapse} />
            </div>
          </>,
          document.body
        )}
      </div>
    );
  }

  return null;
}
