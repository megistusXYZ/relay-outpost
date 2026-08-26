import { useState, useEffect, useCallback } from "react";
import { isPWAStandalone, isIOSDevice } from "@/contexts/NostrAuthContext";

/** The non-standard `beforeinstallprompt` event (Chromium/Android). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the deferred `beforeinstallprompt` event so the landing roadmap can
 * offer a real "Install app" action, mirroring the pattern in PWAInstallNudge.
 * Returns whether the app can be installed via the native prompt, a function to
 * trigger it, and platform flags for the iOS (Add to Home Screen) fallback.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Stash the event so we can trigger the prompt later from a user gesture.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isStandalone = isPWAStandalone() || installed;
  const isIOS = isIOSDevice();
  const canInstall = !!deferred && !isStandalone;

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === "accepted";
    } catch {
      return false;
    }
  }, [deferred]);

  return { canInstall, promptInstall, isIOS, isStandalone };
}
