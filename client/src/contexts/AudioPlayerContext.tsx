import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import type { MusicTrack } from "@/lib/music";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";

const durationCache = new Map<string, number>();
const STORAGE_KEY = "relay-outpost-audio-position";
const TRACK_POSITIONS_KEY = "relay-outpost-track-positions";
const RATE_KEY = "relay-outpost-audio-rate";
const MAX_TRACK_POSITIONS = 200;
const POSITION_EXPIRY = 30 * 24 * 60 * 60 * 1000;

const VALID_RATES = [0.8, 1, 1.25, 1.5, 1.75, 2];

function loadPlaybackRate(): number {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    if (!raw) return 1;
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return 1;
    return n;
  } catch { return 1; }
}

function savePlaybackRate(rate: number) {
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch {}
}

interface TrackPositionEntry { t: number; d: number; ts: number; }

function loadTrackPositions(): Record<string, TrackPositionEntry> {
  try {
    const raw = localStorage.getItem(TRACK_POSITIONS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function saveTrackPosition(trackId: string, currentTime: number, duration: number) {
  if (currentTime < 5 || !trackId) return;
  if (duration > 0 && (duration - currentTime) < 10) {
    removeTrackPosition(trackId);
    return;
  }
  try {
    const positions = loadTrackPositions();
    positions[trackId] = { t: currentTime, d: duration, ts: Date.now() };
    const entries = Object.entries(positions);
    const now = Date.now();
    const valid = entries.filter(([, v]) => (now - v.ts) < POSITION_EXPIRY);
    if (valid.length > MAX_TRACK_POSITIONS) {
      valid.sort((a, b) => b[1].ts - a[1].ts);
      const trimmed = Object.fromEntries(valid.slice(0, MAX_TRACK_POSITIONS));
      localStorage.setItem(TRACK_POSITIONS_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(TRACK_POSITIONS_KEY, JSON.stringify(Object.fromEntries(valid)));
    }
  } catch {}
}

function removeTrackPosition(trackId: string) {
  try {
    const positions = loadTrackPositions();
    delete positions[trackId];
    localStorage.setItem(TRACK_POSITIONS_KEY, JSON.stringify(positions));
  } catch {}
}

export function getTrackPosition(trackId: string): { time: number; duration: number } | null {
  try {
    const positions = loadTrackPositions();
    const entry = positions[trackId];
    if (!entry) return null;
    if ((Date.now() - entry.ts) > POSITION_EXPIRY) return null;
    if (entry.t < 5) return null;
    return { time: entry.t, duration: entry.d };
  } catch { return null; }
}

export function getCachedDuration(trackId: string): number {
  return durationCache.get(trackId) || 0;
}

function savePlaybackPosition(track: MusicTrack | null, currentTime: number, queue: MusicTrack[], queueIndex: number) {
  if (!track) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      trackId: track.id,
      currentTime,
      track,
      queue,
      queueIndex,
      savedAt: Date.now(),
    }));
  } catch {}
}

function loadPlaybackPosition(): { track: MusicTrack; currentTime: number; queue: MusicTrack[]; queueIndex: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.track || !data.track.audioUrl) return null;
    const age = Date.now() - (data.savedAt || 0);
    if (age > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      track: data.track,
      currentTime: data.currentTime || 0,
      queue: data.queue || [data.track],
      queueIndex: data.queueIndex ?? 0,
    };
  } catch {
    return null;
  }
}

interface AudioPlayerState {
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  queue: MusicTrack[];
  queueIndex: number;
}

interface AudioPlayerContextType extends AudioPlayerState {
  play: (track: MusicTrack, queue?: MusicTrack[]) => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setVolume: (vol: number) => void;
  setPlaybackRate: (rate: number) => void;
  next: () => void;
  previous: () => void;
  addToQueue: (track: MusicTrack) => void;
  playNext: (track: MusicTrack) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  jumpTo: (index: number) => void;
  clearQueue: () => void;
  stop: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRateRef = useRef(1);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playSessionRef = useRef(0);
  const [state, setState] = useState<AudioPlayerState>({
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    playbackRate: loadPlaybackRate(),
    queue: [],
    queueIndex: -1,
  });

