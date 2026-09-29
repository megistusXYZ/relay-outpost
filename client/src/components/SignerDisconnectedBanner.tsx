import { useState } from "react";
import { Unplug } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { CompactNotice, NoticeAction } from "@/components/CompactNotice";
import { signerNoticeCopy } from "@/lib/signer-notice";

const DISMISS_KEY = "relay-outpost-signer-banner-dismissed";

/**
 * The signer that holds this account's key isn't answering. One slim row
 * (owner, 2026-09-29: the old banner took a quarter of the screen): what's
 * offline, that browsing still works, Reconnect, and a short "Why?" with
 * Log out behind it.
 */
export function SignerDisconnectedBanner() {
  const { signerDisconnected, pubkey, logout, loginMethod, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const [reconnecting, setReconnecting] = useState(false);
  const [why, setWhy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  if (!signerDisconnected || !pubkey || dismissed) return null;
  const copy = signerNoticeCopy(loginMethod);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };

  const reconnect = async () => {
    setReconnecting(true);
    const ok = await attemptReconnect();
    setReconnecting(false);
    if (!ok) toast({ title: "Reconnect failed", description: copy.reconnectFailed, variant: "destructive" });
  };

  return (
    <CompactNotice
      icon={Unplug}
      tone="warning"
      title={copy.title}
      body={copy.body}
      actions={
        <>
          <NoticeAction onClick={reconnect} disabled={reconnecting} testId="button-signer-reconnect">
            {reconnecting ? "Trying…" : "Reconnect"}
          </NoticeAction>
          <NoticeAction onClick={() => setWhy((v) => !v)} testId="button-signer-banner-learn">
            {why ? "Hide" : "Why?"}
          </NoticeAction>
        </>
      }
      more={why && (
        <>
          {copy.why}{" "}
          <button type="button" onClick={logout} className="font-medium text-foreground/80 underline-offset-2 hover:underline" data-testid="button-signer-logout">
            Log out
          </button>
        </>
      )}
      onDismiss={dismiss}
      className="mx-2 sm:mx-3 mt-2 mb-1"
      testId="banner-signer-disconnected"
    />
  );
}
