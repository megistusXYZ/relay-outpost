import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Fingerprint, ShieldCheck } from "lucide-react";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { useToast } from "@/hooks/use-toast";
import {
  detectPasskeySupport,
  describePasskeyPlatform,
  enrollPasskey,
  PasskeyError,
  type PasskeyEnrollment,
  type PasskeySupportLevel,
} from "@/lib/passkey";

interface Props {
  variant?: "page" | "overlay";
  /** Raw secret key bytes — never persisted by this component. */
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
  accountLabel: string;
  enrolled: boolean;
  onEnrolled: (blob: PasskeyEnrollment) => void;
}

export function PasskeyEnrollmentCard({
  variant = "page",
  secretKey,
  pubkey,
  npub,
  accountLabel,
  enrolled,
  onEnrolled,
}: Props) {
  const isOverlay = variant === "overlay";
  const { toast } = useToast();
  const [support, setSupport] = useState<PasskeySupportLevel | null>(null);
  const [working, setWorking] = useState(false);
  const platform = describePasskeyPlatform();

  useEffect(() => {
    let cancelled = false;
    detectPasskeySupport().then((s) => { if (!cancelled) setSupport(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleEnroll = async () => {
    setWorking(true);
    try {
      const blob = await enrollPasskey({ secretKey, pubkey, npub, accountLabel });
      onEnrolled(blob);
      toast({
        title: "Passkey saved",
        description: `${platform.name} now unlocks this account on this device.`,
      });
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : "unknown";
      if (code === "cancelled") {
        // Silent — user dismissed the OS prompt.
      } else if (code === "no-prf") {
        toast({
          title: "Passkey not compatible",
          description:
            "Your passkey was created, but this device doesn't expose the secure derivation we need. Use your passphrase to sign in.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't save passkey",
          description: err instanceof Error ? err.message : "Try again, or skip and use your passphrase.",
          variant: "destructive",
        });
      }
    } finally {
      setWorking(false);
    }
  };

  // Don't render if there's no chance of working.
  if (support === "no-webauthn" || support === "insecure-context") return null;

  const cardCls = isOverlay
    ? "bg-brand/[0.07] border border-brand/25"
    : "bg-primary/[0.06] border border-primary/25";
  const titleCls = isOverlay ? "text-white" : "text-foreground";
  const bodyCls = isOverlay ? "text-white/75" : "text-foreground/75";
  const subtleCls = isOverlay ? "text-white/55" : "text-muted-foreground";
  const btnCls = isOverlay ? "bg-brand/90 text-white hover:bg-brand" : "bg-primary text-primary-foreground hover:bg-primary/90";

  if (enrolled) {
    return (
      <div className={`rounded-xl p-3.5 ${cardCls}`} data-testid="panel-passkey-enrolled">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg ${
            isOverlay ? "bg-emerald-500/15 border border-emerald-400/25 text-emerald-200" : "bg-emerald-500/10 border border-emerald-500/25 text-emerald-700"
          }`}>
            <Check className="w-4.5 h-4.5" />
          </span>
          <div className="space-y-1 min-w-0 flex-1">
            <p className={`text-[13px] font-semibold ${titleCls}`}>
              {platform.name} is now your unlock
            </p>
            <p className={`text-xs leading-relaxed ${bodyCls}`}>
              Sign in with a tap on this device. Your passkey is stored by your operating system and syncs across your devices through {platform.name.startsWith("Face") || platform.name.startsWith("Touch") ? "iCloud Keychain" : platform.name.startsWith("fingerprint") ? "Google Password Manager" : "your account sync"}. Relay Outpost has no copy of it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (support === "no-platform-auth") {
    return (
      <div className={`rounded-xl p-3.5 ${cardCls}`} data-testid="panel-passkey-unsupported">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg ${
            isOverlay ? "bg-white/5 border border-white/10 text-white/60" : "bg-foreground/5 border border-border/40 text-foreground/60"
          }`}>
            <Fingerprint className="w-4.5 h-4.5" />
          </span>
          <div className="space-y-1 min-w-0 flex-1">
            <p className={`text-[13px] font-semibold ${titleCls}`}>One-tap unlock isn't set up on this device</p>
            <p className={`text-xs leading-relaxed ${bodyCls}`}>
              We didn't find Face ID, Touch ID, fingerprint, or Windows Hello here. You can still create your account and sign in with your passphrase as usual.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl p-3.5 ${cardCls}`} data-testid="panel-passkey-offer">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg ${
          isOverlay ? "bg-brand/20 border border-brand/25 text-brand" : "bg-brand/15 border border-brand/25 text-brand"
        }`}>
          <Fingerprint className="w-4.5 h-4.5" />
        </span>
        <div className="space-y-2.5 min-w-0 flex-1">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-[13px] font-semibold ${titleCls}`}>
                Make sign-in instant
              </p>
              <span className={`text-[10px] font-brand uppercase tracking-[0.14em] font-bold px-1.5 py-0.5 rounded ${
                isOverlay ? "bg-white/10 text-white/70" : "bg-foreground/10 text-foreground/70"
              }`}>
                Recommended
              </span>
            </div>
            <p className={`text-xs leading-relaxed mt-1 ${bodyCls}`}>
              Use {platform.name} to unlock this account with a tap. Your phone or computer creates the unlock key and stores it in {platform.name.startsWith("Face") || platform.name.startsWith("Touch") ? "iCloud Keychain" : platform.name.startsWith("fingerprint") ? "Google Password Manager" : "your OS keychain"} — Relay Outpost never sees it.
            </p>
          </div>

          <ul className={`text-[11.5px] space-y-1.5 ${bodyCls}`}>
            <li className="flex items-start gap-2">
              <ShieldCheck className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isOverlay ? "text-emerald-300" : "text-emerald-600"}`} />
              <span>Syncs to your other Apple / Google devices automatically</span>
            </li>
            <li className="flex items-start gap-2">
              <RelayOutpostIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isOverlay ? "text-brand" : "text-brand"}`} />
              <span>Your passphrase still works as the recovery path</span>
            </li>
          </ul>

          <Button
            onClick={handleEnroll}
            disabled={working || support === null}
            className={`w-full h-auto min-h-[44px] py-2.5 text-[11px] sm:text-xs font-brand uppercase tracking-wide leading-snug whitespace-normal text-center ${btnCls}`}
            data-testid="button-enroll-passkey"
          >
            <Fingerprint className="w-4 h-4 mr-2 shrink-0" />
            <span className="min-w-0">{working ? "Waiting for your device…" : platform.verb}</span>
          </Button>
          <p className={`text-[10.5px] text-center ${subtleCls}`}>
            Optional. You can do this later in Settings.
          </p>
        </div>
      </div>
    </div>
  );
}
