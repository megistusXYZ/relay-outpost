import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePWAInstall } from "@/hooks/use-pwa-install";
import { isOnboardingComplete } from "@/lib/local-account";
import { installGuideFor, offerInstallCard } from "@/lib/install-guide";
import { InstallSteps } from "@/components/install/InstallSteps";

// Kept from the old install pop-up, so a "no thanks" given there still holds.
const dismissKey = (pubkey: string) => `relay-outpost-pwa-nudge-dismissed:${pubkey}`;

function isDismissed(pubkey: string): boolean {
  try { return localStorage.getItem(dismissKey(pubkey)) === "1"; } catch { return false; }
}
function markDismissed(pubkey: string): void {
  try { localStorage.setItem(dismissKey(pubkey), "1"); } catch { /* storage blocked: hides for this visit only */ }
}

/**
 * One inline card on Home, offered once after onboarding on a phone or tablet:
 * install the app to get notified about replies and open it like any app.
 * Dismissed per account, for good. Never a pop-up.
 */
export function InstallFirstCard({ pubkey, className = "" }: { pubkey: string; className?: string }) {
  const pwa = usePWAInstall();
  const [dismissed, setDismissed] = useState(() => isDismissed(pubkey));
  const [showSteps, setShowSteps] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);

  const guide = installGuideFor(pwa.installMethod, {
    ipad: pwa.isIPad, android: pwa.isAndroid, inAppBrowser: pwa.inAppBrowser,
  });
  const offered = justInstalled || offerInstallCard({
    method: pwa.installMethod,
    mobile: pwa.isMobileViewport,
    onboarded: isOnboardingComplete(pubkey),
    dismissed,
  });
  if (!offered || (!guide && !justInstalled)) return null;

  const dismiss = () => {
    markDismissed(pubkey);
    setDismissed(true);
    setJustInstalled(false);
  };

  const install = async () => {
    setInstalling(true);
    const outcome = await pwa.promptInstall();
    setInstalling(false);
    if (outcome === "accepted") {
      markDismissed(pubkey);
      setJustInstalled(true);
    } else if (outcome === "unavailable") {
      // The browser said no without asking; its own menu still works.
      setShowSteps(true);
    }
  };

  const fallback = installGuideFor("unsupported", { ipad: false, android: pwa.isAndroid, inAppBrowser: null });

  return (
    <section
      className={`relative rounded-lg border border-border/70 bg-card/80 p-4 ${className}`}
      aria-label="Get the app"
      data-testid="card-install-first"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Don't show this again"
        className="absolute top-1.5 right-1.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        data-testid="button-install-first-dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      {justInstalled ? (
        <p className="flex items-center gap-1.5 pr-10 text-sm text-success dark:text-emerald-400" data-testid="text-install-first-done">
          <Check className="w-4 h-4" />
          Installed. Open Relay Outpost from your home screen.
        </p>
      ) : (
        <>
          <p className="pr-10 text-sm font-medium text-foreground">Get the app</p>
          <p className="mt-1 pr-10 text-[13px] leading-relaxed text-muted-foreground">
            Get notified when someone replies, and open Relay Outpost from your home screen like any app.
            No app store.
          </p>

          {guide?.action === "prompt" ? (
            <>
              {showSteps && fallback && <InstallSteps guide={fallback} className="mt-3 text-foreground/85" />}
              <div className="mt-3 flex items-center gap-3">
                <Button size="sm" className="h-9" onClick={install} disabled={installing} data-testid="button-install-first">
                  {installing ? "Installing…" : "Install"}
                </Button>
                <button type="button" onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground min-h-[44px]" data-testid="link-install-first-skip">
                  Not now
                </button>
              </div>
            </>
          ) : showSteps && guide ? (
            <InstallSteps guide={guide} className="mt-3 text-foreground/85" />
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" variant="outline" className="h-9" onClick={() => setShowSteps(true)} data-testid="button-install-first-how">
                Show me how
              </Button>
              <button type="button" onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground min-h-[44px]" data-testid="link-install-first-skip">
                Not now
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default InstallFirstCard;
