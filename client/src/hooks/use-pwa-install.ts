import { useCallback, useEffect, useState } from "react";
import { isPWAStandalone, isIOSDevice } from "@/contexts/NostrAuthContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export interface PWAInstallState {
  isStandalone: boolean;
  isIOS: boolean;
  isMobileViewport: boolean;
  isAndroid: boolean;
  canPromptInstall: boolean;
  installed: boolean;
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

// ---------------------------------------------------------------------------
// Module-level capture. Chromium fires `beforeinstallprompt` ONCE, early —
// usually before any lazily-loaded page (like Settings) mounts its hooks. We
// stash it at module scope so any later consumer can still trigger the native
// prompt. App.tsx imports this module eagerly so the listener is registered
// at boot.
// ---------------------------------------------------------------------------
let deferredEvent: BeforeInstallPromptEvent | null = null;
let appInstalled = false;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferredEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredEvent = null;
    appInstalled = true;
    notify();
  });
}

function readMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

function readIsAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function usePWAInstall(): PWAInstallState {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => isPWAStandalone());
  const [installed, setInstalled] = useState<boolean>(appInstalled);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => readMobileViewport());
  const [canPromptInstall, setCanPromptInstall] = useState<boolean>(!!deferredEvent);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => {
      setCanPromptInstall(!!deferredEvent);
      setInstalled(appInstalled);
      setIsStandalone(isPWAStandalone());
    };
    subscribers.add(sync);
    sync();

    const mq = window.matchMedia("(max-width: 768px)");
    const onResize = () => setIsMobileViewport(mq.matches);
    mq.addEventListener?.("change", onResize);

    return () => {
      subscribers.delete(sync);
      mq.removeEventListener?.("change", onResize);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    const evt = deferredEvent;
    if (!evt) return "unavailable";
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome === "accepted") {
        appInstalled = true;
      }
      deferredEvent = null;
      notify();
      return choice.outcome;
    } catch {
      deferredEvent = null;
      notify();
      return "unavailable";
    }
  }, []);

  return {
    isStandalone,
    isIOS: isIOSDevice(),
    isMobileViewport,
    isAndroid: readIsAndroid(),
    canPromptInstall,
    installed,
    promptInstall,
  };
}
