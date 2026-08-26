import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { isPWAStandalone, isIOSDevice } from "@/contexts/NostrAuthContext";
import { isOnboardingComplete } from "@/lib/local-account";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY_PREFIX = "relay-outpost-pwa-nudge-dismissed:";
const SHOW_DELAY_MS = 20_000;

function dismissKey(pubkey: string): string {
  return `${DISMISS_KEY_PREFIX}${pubkey}`;
}

function isDismissed(pubkey: string): boolean {
  try { return localStorage.getItem(dismissKey(pubkey)) === "1"; } catch { return false; }
}

function markDismissed(pubkey: string): void {
  try { localStorage.setItem(dismissKey(pubkey), "1"); } catch {}
}

function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

function isAndroidLikely(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function PWAInstallNudge() {
  const { pubkey } = useNostrAuth();
  const [location] = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPWAStandalone()) return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    const installedHandler = () => {
      setVisible(false);
      setDeferredPrompt(null);
      if (pubkey) markDismissed(pubkey);
    };
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (visible) return;
    if (isPWAStandalone()) return;
    if (!pubkey) return;
    if (isDismissed(pubkey)) return;
    if (!isMobileViewport()) return;
    if (!isOnboardingComplete(pubkey)) return;
    if (location !== "/" && location !== "") return;

    const iOS = isIOSDevice();
    const canPrompt = !!deferredPrompt;
    if (!iOS && !canPrompt) return;

    timerRef.current = window.setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pubkey, location, deferredPrompt, visible]);

  if (!visible) return null;

  const iOS = isIOSDevice();

  const handleDismiss = () => {
    if (pubkey) markDismissed(pubkey);
    setVisible(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted" && pubkey) {
        markDismissed(pubkey);
      }
    } catch {
      // ignore
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
      setVisible(false);
    }
  };

  return (
    <div
      className="fixed left-3 right-3 z-[60] pointer-events-none"
      style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
      data-testid="pwa-install-nudge"
    >
      <div className="mx-auto max-w-md pointer-events-auto rounded-lg border border-border/70 bg-card/95 backdrop-blur shadow-lg p-3.5 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-md bg-foreground/5 border border-border/60 flex items-center justify-center shrink-0">
            <Download className="w-4 h-4 text-foreground/80" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">Install Relay Outpost</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {iOS
                ? "Add to your Home Screen for the full app experience — push-style alerts, no browser bars."
                : "One tap to add it to your home screen. Faster open, fewer browser bars."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 p-1"
            data-testid="button-pwa-dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {iOS ? (
          <div className="text-[11px] text-muted-foreground/90 flex items-center gap-1.5 pl-11">
            <span>Tap</span>
            <Share className="w-3.5 h-3.5 inline" aria-hidden="true" />
            <span>then</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border/70 bg-background/60">
              <Plus className="w-3 h-3" aria-hidden="true" /> Add to Home Screen
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 pl-11">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-xs h-8"
              data-testid="button-pwa-not-now"
            >
              Not now
            </Button>
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={installing || !deferredPrompt}
              className="text-xs h-8"
              data-testid="button-pwa-install"
            >
              {installing ? "Installing…" : isAndroidLikely() ? "Install" : "Add to home"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PWAInstallNudge;
