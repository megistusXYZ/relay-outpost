import { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { registerAudioSource, unregisterAudioSource } from "@/lib/audio-coordinator";
import type Hls from "hls.js";
import { loadHls } from "@/lib/load-hls";

export const supportsNativeHls = typeof document !== "undefined" &&
  !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl");

interface PiPContextType {
  isPiP: boolean;
  pipVideoSrc: string | null;
  enterPiP: (sourceVideo: HTMLVideoElement, src: string, loop?: boolean, isHls?: boolean) => Promise<void>;
  exitPiP: () => void;
  notifyUnmount: (src: string) => void;
  pipSupported: boolean;
}

const PiPContext = createContext<PiPContextType>({
  isPiP: false,
  pipVideoSrc: null,
  enterPiP: async () => {},
  exitPiP: () => {},
  notifyUnmount: () => {},
  pipSupported: false,
});

export function usePiP() {
  return useContext(PiPContext);
}

function isHlsSource(src: string): boolean {
  return src.includes(".m3u8") || src.includes("m3u8");
}

function getCaptureStream(video: HTMLVideoElement): MediaStream | null {
  if (typeof video.captureStream === "function") return video.captureStream();
  if (typeof (video as any).mozCaptureStream === "function") return (video as any).mozCaptureStream();
  return null;
}

export function PiPProvider({ children }: { children: React.ReactNode }) {
  const persistentRef = useRef<HTMLVideoElement>(null);
  const hlsVideoRef = useRef<HTMLVideoElement>(null);
  const sourceRef = useRef<HTMLVideoElement | null>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const warmStreamRef = useRef<MediaStream | null>(null);
  const capturedStreamRef = useRef<MediaStream | null>(null);
  const [isPiP, setIsPiP] = useState(false);
  const [pipVideoSrc, setPipVideoSrc] = useState<string | null>(null);
  const pipVideoSrcRef = useRef<string | null>(null);
  const loopRef = useRef(true);
  const switchingRef = useRef(false);
  const enteringRef = useRef(false);
  const [pipSupported] = useState(() => {
    if (typeof document === "undefined") return false;
    if (document.pictureInPictureEnabled) return true;
    const probe = document.createElement("video");
    if (typeof (probe as any).webkitSupportsPresentationMode === "function") {
      return (probe as any).webkitSupportsPresentationMode("picture-in-picture");
    }
    return false;
  });

  const destroyHls = useCallback(() => {
    if (hlsInstanceRef.current) {
      try { hlsInstanceRef.current.detachMedia(); } catch {}
      try { hlsInstanceRef.current.destroy(); } catch {}
      hlsInstanceRef.current = null;
    }
    const hv = hlsVideoRef.current;
    if (hv) {
      try { hv.pause(); } catch {}
      hv.removeAttribute("src");
      hv.srcObject = null;
    }
    if (capturedStreamRef.current) {
      capturedStreamRef.current.getTracks().forEach(t => t.stop());
      capturedStreamRef.current = null;
    }
  }, []);

  const warmUpPersistent = useCallback(() => {
    const v = persistentRef.current;
    if (!v) return;
    try {
      if (warmStreamRef.current) {
        warmStreamRef.current.getTracks().forEach(t => t.stop());
        warmStreamRef.current = null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 320, 180);
      }
      const stream = canvas.captureStream(1);
      warmStreamRef.current = stream;
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      v.play().catch(() => {});
    } catch {}
  }, []);

  const clearMediaSession = useCallback(() => {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);
        navigator.mediaSession.metadata = null;
      } catch {}
    }
  }, []);

  const cleanup = useCallback(() => {
    setIsPiP(false);
    setPipVideoSrc(null);
    pipVideoSrcRef.current = null;
    unregisterAudioSource("pip-video");
    sourceRef.current = null;
    destroyHls();
    const v = persistentRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.srcObject = null;
    }
    warmUpPersistent();
    clearMediaSession();
  }, [destroyHls, warmUpPersistent, clearMediaSession]);

  useEffect(() => {
    warmUpPersistent();
  }, [warmUpPersistent]);

  const enterPiP = useCallback(async (sourceVideo: HTMLVideoElement, src: string, loop?: boolean, isHls?: boolean) => {
    if (!pipSupported || enteringRef.current) return;
    enteringRef.current = true;

    const useWebkitPiP = !document.pictureInPictureEnabled &&
      typeof (sourceVideo as any).webkitSupportsPresentationMode === "function" &&
      (sourceVideo as any).webkitSupportsPresentationMode("picture-in-picture");

    if (useWebkitPiP) {
      const persistent = persistentRef.current;
      const isHlsSrc = isHls || isHlsSource(src);

      if (isHlsSrc && persistent && typeof (persistent as any).webkitSupportsPresentationMode === "function" && (persistent as any).webkitSupportsPresentationMode("picture-in-picture")) {
        try {
          sourceRef.current = sourceVideo;
          pipVideoSrcRef.current = src;

          if (warmStreamRef.current) {
            warmStreamRef.current.getTracks().forEach(t => t.stop());
            warmStreamRef.current = null;
          }
          persistent.srcObject = null;
          persistent.src = src;
          persistent.muted = false;
          persistent.playsInline = true;

          await new Promise<void>((resolve, reject) => {
            if (persistent.readyState >= 1) { resolve(); return; }
            const timeout = setTimeout(() => {
              persistent.removeEventListener("loadedmetadata", onReady);
              persistent.removeEventListener("error", onErr);
              if (persistent.readyState >= 1) resolve();
              else reject(new Error("Timeout loading HLS for webkit PiP"));
            }, 8000);
            const onReady = () => { clearTimeout(timeout); persistent.removeEventListener("error", onErr); resolve(); };
            const onErr = () => { clearTimeout(timeout); persistent.removeEventListener("loadedmetadata", onReady); reject(new Error("Failed to load HLS")); };
            persistent.addEventListener("loadedmetadata", onReady, { once: true });
            persistent.addEventListener("error", onErr, { once: true });
            persistent.load();
          });

          await persistent.play();

          registerAudioSource("pip-video", () => {
            try { (persistent as any).webkitSetPresentationMode("inline"); } catch {}
            cleanup();
          });

          (persistent as any).webkitSetPresentationMode("picture-in-picture");

          sourceVideo.muted = true;
          try { sourceVideo.pause(); } catch {}

          if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({ title: "Live Stream" });
            navigator.mediaSession.setActionHandler("play", () => { persistent.play().catch(() => {}); });
            navigator.mediaSession.setActionHandler("pause", () => { persistent.pause(); });
          }

          setIsPiP(true);
          setPipVideoSrc(src);

          const onPresentationChange = () => {
            if ((persistent as any).webkitPresentationMode !== "picture-in-picture") {
              persistent.removeEventListener("webkitpresentationmodechanged", onPresentationChange);
              cleanup();
            }
          };
          persistent.addEventListener("webkitpresentationmodechanged", onPresentationChange);
        } catch (err: any) {
          console.warn("[PiP] Failed to enter webkit HLS PiP:", err?.message || err);
          cleanup();
        }
        enteringRef.current = false;
        return;
      }

      try {
        sourceRef.current = sourceVideo;
        pipVideoSrcRef.current = src;

        registerAudioSource("pip-video", () => {
          try { (sourceVideo as any).webkitSetPresentationMode("inline"); } catch {}
          cleanup();
        });

        (sourceVideo as any).webkitSetPresentationMode("picture-in-picture");

        if ("mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({ title: "Live Stream" });
          navigator.mediaSession.setActionHandler("play", () => { sourceVideo.play().catch(() => {}); });
          navigator.mediaSession.setActionHandler("pause", () => { sourceVideo.pause(); });
        }

        setIsPiP(true);
        setPipVideoSrc(src);

        const onPresentationChange = () => {
          if ((sourceVideo as any).webkitPresentationMode !== "picture-in-picture") {
            sourceVideo.removeEventListener("webkitpresentationmodechanged", onPresentationChange);
            cleanup();
          }
        };
        sourceVideo.addEventListener("webkitpresentationmodechanged", onPresentationChange);
      } catch (err: any) {
        console.warn("[PiP] Failed to enter webkit PiP:", err?.message || err);
        cleanup();
      }
      enteringRef.current = false;
      return;
    }

    const persistent = persistentRef.current;
    const hlsVideo = hlsVideoRef.current;
    if (!persistent || !hlsVideo) { enteringRef.current = false; return; }

    const oldSource = sourceRef.current;
    if (oldSource && oldSource !== sourceVideo) {
      try { oldSource.pause(); } catch {}
      try { oldSource.muted = true; } catch {}
    }

    try {
      if (document.pictureInPictureElement) {
        switchingRef.current = true;
        try {
          await document.exitPictureInPicture();
        } catch {
          switchingRef.current = false;
        }
      }

      const srcIsBlob = sourceVideo.src?.startsWith("blob:");
      // hls.js is loaded on demand (it's ~1.3MB) — only when PiP actually starts.
      const HlsCtor = await loadHls().catch(() => null);
      const needsHlsJs = !!HlsCtor && HlsCtor.isSupported() && ((isHls || srcIsBlob) || (isHlsSource(src) && !supportsNativeHls));

      if (needsHlsJs && HlsCtor) {
        if (!persistent.srcObject && warmStreamRef.current) {
          persistent.srcObject = warmStreamRef.current;
        }
        await persistent.play();
        await persistent.requestPictureInPicture();

        sourceRef.current = sourceVideo;
        loopRef.current = loop ?? false;
        pipVideoSrcRef.current = src;

        registerAudioSource("pip-video", () => {
          try {
            if (document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(() => {});
            }
          } catch {}
          cleanup();
        });

        destroyHls();
        const hls = new HlsCtor({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 10,
          maxMaxBufferLength: 30,
        });
        hlsInstanceRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(hlsVideo);

        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            hls.off(HlsCtor.Events.MANIFEST_PARSED, onManifest);
            hls.off(HlsCtor.Events.ERROR, onError);
            reject(new Error("HLS manifest timeout for PiP"));
          }, 8000);
          const onManifest = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            hls.off(HlsCtor.Events.ERROR, onError);
            resolve();
          };
          const onError = (_evt: any, data: any) => {
            if (!data.fatal || settled) return;
            settled = true;
            clearTimeout(timeout);
            hls.off(HlsCtor.Events.MANIFEST_PARSED, onManifest);
            reject(new Error("HLS fatal error for PiP"));
          };
          hls.on(HlsCtor.Events.MANIFEST_PARSED, onManifest);
          hls.on(HlsCtor.Events.ERROR, onError);
        });

        if (document.pictureInPictureElement !== persistent) {
          enteringRef.current = false;
          switchingRef.current = false;
          cleanup();
          return;
        }

        if (warmStreamRef.current) {
          warmStreamRef.current.getTracks().forEach(t => t.stop());
          warmStreamRef.current = null;
        }

        hlsVideo.muted = false;
        await hlsVideo.play();

        const captured = getCaptureStream(hlsVideo);
        if (captured) {
          capturedStreamRef.current = captured;
          persistent.srcObject = captured;
          persistent.muted = true;
          await persistent.play();
        } else {
          persistent.srcObject = null;
          hls.detachMedia();
          hls.attachMedia(persistent);
          persistent.muted = false;
          await persistent.play();
        }

        sourceVideo.muted = true;
        try { sourceVideo.pause(); } catch {}

        hls.on(HlsCtor.Events.ERROR, (_evt: any, data: any) => {
          if (data.fatal) {
            try {
              if (document.pictureInPictureElement) {
                document.exitPictureInPicture().catch(() => {});
              }
            } catch {}
            cleanup();
          }
        });

      } else {
        destroyHls();
        persistent.pause();
        persistent.srcObject = null;

        if (warmStreamRef.current) {
          warmStreamRef.current.getTracks().forEach(t => t.stop());
          warmStreamRef.current = null;
        }

        let videoSrc = sourceVideo.src || src;
        if (videoSrc.startsWith("blob:")) {
          videoSrc = src;
        }
        persistent.src = videoSrc;
        persistent.loop = loop ?? true;

        await new Promise<void>((resolve, reject) => {
          if (persistent.readyState >= 1) { resolve(); return; }
          const timeout = setTimeout(() => {
            persistent.removeEventListener("loadedmetadata", onReady);
            persistent.removeEventListener("error", onErr);
            if (persistent.readyState >= 1) resolve();
            else reject(new Error("Timeout waiting for video metadata"));
          }, 5000);
          const onReady = () => {
            clearTimeout(timeout);
            persistent.removeEventListener("loadedmetadata", onReady);
            persistent.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = () => {
            clearTimeout(timeout);
            persistent.removeEventListener("loadedmetadata", onReady);
            persistent.removeEventListener("error", onErr);
            reject(new Error("Failed to load persistent video"));
          };
          persistent.addEventListener("loadedmetadata", onReady);
          persistent.addEventListener("error", onErr);
          persistent.load();
        });

        sourceRef.current = sourceVideo;
        loopRef.current = loop ?? true;
        pipVideoSrcRef.current = src;

        registerAudioSource("pip-video", () => {
          try {
            if (document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(() => {});
            }
          } catch {}
          cleanup();
        });

        persistent.muted = false;
        persistent.playsInline = true;

        const currentTime = sourceVideo.currentTime;
        if (currentTime > 0 && isFinite(currentTime)) {
          try { persistent.currentTime = currentTime; } catch {}
        }

        await persistent.play();
        await persistent.requestPictureInPicture();

        sourceVideo.muted = true;
        try { sourceVideo.pause(); } catch {}
      }

      if ("mediaSession" in navigator) {
        const target = needsHlsJs ? hlsVideo : persistent;
        navigator.mediaSession.metadata = new MediaMetadata({ title: "Picture-in-Picture" });
        navigator.mediaSession.setActionHandler("play", () => { target.play().catch(() => {}); });
        navigator.mediaSession.setActionHandler("pause", () => { target.pause(); });
        navigator.mediaSession.setActionHandler("seekbackward", () => { target.currentTime = Math.max(0, target.currentTime - 10); });
        navigator.mediaSession.setActionHandler("seekforward", () => { target.currentTime = Math.min(target.duration || 0, target.currentTime + 10); });
      }

      switchingRef.current = false;
      enteringRef.current = false;
      setIsPiP(true);
      setPipVideoSrc(src);
    } catch (err: any) {
      console.warn("[PiP] Failed to enter PiP:", err?.message || err);
      switchingRef.current = false;
      enteringRef.current = false;
      destroyHls();
      persistent.pause();
      persistent.removeAttribute("src");
      persistent.srcObject = null;
      sourceRef.current = null;
      pipVideoSrcRef.current = null;
      try { sourceVideo.muted = false; } catch {}
      unregisterAudioSource("pip-video");
      cleanup();
    }
  }, [pipSupported, cleanup, destroyHls]);

  useEffect(() => {
    const persistent = persistentRef.current;
    if (!persistent) return;

    const onPersistentLeave = () => {
      if (switchingRef.current) return;
      cleanup();
    };

    persistent.addEventListener("leavepictureinpicture", onPersistentLeave);
    return () => {
      persistent.removeEventListener("leavepictureinpicture", onPersistentLeave);
      unregisterAudioSource("pip-video");
      destroyHls();
      try {
        if (document.pictureInPictureElement === persistent) {
          document.exitPictureInPicture().catch(() => {});
        }
      } catch {}
      persistent.pause();
      persistent.removeAttribute("src");
      persistent.srcObject = null;
    };
  }, [cleanup, destroyHls]);

  const notifyUnmount = useCallback((src: string) => {
    if (pipVideoSrcRef.current !== src) return;
    sourceRef.current = null;
  }, []);

  const exitPiP = useCallback(() => {
    try {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }
    } catch {}

    const oldSource = sourceRef.current;
    if (oldSource) {
      try {
        if (typeof (oldSource as any).webkitSetPresentationMode === "function") {
          (oldSource as any).webkitSetPresentationMode("inline");
        }
      } catch {}
      try { oldSource.pause(); } catch {}
      try { oldSource.muted = true; } catch {}
    }

    cleanup();
  }, [cleanup]);

  return (
    <PiPContext.Provider value={{ isPiP, pipVideoSrc, enterPiP, exitPiP, notifyUnmount, pipSupported }}>
      {children}
      <video
        ref={persistentRef}
        style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", zIndex: -1 }}
        playsInline
        data-testid="pip-persistent-video"
      />
      <video
        ref={hlsVideoRef}
        style={{ position: "fixed", width: 1, height: 1, opacity: 0, pointerEvents: "none", zIndex: -1 }}
        playsInline
        data-testid="pip-hls-video"
      />
    </PiPContext.Provider>
  );
}
