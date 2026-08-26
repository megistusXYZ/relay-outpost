import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, Plus, X, Check } from "lucide-react";
import { usePWAInstall } from "@/hooks/use-pwa-install";

const SESSION_DISMISS_KEY = "relay-outpost-install-first-dismissed";

function isSessionDismissed(): boolean {
  try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1"; } catch { return false; }
}
function markSessionDismissed(): void {
  try { sessionStorage.setItem(SESSION_DISMISS_KEY, "1"); } catch {}
}

interface Props {
  variant?: "page" | "overlay";
}

/**
 * Pre-account install nudge shown above the Create Account banner on mobile
 * when the app isn't already running as an installed PWA. Quiet, dismissible,
 * and never blocking — the goal is to set users up so the account they're
 * about to create lives inside the home-screen app from the start (this
 * matters most on iOS, where Safari and the standalone PWA use separate
 * storage partitions and keys created in one don't appear in the other).
 */
export function InstallFirstCard({ variant = "overlay" }: Props) {
  const { isStandalone, isIOS, isMobileViewport, isAndroid, canPromptInstall, installed, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState<boolean>(() => isSessionDismissed());
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Hide for: desktop, already installed, in-standalone, dismissed-this-session.
  if (typeof window === "undefined") return null;
  if (isStandalone) return null;
  if (!isMobileViewport) return null;
  if (dismissed) return null;

  // On Android, we can only meaningfully act when beforeinstallprompt has
  // fired. If it hasn't (Chrome's engagement heuristics), stay quiet rather
  // than show a button that does nothing.
  if (!isIOS && !canPromptInstall) return null;

  const isOverlay = variant === "overlay";

  const handleDismiss = () => {
    markSessionDismissed();
    setDismissed(true);
  };

  const handleInstallAndroid = async () => {
    setInstalling(true);
    const outcome = await promptInstall();
    setInstalling(false);
    if (outcome === "accepted") {
      // The appinstalled event will flip `installed`; the card will then
      // hide itself on the next render via the standalone check.
    }
  };

  const handleRevealIOSHint = () => {
    setShowIOSHint(true);
  };

  return (
    <div
      className={`relative rounded-lg overflow-hidden border ${
        isOverlay
          ? "bg-white/[0.04] border-white/15 backdrop-blur-sm"
          : "bg-card/80 border-border/70"
      }`}
      data-testid="card-install-first"
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install suggestion"
        className={`absolute top-2.5 right-2.5 p-1 rounded-md ${
          isOverlay ? "text-white/55 hover:text-white/80 hover:bg-white/10" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        }`}
        data-testid="button-install-first-dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="p-4 sm:p-5 flex items-start gap-3.5">
        {/* Tiny home-screen mockup — a quiet, single-glance illustration of
            what the user is about to do. No animation. */}
        <div
          aria-hidden="true"
          className={`shrink-0 w-12 h-[68px] rounded-[10px] border flex flex-col items-center justify-end pb-1 ${
            isOverlay
              ? "bg-gradient-to-b from-white/[0.06] to-white/[0.02] border-white/15"
              : "bg-gradient-to-b from-foreground/[0.04] to-foreground/[0.01] border-border/60"
          }`}
        >
          <div className={`w-7 h-7 rounded-[8px] flex items-center justify-center ${
            isOverlay ? "bg-brand/30 border border-brand/40" : "bg-brand/15 border border-brand/30"
          }`}>
            <Download className={`w-3.5 h-3.5 ${isOverlay ? "text-brand" : "text-brand"}`} />
          </div>
          <div className="flex gap-0.5 mt-1.5">
            <span className={`w-1 h-1 rounded-full ${isOverlay ? "bg-white/30" : "bg-foreground/20"}`} />
            <span className={`w-1 h-1 rounded-full ${isOverlay ? "bg-white/55" : "bg-foreground/40"}`} />
            <span className={`w-1 h-1 rounded-full ${isOverlay ? "bg-white/30" : "bg-foreground/20"}`} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-mono uppercase tracking-[0.32em] ${
            isOverlay ? "text-brand/75" : "text-brand/85"
          }`}>
            Recommended first
          </p>
          <p className={`mt-1 text-sm font-medium leading-snug ${isOverlay ? "text-white" : "text-foreground"}`}>
            Add to your home screen
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${isOverlay ? "text-white/65" : "text-muted-foreground"}`}>
            {isIOS
              ? "Takes five seconds. Your account will live inside the app from the start — not in a Safari tab."
              : "Takes five seconds. Faster open, fewer browser bars, and your account lives inside the app from the start."}
          </p>

          {installed ? (
            <div className={`mt-3 inline-flex items-center gap-1.5 text-xs ${isOverlay ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-400"}`}>
              <Check className="w-3.5 h-3.5" />
              Installed — open from your home screen to continue.
            </div>
          ) : isIOS ? (
            showIOSHint ? (
              <div
                className={`mt-3 rounded-md border px-2.5 py-2 text-[11.5px] leading-relaxed ${
                  isOverlay ? "border-white/15 bg-white/[0.04] text-white/80" : "border-border/70 bg-background/60 text-foreground/80"
                }`}
                data-testid="hint-ios-install"
              >
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span>Tap</span>
                  <Share className="w-3.5 h-3.5 inline" aria-hidden="true" />
                  <span>at the bottom of Safari, then</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${
                    isOverlay ? "border-white/20 bg-white/10" : "border-border/70 bg-background"
                  }`}>
                    <Plus className="w-3 h-3" aria-hidden="true" /> Add to Home Screen
                  </span>
                  <span>.</span>
                </span>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant={isOverlay ? "secondary" : "default"}
                  onClick={handleRevealIOSHint}
                  className="h-8 text-xs"
                  data-testid="button-install-first-ios"
                >
                  Show me how
                </Button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className={`text-xs ${isOverlay ? "text-white/55 hover:text-white/85" : "text-muted-foreground hover:text-foreground"}`}
                  data-testid="link-install-first-skip"
                >
                  Continue in browser
                </button>
              </div>
            )
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleInstallAndroid}
                disabled={installing || !canPromptInstall}
                className="h-8 text-xs"
                data-testid="button-install-first-android"
              >
                {installing ? "Installing…" : isAndroid ? "Install" : "Add to home"}
              </Button>
              <button
                type="button"
                onClick={handleDismiss}
                className={`text-xs ${isOverlay ? "text-white/55 hover:text-white/85" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="link-install-first-skip"
              >
                Continue in browser
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InstallFirstCard;
