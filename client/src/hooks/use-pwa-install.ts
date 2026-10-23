import { useCallback, useEffect, useState } from "react";
import { isPWAStandalone, isIOSDevice, isIPadDevice, isAndroidDevice, isMacSafari, inAppBrowserOf } from "@/lib/platform";
import {
  chooseInstallMethod, runInstallPrompt,
  type BeforeInstallPromptLike, type InstallMethod, type InstallOutcome,
} from "@/lib/install-method";

export interface PWAInstallState {
  /** The one answer every install surface reads (lib/install-method.ts). */
  installMethod: InstallMethod;
  /** The app whose built-in browser this is, or null. */
  inAppBrowser: string | null;
  isStandalone: boolean;
  isIOS: boolean;
  isIPad: boolean;
  isMobileViewport: boolean;
  isAndroid: boolean;
  /** A tap on "Install" can open the browser's own install dialog. */
  canPromptInstall: boolean;
  installed: boolean;
  promptInstall: () => Promise<InstallOutcome>;
}

// ---------------------------------------------------------------------------
// Module-level capture — the ONLY install-prompt (BIP) listener in the app.
// Chromium fires it ONCE, early, usually before any lazily-loaded page mounts
// its hooks, so it is stashed at module scope for any later consumer. App.tsx
// imports this module eagerly so the listener is registered at boot.
// ---------------------------------------------------------------------------
/** Chromium's install-prompt event. */
export const INSTALL_PROMPT_EVENT = "beforeinstallprompt";

let deferredEvent: BeforeInstallPromptLike | null = null;
let appInstalled = false;
/** Web Install threw (not a cancel) this session: the next tap uses the old prompt. */
let webInstallFailed = false;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener(INSTALL_PROMPT_EVENT, (e: Event) => {
    e.preventDefault();
    deferredEvent = e as unknown as BeforeInstallPromptLike;
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

function webInstallAvailable(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.install === "function";
}

/** How this device installs the app, right now. */
export function installMethodNow(): InstallMethod {
  return chooseInstallMethod({
    standalone: isPWAStandalone(),
    installed: appInstalled,
    inAppBrowser: inAppBrowserOf() !== null,
    ios: isIOSDevice(),
    webInstallAvailable: webInstallAvailable(),
    webInstallFailed,
    bipAvailable: !!deferredEvent,
    macSafari: isMacSafari(),
  });
}

/** One tap on "Install". Call it straight from the tap: both APIs need its user activation. */
export async function promptInstallOnce(): Promise<InstallOutcome> {
  const result = await runInstallPrompt(installMethodNow(), {
    install: webInstallAvailable() ? () => navigator.install!() : undefined,
    bip: deferredEvent,
  });
  if (result.webInstallFailed) webInstallFailed = true;
  if (result.bipUsed) deferredEvent = null;
  if (result.outcome === "accepted") appInstalled = true;
  notify();
  return result.outcome;
}

export function usePWAInstall(): PWAInstallState {
  const [isStandalone, setIsStandalone] = useState<boolean>(() => isPWAStandalone());
  const [installed, setInstalled] = useState<boolean>(appInstalled);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => readMobileViewport());
  const [installMethod, setInstallMethod] = useState<InstallMethod>(() => installMethodNow());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sync = () => {
      setInstalled(appInstalled);
      setIsStandalone(isPWAStandalone());
      setInstallMethod(installMethodNow());
    };
    subscribers.add(sync);
    sync();

    const mq = window.matchMedia("(max-width: 768px)");
    const onResize = () => setIsMobileViewport(mq.matches);
    mq.addEventListener?.("change", onResize);
    // Installing from the browser's own menu can switch this very page into
    // the app window (desktop Chrome): follow the display mode, not just load.
    const standaloneMq = window.matchMedia("(display-mode: standalone)");
    standaloneMq.addEventListener?.("change", sync);

    return () => {
      subscribers.delete(sync);
      mq.removeEventListener?.("change", onResize);
      standaloneMq.removeEventListener?.("change", sync);
    };
  }, []);

  const promptInstall = useCallback(() => promptInstallOnce(), []);

  return {
    installMethod,
    inAppBrowser: inAppBrowserOf(),
    isStandalone,
    isIOS: isIOSDevice(),
    isIPad: isIPadDevice(),
    isMobileViewport,
    isAndroid: isAndroidDevice(),
    canPromptInstall: installMethod === "web-install" || installMethod === "bip",
    installed,
    promptInstall,
  };
}
