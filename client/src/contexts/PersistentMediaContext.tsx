import { createContext, useContext, useRef, useCallback } from "react";

interface MediaHandoff {
  src: string;
  currentTime: number;
  muted: boolean;
  playing: boolean;
  timestamp: number;
}

interface PersistentMediaContextType {
  handoffVideo: (src: string, currentTime: number, muted: boolean) => void;
  claimVideo: (src: string) => MediaHandoff | null;
  handoffAudio: (src: string, currentTime: number) => void;
  claimAudio: (src: string) => MediaHandoff | null;
}

const PersistentMediaContext = createContext<PersistentMediaContextType>({
  handoffVideo: () => {},
  claimVideo: () => null,
  handoffAudio: () => {},
  claimAudio: () => null,
});

export function usePersistentMedia() {
  return useContext(PersistentMediaContext);
}

const HANDOFF_TTL = 5000;

function stopElement(el: HTMLVideoElement | HTMLAudioElement | null) {
  if (!el) return;
  try { el.pause(); } catch {}
  el.removeAttribute("src");
  el.load();
}

export function PersistentMediaProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoHandoff = useRef<MediaHandoff | null>(null);
  const audioHandoff = useRef<MediaHandoff | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handoffVideo = useCallback((src: string, currentTime: number, muted: boolean) => {
    if (videoTimerRef.current) clearTimeout(videoTimerRef.current);
    videoHandoff.current = { src, currentTime, muted, playing: true, timestamp: Date.now() };
    const el = videoRef.current;
    if (el) {
      el.src = src;
      el.currentTime = currentTime;
      el.muted = true;
      el.play().catch(() => {});
    }
    videoTimerRef.current = setTimeout(() => {
      videoTimerRef.current = null;
      if (videoHandoff.current?.src === src) {
        videoHandoff.current = null;
        stopElement(videoRef.current);
      }
    }, HANDOFF_TTL);
  }, []);

  const claimVideo = useCallback((src: string): MediaHandoff | null => {
    const h = videoHandoff.current;
    if (!h || h.src !== src) return null;
    if (Date.now() - h.timestamp > HANDOFF_TTL) {
      videoHandoff.current = null;
      stopElement(videoRef.current);
      return null;
    }
    if (videoTimerRef.current) {
      clearTimeout(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    const el = videoRef.current;
    let currentTime = h.currentTime;
    if (el) {
      if (!el.paused) currentTime = el.currentTime;
      stopElement(el);
    }
    const result = { ...h, currentTime };
    videoHandoff.current = null;
    return result;
  }, []);

  const handoffAudio = useCallback((src: string, currentTime: number) => {
    if (audioTimerRef.current) clearTimeout(audioTimerRef.current);
    audioHandoff.current = { src, currentTime, muted: false, playing: true, timestamp: Date.now() };
    const el = audioRef.current;
    if (el) {
      el.src = src;
      el.currentTime = currentTime;
      el.play().catch(() => {});
    }
    audioTimerRef.current = setTimeout(() => {
      audioTimerRef.current = null;
      if (audioHandoff.current?.src === src) {
        audioHandoff.current = null;
        stopElement(audioRef.current);
      }
    }, HANDOFF_TTL);
  }, []);

  const claimAudio = useCallback((src: string): MediaHandoff | null => {
    const h = audioHandoff.current;
    if (!h || h.src !== src) return null;
    if (Date.now() - h.timestamp > HANDOFF_TTL) {
      audioHandoff.current = null;
      stopElement(audioRef.current);
      return null;
    }
    if (audioTimerRef.current) {
      clearTimeout(audioTimerRef.current);
      audioTimerRef.current = null;
    }
    const el = audioRef.current;
    let currentTime = h.currentTime;
    if (el) {
      if (!el.paused) currentTime = el.currentTime;
      stopElement(el);
    }
    const result = { ...h, currentTime };
    audioHandoff.current = null;
    return result;
  }, []);

  return (
    <PersistentMediaContext.Provider value={{ handoffVideo, claimVideo, handoffAudio, claimAudio }}>
      {children}
      <video
        ref={videoRef}
        muted
        playsInline
        style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", zIndex: -9999 }}
        aria-hidden="true"
      />
      <audio
        ref={audioRef}
        style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", zIndex: -9999 }}
        aria-hidden="true"
      />
    </PersistentMediaContext.Provider>
  );
}