  useEffect(() => {
    const audio = new Audio();
    audio.volume = 0.8;
    audio.preload = "auto";
    const initialRate = loadPlaybackRate();
    playbackRateRef.current = initialRate;
    audio.defaultPlaybackRate = initialRate;
    audio.playbackRate = initialRate;
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setState((s) => ({ ...s, currentTime: audio.currentTime }));
    };
    const onLoadedMetadata = () => {
      // The element resets playbackRate to defaultPlaybackRate on each new
      // src load; reassert the user's chosen rate so it persists across
      // tracks/episodes.
      audio.playbackRate = playbackRateRef.current;
      const realDuration = audio.duration || 0;
      setState((s) => {
        if (realDuration > 0 && s.currentTrack && !s.currentTrack.duration) {
          durationCache.set(s.currentTrack.id, realDuration);
          const updatedTrack = { ...s.currentTrack, duration: realDuration };
          const updatedQueue = s.queue.map(t =>
            t.id === updatedTrack.id ? { ...t, duration: realDuration } : t
          );
          return { ...s, duration: realDuration, currentTrack: updatedTrack, queue: updatedQueue };
        }
        return { ...s, duration: realDuration };
      });
    };
    const onEnded = () => {
      retryCountRef.current = 0;
      setState((s) => {
        if (s.currentTrack) {
          removeTrackPosition(s.currentTrack.id);
        }
        if (s.queueIndex < s.queue.length - 1) {
          const nextIdx = s.queueIndex + 1;
          const nextTrack = s.queue[nextIdx];
          if (nextTrack) {
            audio.src = nextTrack.audioUrl;
            audio.play().catch((e) => console.warn("[Audio] Auto-advance play failed:", e?.message));
            return { ...s, currentTrack: nextTrack, queueIndex: nextIdx, isPlaying: true, isBuffering: true, currentTime: 0, duration: 0 };
          }
        }
        return { ...s, isPlaying: false, isBuffering: false, currentTime: 0 };
      });
    };
    const onPlay = () => {
      retryCountRef.current = 0;
      setState((s) => ({ ...s, isPlaying: true, isBuffering: false }));
    };
    const onPause = () => setState((s) => ({ ...s, isPlaying: false }));

    const onWaiting = () => setState((s) => ({ ...s, isBuffering: true }));
    const onCanPlay = () => setState((s) => ({ ...s, isBuffering: false }));
    const onPlaying = () => setState((s) => ({ ...s, isBuffering: false, isPlaying: true }));

    const onVolumeChange = () => {
      setState((s) => ({ ...s, volume: audio.volume }));
    };

    const onError = () => {
      setState((s) => {
        if (retryCountRef.current < 1 && s.currentTrack) {
          retryCountRef.current++;
          const session = playSessionRef.current;
          const trackUrl = s.currentTrack.audioUrl;
          const trackTitle = s.currentTrack.title;
          console.warn("[Audio] Playback error, retrying...", trackTitle);
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (playSessionRef.current !== session) return;
            if (audioRef.current) {
              audioRef.current.src = trackUrl;
              audioRef.current.play().catch(() => {
                console.error("[Audio] Retry failed for:", trackTitle);
                if (playSessionRef.current === session) {
                  setState((s2) => ({ ...s2, isPlaying: false, isBuffering: false }));
                }
              });
            }
          }, 1000);
          return { ...s, isBuffering: true };
        }
        console.error("[Audio] Playback error:", s.currentTrack?.title);
        return { ...s, isPlaying: false, isBuffering: false };
      });
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("volumechange", onVolumeChange);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("volumechange", onVolumeChange);
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    const saved = loadPlaybackPosition();
    if (saved) {
      setState({
        currentTrack: saved.track,
        isPlaying: false,
        isBuffering: false,
        currentTime: saved.currentTime,
        duration: saved.track.duration || 0,
        volume: 0.8,
        playbackRate: playbackRateRef.current,
        queue: saved.queue,
        queueIndex: saved.queueIndex,
      });
      const audio = audioRef.current;
      if (audio) {
        playSessionRef.current++;
        const session = playSessionRef.current;
        audio.src = saved.track.audioUrl;
        // Setting currentTime before loadedmetadata is a no-op; defer the
        // seek so resume actually picks up where we left off.
        const seek = () => {
          if (playSessionRef.current === session) {
            audio.currentTime = saved.currentTime;
          }
        };
        if (audio.readyState >= 1) {
          seek();
        } else {
          audio.addEventListener("loadedmetadata", seek, { once: true });
        }
      }
    }
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const handleBeforeUnload = () => {
      const s = stateRef.current;
      if (s.currentTrack) {
        savePlaybackPosition(s.currentTrack, s.currentTime, s.queue, s.queueIndex);
        saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!state.currentTrack) return;
    const interval = setInterval(() => {
      const s = stateRef.current;
      if (s.currentTrack && s.currentTime > 0) {
        savePlaybackPosition(s.currentTrack, s.currentTime, s.queue, s.queueIndex);
        saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [state.currentTrack?.id]);

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const play = useCallback((track: MusicTrack, queue?: MusicTrack[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const prev = stateRef.current;
    if (prev.currentTrack && prev.currentTrack.id !== track.id && prev.currentTime > 0) {
      saveTrackPosition(prev.currentTrack.id, prev.currentTime, prev.duration);
    }

    cancelRetry();
    retryCountRef.current = 0;
    playSessionRef.current++;
    const session = playSessionRef.current;

    registerAudioSource("music", () => {
      cancelRetry();
      audio.pause();
      setState((s) => ({ ...s, isPlaying: false, isBuffering: false }));
    });

    const newQueue = queue || [track];
    const idx = queue ? queue.findIndex((t) => t.id === track.id) : 0;

    const saved = getTrackPosition(track.id);
    const resumeTime = saved ? saved.time : 0;

    audio.src = track.audioUrl;
    audio.defaultPlaybackRate = playbackRateRef.current;
    if (resumeTime > 0) {
      audio.addEventListener("loadedmetadata", () => {
        if (playSessionRef.current === session) {
          audio.currentTime = resumeTime;
        }
      }, { once: true });
    }
    audio.play().catch((err) => {
      console.warn("[Audio] Initial play failed:", err.message);
      if (playSessionRef.current === session) {
        setState((s) => ({ ...s, isPlaying: false, isBuffering: false }));
      }
    });
    setState((s) => ({
      ...s,
      currentTrack: track,
      isPlaying: true,
      isBuffering: true,
      currentTime: resumeTime,
      duration: track.duration || (saved ? saved.duration : 0),
      queue: newQueue,
      queueIndex: idx >= 0 ? idx : 0,
    }));
  }, []);

  const pause = useCallback(() => {
    const s = stateRef.current;
    if (s.currentTrack && s.currentTime > 0) {
      saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
    }
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    registerAudioSource("music", () => {
      audioRef.current?.pause();
      setState((s) => ({ ...s, isPlaying: false, isBuffering: false }));
    });
    const audio = audioRef.current;
    if (!audio) return;

    // Self-heal: if the element is parked at 0 but a saved position exists
    // (mount-restore listener missed, error path skipped it, etc.), seek
    // to it before play(). Skipped when the element is already mid-track
    // so a normal pause/resume keeps its current position.
    const s = stateRef.current;
    if (s.currentTrack && audio.currentTime < 0.5) {
      const saved = getTrackPosition(s.currentTrack.id);
      const target = saved && saved.time > 0.5 ? saved.time : s.currentTime;
      if (target > 0.5) {
        const session = playSessionRef.current;
        const trackId = s.currentTrack.id;
        const seek = () => {
          if (playSessionRef.current !== session) return;
          if (stateRef.current.currentTrack?.id !== trackId) return;
          audio.currentTime = target;
        };
        if (audio.readyState >= 1) {
          seek();
        } else {
          audio.addEventListener("loadedmetadata", seek, { once: true });
        }
      }
    }

    audio.play().catch((e) => console.warn("[Audio] Resume play failed:", e?.message));
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((e) => console.warn("[Audio] Toggle play failed:", e?.message));
    } else {
      const s = stateRef.current;
      if (s.currentTrack && s.currentTime > 0) {
        saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
      }
      audio.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
  }, []);

  const setVolume = useCallback((vol: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = vol;
    setState((s) => ({ ...s, volume: vol }));
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    if (!isFinite(rate) || rate <= 0) return;
    playbackRateRef.current = rate;
    savePlaybackRate(rate);
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    }
    setState((s) => ({ ...s, playbackRate: rate }));
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = audio.duration || stateRef.current.duration || 0;
    const target = audio.currentTime + seconds;
    const clamped = dur > 0 ? Math.max(0, Math.min(target, dur)) : Math.max(0, target);
    audio.currentTime = clamped;
    setState((s) => ({ ...s, currentTime: clamped }));
  }, []);

  const next = useCallback(() => {
    cancelRetry();
    retryCountRef.current = 0;
    playSessionRef.current++;
    setState((s) => {
      if (s.queueIndex < s.queue.length - 1) {
        const nextIdx = s.queueIndex + 1;
        const nextTrack = s.queue[nextIdx];
        if (nextTrack && audioRef.current) {
          audioRef.current.src = nextTrack.audioUrl;
          audioRef.current.play().catch((e) => console.warn("[Audio] Next track play failed:", e?.message));
          return { ...s, currentTrack: nextTrack, queueIndex: nextIdx, isPlaying: true, isBuffering: true, currentTime: 0, duration: 0 };
        }
      }
      return s;
    });
  }, []);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    cancelRetry();
    retryCountRef.current = 0;
    playSessionRef.current++;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    setState((s) => {
      if (s.queueIndex > 0) {
        const prevIdx = s.queueIndex - 1;
        const prevTrack = s.queue[prevIdx];
        if (prevTrack) {
          audio.src = prevTrack.audioUrl;
          audio.play().catch((e) => console.warn("[Audio] Previous track play failed:", e?.message));
          return { ...s, currentTrack: prevTrack, queueIndex: prevIdx, isPlaying: true, isBuffering: true, currentTime: 0, duration: 0 };
        }
      }
      audio.currentTime = 0;
      return s;
    });
  }, []);

  const addToQueue = useCallback((track: MusicTrack) => {
    setState((s) => ({ ...s, queue: [...s.queue, track] }));
  }, []);

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s.currentTrack && s.currentTime > 0) {
      saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
    }
    unregisterAudioSource("music");
    cancelRetry();
    retryCountRef.current = 0;
    playSessionRef.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    setState((s) => ({
      ...s,
      currentTrack: null,
      isPlaying: false,
      isBuffering: false,
      currentTime: 0,
      duration: 0,
      queue: [],
      queueIndex: -1,
    }));
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, [cancelRetry]);

  // Load + play `track`, placing it at `index` within `queueOverride`, applying
  // the persisted rate + saved position. Takes explicit track/queue so callers
  // that just mutated the queue don't have to wait for the stale state ref.
  const loadAndPlayIndex = useCallback((index: number, track: MusicTrack, queueOverride: MusicTrack[]) => {
    const audio = audioRef.current;
    if (!audio || !track) return;

    const s = stateRef.current;
    if (s.currentTrack && s.currentTrack.id !== track.id && s.currentTime > 0) {
      saveTrackPosition(s.currentTrack.id, s.currentTime, s.duration);
    }

    cancelRetry();
    retryCountRef.current = 0;
    playSessionRef.current++;
    const session = playSessionRef.current;

    registerAudioSource("music", () => {
      cancelRetry();
      audio.pause();
      setState((st) => ({ ...st, isPlaying: false, isBuffering: false }));
    });

    const saved = getTrackPosition(track.id);
    const resumeTime = saved ? saved.time : 0;

    audio.src = track.audioUrl;
    audio.defaultPlaybackRate = playbackRateRef.current;
    if (resumeTime > 0) {
      audio.addEventListener("loadedmetadata", () => {
        if (playSessionRef.current === session) {
          audio.currentTime = resumeTime;
        }
      }, { once: true });
    }
    audio.play().catch((err) => {
      console.warn("[Audio] jumpTo play failed:", err?.message);
      if (playSessionRef.current === session) {
        setState((st) => ({ ...st, isPlaying: false, isBuffering: false }));
      }
    });
    setState((st) => ({
      ...st,
      queue: queueOverride,
      currentTrack: track,
      queueIndex: index,
      isPlaying: true,
      isBuffering: true,
      currentTime: resumeTime,
      duration: track.duration || (saved ? saved.duration : 0),
    }));
  }, [cancelRetry]);

  const jumpTo = useCallback((index: number) => {
    const s = stateRef.current;
    if (index < 0 || index >= s.queue.length) return;
    loadAndPlayIndex(index, s.queue[index], s.queue);
  }, [loadAndPlayIndex]);

  const playNext = useCallback((track: MusicTrack) => {
    const s = stateRef.current;
    if (!s.currentTrack || s.queueIndex < 0) {
      play(track);
      return;
    }
    setState((st) => {
      const insertAt = st.queueIndex + 1;
      const newQueue = [...st.queue];
      newQueue.splice(insertAt, 0, track);
      return { ...st, queue: newQueue };
    });
  }, [play]);

  const removeFromQueue = useCallback((index: number) => {
    const s = stateRef.current;
    if (index < 0 || index >= s.queue.length) return;

    if (index === s.queueIndex) {
      // Removing the currently-playing track: advance to the next track in
      // the post-removal queue (same slot index), or stop if none remain.
      const newQueue = [...s.queue];
      newQueue.splice(index, 1);
      if (newQueue.length === 0) {
        stop();
        return;
      }
      if (index >= newQueue.length) {
        // Removed the last item — no track after it. Fall back to the new last
        // track and stop playback, keeping the queue intact.
        const fallbackIndex = newQueue.length - 1;
        cancelRetry();
        retryCountRef.current = 0;
        playSessionRef.current++;
        const audio = audioRef.current;
        if (audio) { audio.pause(); }
        setState((st) => ({
          ...st,
          queue: newQueue,
          currentTrack: newQueue[fallbackIndex],
          queueIndex: fallbackIndex,
          isPlaying: false,
          isBuffering: false,
          currentTime: 0,
        }));
        return;
      }
      // The track that was at index+1 now occupies `index`; play it.
      loadAndPlayIndex(index, newQueue[index], newQueue);
      return;
    }

    // Removing a non-current track: just drop it and keep queueIndex pointing
    // at the same currently-playing track.
    setState((st) => {
      const newQueue = [...st.queue];
      newQueue.splice(index, 1);
      const newIndex = index < st.queueIndex ? st.queueIndex - 1 : st.queueIndex;
      return { ...st, queue: newQueue, queueIndex: newIndex };
    });
  }, [stop, cancelRetry, loadAndPlayIndex]);

  const reorderQueue = useCallback((from: number, to: number) => {
    setState((st) => {
      if (from < 0 || from >= st.queue.length || to < 0 || to >= st.queue.length || from === to) {
        return st;
      }
      const currentId = st.currentTrack?.id;
      const newQueue = [...st.queue];
      const [moved] = newQueue.splice(from, 1);
      newQueue.splice(to, 0, moved);
      // Keep queueIndex pointing at the SAME currently-playing track.
      const newIndex = currentId
        ? newQueue.findIndex((t) => t.id === currentId)
        : st.queueIndex;
      return { ...st, queue: newQueue, queueIndex: newIndex >= 0 ? newIndex : st.queueIndex };
    });
  }, []);

  const clearQueue = useCallback(() => {
    setState((s) => ({ ...s, queue: s.currentTrack ? [s.currentTrack] : [], queueIndex: 0 }));
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;

    if (!state.currentTrack) {
      ms.metadata = null;
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekto", null);
      ms.setActionHandler("seekbackward", null);
      ms.setActionHandler("seekforward", null);
      ms.setActionHandler("stop", null);
      return;
    }

    const track = state.currentTrack;
    const artwork: MediaImage[] = track.coverUrl
      ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }]
      : [];
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.albumTitle || track.genre || "",
      artwork,
    });

    ms.setActionHandler("play", () => {
      audioRef.current?.play().catch((e) => console.warn("[Audio] MediaSession play failed:", e?.message));
    });
    ms.setActionHandler("pause", () => {
      audioRef.current?.pause();
    });
    ms.setActionHandler("previoustrack", () => {
      previous();
    });
    ms.setActionHandler("nexttrack", () => {
      next();
    });
    ms.setActionHandler("stop", () => {
      stop();
    });
    ms.setActionHandler("seekto", (details) => {
      if (details.seekTime != null && audioRef.current) {
        audioRef.current.currentTime = details.seekTime;
      }
    });
    ms.setActionHandler("seekbackward", (details) => {
      skip(-(details.seekOffset || 15));
    });
    ms.setActionHandler("seekforward", (details) => {
      skip(details.seekOffset || 30);
    });

    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekto", null);
      ms.setActionHandler("seekbackward", null);
      ms.setActionHandler("seekforward", null);
      ms.setActionHandler("stop", null);
    };
  }, [state.currentTrack?.id, state.currentTrack?.title, next, previous, stop, skip]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !state.currentTrack || !audioRef.current) return;
    const audio = audioRef.current;
    const dur = state.duration || audio.duration || 0;
    if (dur > 0 && isFinite(dur)) {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(state.currentTime, dur),
      });
    }
  }, [state.currentTime, state.duration, state.currentTrack?.id]);

  return (
    <AudioPlayerContext.Provider
      value={{
        ...state,
        play,
        pause,
        resume,
        togglePlay,
        seek,
        skip,
        setVolume,
        setPlaybackRate,
        next,
        previous,
        addToQueue,
        playNext,
        removeFromQueue,
        reorderQueue,
        jumpTo,
        clearQueue,
        stop,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}
