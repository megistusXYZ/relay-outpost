import { useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { Unplug, ShieldAlert, ChevronDown, ChevronUp, X, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const DISMISS_KEY = "relay-outpost-signer-banner-dismissed";

export function SignerDisconnectedBanner() {
  const { signerDisconnected, pubkey, logout, loginMethod, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [reconnecting, setReconnecting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  if (!signerDisconnected || !pubkey || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };

  const reconnectLabel = loginMethod === "qr" ? "Reconnect" : loginMethod === "bunker" ? "Reconnect" : "Reconnect";

  return (
    <div
      className="relative mx-2 sm:mx-3 mt-2 mb-1 rounded-xl overflow-hidden border border-amber-400/40 dark:border-brand/40 animate-in slide-in-from-top-2 fade-in duration-500"
      data-testid="banner-signer-disconnected"
    >
      <div className="absolute inset-0 bg-amber-50 dark:bg-[#1a1033] backdrop-blur-sm" />

      <div className="relative z-10 px-3 sm:px-4 py-2.5 sm:py-3">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <div className="flex-shrink-0 mt-0.5">
            <div className="relative">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-100 dark:bg-brand/50 flex items-center justify-center border border-amber-300/60 dark:border-brand/30">
                <Unplug className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-600 dark:text-brand" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-amber-400 dark:bg-brand animate-pulse" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h3 className="text-[13px] sm:text-sm font-semibold font-[Space_Grotesk] text-amber-900 dark:text-brand tracking-wide">
                Signal Lost
              </h3>
              <span className="text-[9px] sm:text-[10px] font-mono px-1 sm:px-1.5 py-0.5 rounded-full bg-amber-200/70 dark:bg-brand/60 text-amber-700 dark:text-brand border border-amber-300/50 dark:border-brand/30 uppercase tracking-wider whitespace-nowrap">
                Read Only
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-amber-800 dark:text-brand/80 mt-0.5 sm:mt-1 leading-relaxed">
              {loginMethod === "qr"
                ? "Remote signer session may have expired. Try reconnecting or re-scan the QR code."
                : loginMethod === "bunker"
                ? "Remote signer is offline. Browsing works, but posting and zapping are paused."
                : "Signing extension is offline. Browsing works, but posting and zapping are paused."}
            </p>

            {expanded && (
              <div className="mt-2 sm:mt-3 space-y-2 sm:space-y-3 animate-in slide-in-from-top-1 fade-in duration-300">
                <div className="rounded-lg bg-amber-100/60 dark:bg-brand/40 border border-amber-200/50 dark:border-brand/25 p-2.5 sm:p-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                    <ShieldAlert className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600 dark:text-brand" />
                    <span className="text-[11px] sm:text-xs font-semibold font-[Space_Grotesk] text-amber-900 dark:text-brand">How Nostr Keys Work</span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-amber-800/80 dark:text-brand/70 leading-relaxed">
                    On Nostr, your identity lives in a cryptographic key pair — not on any server. Your signer (browser extension like nos2x/Alby, or a remote signer like nsec.app) holds your private key and signs messages on your behalf. Without it, Relay Outpost can recognize who you are (your public key is cached locally), but it cannot prove you are you. Think of it like having your passport photo on file, but needing the actual passport to travel.
                  </p>
                </div>

                <div className="rounded-lg bg-amber-100/60 dark:bg-brand/40 border border-amber-200/50 dark:border-brand/25 p-2.5 sm:p-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                    <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600 dark:text-brand" />
                    <span className="text-[11px] sm:text-xs font-semibold font-[Space_Grotesk] text-amber-900 dark:text-brand">What You Can Still Do</span>
                  </div>
                  <ul className="text-[10px] sm:text-[11px] text-amber-800/80 dark:text-brand/70 leading-relaxed space-y-0.5 sm:space-y-1">
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-600 dark:text-emerald-400 mt-px">●</span>
                      <span>Browse your feed and explore content</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-600 dark:text-emerald-400 mt-px">●</span>
                      <span>View profiles, articles, and media</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-500 dark:text-amber-400 mt-px">●</span>
                      <span>Posts, zaps, and reactions are paused</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-red-500 dark:text-red-400 mt-px">●</span>
                      <span>DMs cannot be decrypted or sent</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1 sm:gap-2 mt-2 sm:mt-2.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 sm:h-8 px-2 sm:px-3 text-[11px] sm:text-xs text-amber-700 dark:text-brand hover:bg-amber-200/50 dark:hover:bg-brand/40"
                onClick={() => setExpanded(!expanded)}
                data-testid="button-signer-banner-learn"
              >
                {expanded ? <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-0.5" /> : <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 mr-0.5" />}
                {expanded ? "Less" : "Details"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 sm:h-8 px-2 sm:px-3 text-[11px] sm:text-xs text-amber-700 dark:text-brand hover:bg-amber-200/50 dark:hover:bg-brand/40"
                disabled={reconnecting}
                onClick={async () => {
                  setReconnecting(true);
                  const ok = await attemptReconnect();
                  setReconnecting(false);
                  if (!ok) {
                    toast({
                      title: "Reconnect failed",
                      description: loginMethod === "qr"
                        ? "Your QR signer session has expired. Log out and re-scan the QR code to start a fresh session."
                        : loginMethod === "bunker"
                        ? "Could not reach your remote signer. Make sure your signer app (e.g. nsec.app) is open and connected, then try again."
                        : "Could not reach your signing extension. Make sure it is installed and enabled, then try again.",
                      variant: "destructive",
                    });
                  }
                }}
                data-testid="button-signer-reconnect"
              >
                {reconnecting ? "Trying…" : reconnectLabel}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 sm:h-8 px-2 sm:px-3 text-[11px] sm:text-xs text-amber-700 dark:text-brand hover:bg-amber-200/50 dark:hover:bg-brand/40"
                onClick={logout}
                data-testid="button-signer-logout"
              >
                Log out
              </Button>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 text-amber-600 dark:text-brand hover:bg-amber-200/50 dark:hover:bg-brand/40"
            onClick={handleDismiss}
            data-testid="button-dismiss-signer-banner"
          >
            <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
