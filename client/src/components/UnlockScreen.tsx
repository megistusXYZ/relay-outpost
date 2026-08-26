import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Fingerprint, KeyRound, Lock, LogOut, ShieldAlert } from "lucide-react";
import { decryptStored, loadLocalAccount, clearLocalAccount, saveLocalAccount, hasStoredLocalSecret, type StoredLocalAccount } from "@/lib/local-account";
import { removeAccount as removeRegisteredAccount } from "@/lib/account-registry";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { canOfferPasskeyEnrollment, describePasskeyPlatform, unlockWithPasskey, PasskeyError, type PasskeyEnrollment } from "@/lib/passkey";
import { PasskeyEnrollmentCard } from "@/components/PasskeyEnrollmentCard";

const PASSKEY_NUDGE_DISMISSED_KEY = "relay-outpost-passkey-nudge-dismissed";
const STAY_NUDGE_DISMISSED_KEY = "relay-outpost-stay-nudge-dismissed";

function isStayNudgeDismissed(pubkey: string): boolean {
  if (!pubkey || typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(STAY_NUDGE_DISMISSED_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(pubkey);
  } catch {
    return false;
  }
}

function markStayNudgeDismissed(pubkey: string): void {
  if (!pubkey || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STAY_NUDGE_DISMISSED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    if (!arr.includes(pubkey)) {
      arr.push(pubkey);
      localStorage.setItem(STAY_NUDGE_DISMISSED_KEY, JSON.stringify(arr));
    }
  } catch {}
}

function isPasskeyNudgeDismissed(pubkey: string): boolean {
  if (!pubkey || typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(PASSKEY_NUDGE_DISMISSED_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(pubkey);
  } catch {
    return false;
  }
}

function markPasskeyNudgeDismissed(pubkey: string): void {
  if (!pubkey || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(PASSKEY_NUDGE_DISMISSED_KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return;
    if (!arr.includes(pubkey)) {
      arr.push(pubkey);
      localStorage.setItem(PASSKEY_NUDGE_DISMISSED_KEY, JSON.stringify(arr));
    }
  } catch {}
}

interface Props {
  variant?: "page" | "overlay";
  account: StoredLocalAccount;
  onUseDifferentAccount: () => void;
  onForget?: () => void;
}

export function UnlockScreen({ variant = "page", account, onUseDifferentAccount, onForget }: Props) {
  const { loginWithLocalKey } = useNostrAuth();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isPasskeyWorking, setIsPasskeyWorking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, setNowTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set after a successful passphrase unlock when we want to offer one-time
  // passkey enrollment before completing sign-in. We hold the unlocked secret
  // in memory only — never persisted — and finish login as soon as the user
  // either enrolls or skips.
  const [pendingSecret, setPendingSecret] = useState<Uint8Array | null>(null);
  const [pendingStaySecret, setPendingStaySecret] = useState<Uint8Array | null>(null);
  const [activePasskey, setActivePasskey] = useState<PasskeyEnrollment | null>(account.passkey ?? null);
  const [isCompletingSignIn, setIsCompletingSignIn] = useState(false);
  const passkeyEnrolled = !!(activePasskey ?? account.passkey);
  const platform = describePasskeyPlatform();

  const cooldownMsLeft = cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;
  const inCooldown = cooldownMsLeft > 0;
  const cooldownSeconds = Math.ceil(cooldownMsLeft / 1000);

  useEffect(() => {
    if (!inCooldown) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    tickRef.current = setInterval(() => {
      setNowTick((n) => n + 1);
      if (cooldownUntil && Date.now() >= cooldownUntil) {
        setCooldownUntil(null);
      }
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [inCooldown, cooldownUntil]);

  const isOverlay = variant === "overlay";
  const cardCls = isOverlay ? "border-white/10 bg-black/40 backdrop-blur-lg" : "border-border/60 bg-card/50";
  const titleCls = isOverlay ? "text-white" : "";
  const descCls = isOverlay ? "text-white/60" : "text-muted-foreground";
  const subtleCls = isOverlay ? "text-white/40" : "text-muted-foreground/70";
  const inputCls = isOverlay ? "bg-black/30 border-white/15 text-white placeholder:text-white/25" : "bg-background/50";
  const primaryBtnCls = isOverlay ? "bg-white text-black hover:bg-white/90" : "bg-foreground text-background hover:bg-foreground/90";
  const ghostBtnCls = isOverlay ? "text-white/60" : "text-muted-foreground";

  const completeSignIn = useCallback(async (secret: Uint8Array, opts: { persistPlainSecret?: boolean } = {}) => {
    setIsCompletingSignIn(true);
    try {
      await loginWithLocalKey(secret, { persistPlainSecret: opts.persistPlainSecret });
    } finally {
      setIsCompletingSignIn(false);
    }
  }, [loginWithLocalKey]);

  // After unlock, decide whether to offer the "stay signed in next time?"
  // promotion. We only ask once per account (dismissal is sticky), and we
  // skip when a plaintext secret is already persisted (nothing to promote).
  const maybePromoteStaySession = useCallback((secret: Uint8Array): boolean => {
    if (hasStoredLocalSecret()) return false;
    if (isStayNudgeDismissed(account.pubkey)) return false;
    setPendingStaySecret(secret);
    return true;
  }, [account.pubkey]);

  const handlePasskeyUnlock = useCallback(async () => {
    const blob = activePasskey ?? account.passkey;
    if (!blob || isPasskeyWorking || isWorking) return;
    setIsPasskeyWorking(true);
    try {
      const secretKey = await unlockWithPasskey(blob);
      setAttempts(0);
      setCooldownUntil(null);
      // Mirror the passphrase path: offer the one-time "Stay signed in
      // next time?" promotion before completing sign-in. Passkey users
      // who accept the promotion skip even the passkey tap on reload.
      if (maybePromoteStaySession(secretKey)) return;
      await completeSignIn(secretKey);
    } catch (err) {
      const code = err instanceof PasskeyError ? err.code : "unknown";
      if (code !== "cancelled") {
        console.warn("Passkey unlock failed:", err);
        toast({
          title: "Couldn't unlock with passkey",
          description: "Use your passphrase instead.",
          variant: "destructive",
        });
      }
    } finally {
      setIsPasskeyWorking(false);
    }
  }, [activePasskey, account.passkey, isPasskeyWorking, isWorking, completeSignIn, maybePromoteStaySession, toast]);

  const handleUnlock = useCallback(async () => {
    if (!password) return;
    if (inCooldown) return;
    setIsWorking(true);
    try {
      const secretKey = await new Promise<Uint8Array>((resolve, reject) => {
        setTimeout(() => {
          try { resolve(decryptStored(account.ncryptsec, password)); }
          catch (e) { reject(e); }
        }, 30);
      });
      setAttempts(0);
      setCooldownUntil(null);
      // If this device can offer one-tap unlock and we haven't already enrolled
      // a passkey or asked-and-been-dismissed, briefly hand off to the nudge
      // step before completing sign-in. The unlocked secret is held in memory
      // only and is consumed as soon as the user enrolls or skips.
      if (!activePasskey && !isPasskeyNudgeDismissed(account.pubkey)) {
        const canOffer = await canOfferPasskeyEnrollment();
        if (canOffer) {
          setPendingSecret(secretKey);
          return;
        }
      }
      if (maybePromoteStaySession(secretKey)) return;
      await completeSignIn(secretKey);
    } catch (err) {
      console.warn("Unlock failed:", err);
      setAttempts((prev) => {
        const next = prev + 1;
        // Tiered cooldown: protects a stolen device from offline brute-force
        // without punishing genuine typos. Only the active browser tab is gated;
        // the encrypted blob itself is untouched.
        if (next >= 10) {
          setCooldownUntil(Date.now() + 5 * 60 * 1000);
        } else if (next >= 5) {
          setCooldownUntil(Date.now() + 30 * 1000);
        }
        return next;
      });
      setPassword("");
      toast({
        title: "Wrong passphrase",
        description: "Try again, or restore from your backup file.",
        variant: "destructive",
      });
    } finally {
      setIsWorking(false);
    }
  }, [password, account, completeSignIn, toast, inCooldown, activePasskey, maybePromoteStaySession]);

  const handleNudgeEnrolled = useCallback((blob: PasskeyEnrollment) => {
    const updated: StoredLocalAccount = { ...account, passkey: blob };
    saveLocalAccount(updated);
    setActivePasskey(blob);
  }, [account]);

  const handleNudgeContinue = useCallback(async () => {
    if (!pendingSecret) return;
    // If they enrolled, nothing to dismiss; if they skipped without enrolling,
    // remember the dismissal so we don't ask again on this device.
    if (!activePasskey) {
      markPasskeyNudgeDismissed(account.pubkey);
    }
    const secret = pendingSecret;
    setPendingSecret(null);
    // Chain into the stay-signed-in promotion before finalizing sign-in.
    if (maybePromoteStaySession(secret)) return;
    await completeSignIn(secret);
  }, [pendingSecret, activePasskey, account.pubkey, completeSignIn, maybePromoteStaySession]);

  const handleStayAccept = useCallback(async () => {
    if (!pendingStaySecret) return;
    const secret = pendingStaySecret;
    setPendingStaySecret(null);
    // Don't re-prompt: persisting the secret IS the answer.
    markStayNudgeDismissed(account.pubkey);
    await completeSignIn(secret, { persistPlainSecret: true });
  }, [pendingStaySecret, account.pubkey, completeSignIn]);

  const handleStayDecline = useCallback(async () => {
    if (!pendingStaySecret) return;
    const secret = pendingStaySecret;
    setPendingStaySecret(null);
    markStayNudgeDismissed(account.pubkey);
    await completeSignIn(secret);
  }, [pendingStaySecret, account.pubkey, completeSignIn]);

  const handleForget = useCallback(() => {
    const ok = window.confirm(
      "Forget this account from this device?\n\n" +
      "Your encrypted key will be removed from this browser. You can still restore it from your backup file or another device."
    );
    if (!ok) return;
    // Multi-account: drop this account's registry entry and its per-pubkey
    // namespaced credential copies FIRST (clearLocalAccount only tidies
    // unregistered mirrors). Other accounts on this device are untouched;
    // if any remain, the next app load switches to one of them.
    try { removeRegisteredAccount(account.pubkey); } catch {}
    clearLocalAccount();
    // "Forget" must also wipe the plaintext "stay signed in" secret AND any
    // dismissal markers — otherwise the next sign-in inherits stale prompt
    // state from the account we just told the device to forget.
    try { localStorage.removeItem("relay-outpost-local-secret"); } catch {}
    try { localStorage.removeItem("relay-outpost-stay-nudge-dismissed"); } catch {}
    try { localStorage.removeItem("relay-outpost-passkey-nudge-dismissed"); } catch {}
    // Tidy up other identity artifacts so re-entering this screen doesn't see stale state
    try {
      const savedMethod = localStorage.getItem("relay-outpost-login-method");
      if (savedMethod === "local") {
        localStorage.removeItem("relay-outpost-login-method");
        localStorage.removeItem("relay-outpost-pubkey");
      }
      // Clear the per-pubkey onboarding marker for this account
      const raw = localStorage.getItem("relay-outpost-onboarding-complete");
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const next = arr.filter((p: string) => p !== account.pubkey);
          if (next.length === 0) localStorage.removeItem("relay-outpost-onboarding-complete");
          else localStorage.setItem("relay-outpost-onboarding-complete", JSON.stringify(next));
        }
      }
    } catch {}
    if (onForget) onForget();
    else onUseDifferentAccount();
  }, [onForget, onUseDifferentAccount, account.pubkey]);

  const label = account.label || "Welcome back";
  const npubShort = `${account.npub.slice(0, 12)}…${account.npub.slice(-6)}`;

  if (pendingStaySecret) {
    return (
      <div className="space-y-4" data-testid="container-unlock-stay-nudge">
        <Card className={cardCls}>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-12 h-12 rounded-md ${isOverlay ? "bg-emerald-500/10 border border-emerald-400/25" : "bg-emerald-500/10 border border-emerald-500/25"}`}>
                <KeyRound className={`w-6 h-6 ${isOverlay ? "text-emerald-300" : "text-emerald-700"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className={`text-base font-semibold ${titleCls}`} data-testid="text-stay-nudge-title">Stay signed in next time?</h3>
                <p className={`text-xs mt-0.5 ${descCls}`}>Skip the passphrase on this device. Sign out from the menu when you want to remove your key.</p>
              </div>
            </div>

            <div className={`rounded-md p-3 ${isOverlay ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-500/5 border border-amber-500/30"}`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-amber-300" : "text-amber-600"}`} />
                <p className={`text-xs leading-relaxed ${descCls}`}>
                  Your key will be saved on this device. Anyone with access to this browser profile can use this account.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={handleStayAccept}
                disabled={isCompletingSignIn}
                className={`w-full text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                data-testid="button-stay-nudge-accept"
              >
                {isCompletingSignIn ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : null}
                {isCompletingSignIn ? "Signing in…" : "Yes, stay signed in"}
              </Button>
              <Button
                variant="ghost"
                onClick={handleStayDecline}
                disabled={isCompletingSignIn}
                className={`w-full text-[11px] font-brand uppercase tracking-widest ${ghostBtnCls}`}
                data-testid="button-stay-nudge-decline"
              >
                Keep asking for my passphrase
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (pendingSecret) {
    return (
      <div className="space-y-4" data-testid="container-unlock-passkey-nudge">
        <Card className={cardCls}>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-12 h-12 rounded-md ${isOverlay ? "bg-emerald-500/10 border border-emerald-400/25" : "bg-emerald-500/10 border border-emerald-500/25"}`}>
                <KeyRound className={`w-6 h-6 ${isOverlay ? "text-emerald-300" : "text-emerald-700"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className={`text-base font-semibold ${titleCls}`} data-testid="text-passkey-nudge-title">Skip the passphrase next time?</h3>
                <p className={`text-xs mt-0.5 ${descCls}`}>One tap with {platform.name} on this device. Your passphrase still works as a backup.</p>
              </div>
            </div>

            <PasskeyEnrollmentCard
              variant={variant}
              secretKey={pendingSecret}
              pubkey={account.pubkey}
              npub={account.npub}
              accountLabel={account.label || "Relay Outpost account"}
              enrolled={!!activePasskey}
              onEnrolled={handleNudgeEnrolled}
            />

            <Button
              onClick={handleNudgeContinue}
              disabled={isCompletingSignIn}
              className={`w-full text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
              data-testid="button-nudge-continue"
            >
              {isCompletingSignIn ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : null}
              {isCompletingSignIn
                ? "Signing in…"
                : activePasskey
                  ? "Continue"
                  : "Not now — keep using passphrase"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="container-unlock">
      <Card className={cardCls}>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-md ${isOverlay ? "bg-white/5 border border-white/10" : "bg-foreground/5 border border-border/40"}`}>
              <Lock className={`w-6 h-6 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />
            </div>
            <div className="min-w-0">
              <h3 className={`text-base font-semibold truncate ${titleCls}`} data-testid="text-unlock-label">{label}</h3>
              <p className={`text-[11px] font-mono mt-0.5 ${subtleCls}`} data-testid="text-unlock-npub">{npubShort}</p>
            </div>
          </div>

          {passkeyEnrolled && (
            <div className="space-y-2">
              <Button
                onClick={handlePasskeyUnlock}
                disabled={isPasskeyWorking || isWorking}
                className={`w-full text-xs font-brand uppercase tracking-widest ${
                  isOverlay ? "bg-brand/90 text-white hover:bg-brand" : "bg-brand text-white hover:bg-brand"
                }`}
                data-testid="button-unlock-passkey"
              >
                {isPasskeyWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <Fingerprint className="w-4 h-4 mr-2" />}
                {isPasskeyWorking ? "Waiting for your device…" : `Unlock with ${platform.name}`}
              </Button>
              <div className="flex items-center gap-3">
                <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border/60"}`} />
                <span className={`text-[10px] font-brand uppercase tracking-[0.18em] ${subtleCls}`}>or passphrase</span>
                <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border/60"}`} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className={`text-[11px] font-brand uppercase tracking-widest ${subtleCls}`}>Passphrase</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter to unlock"
                className={`${inputCls} pr-10`}
                style={{ fontSize: 16 }}
                autoFocus
                autoComplete="current-password"
                data-testid="input-unlock-passphrase"
                onKeyDown={(e) => { if (e.key === "Enter" && password) handleUnlock(); }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 ${ghostBtnCls}`}
                data-testid="button-toggle-unlock-visibility"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {inCooldown && (
            <div
              className={`rounded-md p-3 ${isOverlay ? "bg-rose-500/10 border border-rose-500/25" : "bg-rose-500/10 border border-rose-500/30"}`}
              data-testid="banner-unlock-cooldown"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-rose-300" : "text-rose-600"}`} />
                <p className={`text-[11px] ${descCls}`}>
                  Too many attempts. For your protection, please wait{" "}
                  <strong data-testid="text-cooldown-seconds">
                    {cooldownSeconds >= 60
                      ? `${Math.ceil(cooldownSeconds / 60)} min`
                      : `${cooldownSeconds}s`}
                  </strong>{" "}
                  before trying again.
                </p>
              </div>
            </div>
          )}
          {!inCooldown && attempts >= 2 && (
            <div className={`rounded-md p-3 ${isOverlay ? "bg-amber-500/10 border border-amber-500/20" : "bg-amber-500/10 border border-amber-500/30"}`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-amber-300" : "text-amber-600"}`} />
                <p className={`text-[11px] ${descCls}`}>
                  Stuck? Use <strong>Sign in another way</strong> below to import your nsec or your encrypted backup file from another device.
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={handleUnlock}
            disabled={!password || isWorking || inCooldown}
            className={`w-full text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
            data-testid="button-unlock"
          >
            {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
            {isWorking
              ? "Unlocking…"
              : inCooldown
                ? `Wait ${cooldownSeconds >= 60 ? `${Math.ceil(cooldownSeconds / 60)} min` : `${cooldownSeconds}s`}`
                : "Unlock"}
          </Button>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={onUseDifferentAccount}
              className={`flex-1 text-[11px] font-brand uppercase tracking-widest ${ghostBtnCls}`}
              data-testid="button-use-different-account"
            >
              Sign in another way
            </Button>
            <Button
              variant="ghost"
              onClick={handleForget}
              className={`text-[11px] font-brand uppercase tracking-widest ${ghostBtnCls}`}
              data-testid="button-forget-account"
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Forget
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function loadStoredLocalAccount() {
  return loadLocalAccount();
}
