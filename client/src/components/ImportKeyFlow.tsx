import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, ArrowRightCircle, Eye, EyeOff, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import {
  parseImportedKey,
  decryptImportedNcryptsec,
  encryptSecretKey,
  decryptStored,
  saveLocalAccount,
  saveLocalAccountStrict,
  clearLocalAccount,
  loadLocalAccount,
  pubkeyFromSecret,
  markOnboardingComplete,
  tryStorePassphraseInPasswordManager,
  describeKeyError,
  type StoredLocalAccount,
} from "@/lib/local-account";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { PasskeyEnrollmentCard } from "@/components/PasskeyEnrollmentCard";
import { canOfferPasskeyEnrollment, type PasskeyEnrollment } from "@/lib/passkey";
import { loadImportDraft, saveImportDraft, clearImportDraft, type ImportStep } from "@/lib/import-draft";

// Gated diagnostic logger — flip on with `localStorage["debug-auth"] = "1"`.
function debugAuth(...args: unknown[]) {
  try {
    if (localStorage.getItem("debug-auth") === "1") {
      // eslint-disable-next-line no-console
      console.log("[auth] ImportKeyFlow:", ...args);
    }
  } catch {}
}

// Coordinates with Login.tsx so the post-login redirect is deferred while
// the user is still being shown the passkey-enrollment nudge after import.
// The user is already signed in at that point; the nudge is purely additive.
//
// We persist a timestamp (not just "1") so Login.tsx can treat a stale
// flag as expired — if the user kills the tab abnormally during the
// nudge step, we don't want a future tab in the same session to be held
// on the login page indefinitely.
const PASSKEY_NUDGE_FLAG = "relay-outpost-passkey-nudge-pending";
const PASSKEY_NUDGE_EVENT = "relay-outpost-passkey-nudge-state-change";

function setPasskeyNudgePending(on: boolean) {
  try {
    if (on) sessionStorage.setItem(PASSKEY_NUDGE_FLAG, String(Date.now()));
    else sessionStorage.removeItem(PASSKEY_NUDGE_FLAG);
  } catch {}
  try { window.dispatchEvent(new CustomEvent(PASSKEY_NUDGE_EVENT)); } catch {}
}

interface Props {
  variant?: "page" | "overlay";
  onBack: () => void;
  onComplete: () => void;
}

type Step = "key" | "passphrase" | "passkey";

export function ImportKeyFlow({ variant = "page", onBack, onComplete }: Props) {
  const { loginWithLocalKey } = useNostrAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("key");
  const [keyInput, setKeyInput] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [decryptedSecret, setDecryptedSecret] = useState<Uint8Array | null>(null);
  const [decryptedNpub, setDecryptedNpub] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [savedAccount, setSavedAccount] = useState<StoredLocalAccount | null>(null);
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);
  // Default UX matches the rest of the Nostr ecosystem (Ditto / Iris / Snort
  // / Coracle / Damus Web): paste an nsec, stay signed in. Users who want
  // a device passphrase can opt in via the disclosure below.
  const [passphraseMode, setPassphraseMode] = useState<"stay" | "lock">("stay");

  // Hydrate the import draft on mount so a mid-flow reload (notably on
  // mobile where the OS evicts the WebView during keyboard / focus changes)
  // restores the typed key + passphrases instead of dropping the user back
  // on the Launch Station. We re-derive the secret on the fly so the user
  // resumes on the SAME step they were on — passphrase or key — rather
  // than being forced to re-tap Continue. The raw secret is never written
  // to storage; it only lives in component state.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = loadImportDraft();
    if (!draft) return;
    if (typeof draft.keyInput === "string") setKeyInput(draft.keyInput);
    if (typeof draft.importPassword === "string") setImportPassword(draft.importPassword);
    if (typeof draft.newPassword === "string") setNewPassword(draft.newPassword);
    if (typeof draft.confirmPassword === "string") setConfirmPassword(draft.confirmPassword);
    if (typeof draft.decryptedNpub === "string") setDecryptedNpub(draft.decryptedNpub);

    // If the user was past the "key" step, try to re-derive the secret
    // silently so they land back where they left off. Failure (wrong
    // passphrase for ncryptsec, malformed input) silently downgrades to
    // the "key" step — the user is no worse off than a forced restart.
    const restoreStep: ImportStep = (draft.step === "passphrase" || draft.step === "passkey") ? draft.step : "key";
    if (restoreStep !== "key" && typeof draft.keyInput === "string" && draft.keyInput.trim().length > 0) {
      try {
        const trimmed = draft.keyInput.trim();
        let secret: Uint8Array;
        if (trimmed.startsWith("ncryptsec1")) {
          if (!draft.importPassword) throw new Error("missing passphrase");
          secret = decryptImportedNcryptsec(trimmed, draft.importPassword);
        } else {
          secret = parseImportedKey(trimmed);
        }
        const { npub } = pubkeyFromSecret(secret);
        setDecryptedSecret(secret);
        setDecryptedNpub(npub);
        // Resume on the passphrase step. The "passkey" step requires the
        // user to be signed in, which they aren't on a fresh reload (local
        // sessions don't auto-restore by design), so collapse it back to
        // passphrase — the user re-confirms their device passphrase and
        // proceeds normally.
        setStep("passphrase");
        debugAuth("draft restored — resumed at passphrase step");
      } catch (err) {
        debugAuth("draft restored — could not re-derive secret, defaulting to key step", err);
      }
    } else {
      debugAuth("draft restored");
    }
  }, []);

  // Debounced persistence on every relevant field change. Persistence is
  // a no-op once the draft is empty (see saveImportDraft).
  //
  // Skip persistence once we've reached the post-login passkey nudge:
  // finalizeLogin() has already cleared the draft and the user is signed
  // in. Re-persisting keyInput / passwords here would leave sensitive
  // material in sessionStorage past the security boundary.
  useEffect(() => {
    if (step === "passkey") return;
    const t = setTimeout(() => {
      saveImportDraft({
        step,
        keyInput,
        importPassword,
        newPassword,
        confirmPassword,
        decryptedNpub,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [step, keyInput, importPassword, newPassword, confirmPassword, decryptedNpub]);

  // Defensive: if the component unmounts while the passkey nudge is still
  // pending (user navigated away mid-flow), clear the deferral flag so the
  // login page never gets stuck thinking a passkey nudge is in flight.
  useEffect(() => {
    return () => {
      try {
        // Clear unconditionally if any value is present — the flag now
        // holds a Date.now() timestamp (legacy "1" payloads also covered).
        if (sessionStorage.getItem(PASSKEY_NUDGE_FLAG) !== null) {
          setPasskeyNudgePending(false);
        }
      } catch {}
    };
  }, []);

  const isOverlay = variant === "overlay";
  const cardCls = isOverlay ? "border-white/10 bg-black/40 backdrop-blur-lg" : "border-border/60 bg-card/50";
  const titleCls = isOverlay ? "text-white" : "";
  const descCls = isOverlay ? "text-white/60" : "text-muted-foreground";
  const subtleCls = isOverlay ? "text-white/70" : "text-muted-foreground";
  const inputCls = isOverlay ? "bg-black/30 border-white/15 text-white placeholder:text-white/50" : "bg-background/50 placeholder:text-muted-foreground/70";
  const primaryBtnCls = isOverlay ? "bg-white text-black hover:bg-white/90" : "bg-foreground text-background hover:bg-foreground/90";
  const ghostBtnCls = isOverlay ? "text-white/60" : "text-muted-foreground";
  const eyeBtnCls = isOverlay
    ? "text-white/85 hover:text-white bg-black/40 hover:bg-black/60 border border-white/15"
    : "text-foreground/80 hover:text-foreground bg-background/80 hover:bg-background border border-border/60";

  const isEncrypted = useMemo(() => keyInput.trim().startsWith("ncryptsec1"), [keyInput]);

  const pastePreview = useMemo(() => {
    const trimmed = keyInput.trim();
    if (!trimmed) return null;
    const len = trimmed.length;
    // Shape sanity checks for the common formats so a truncated paste is obvious.
    let expected: string | null = null;
    if (trimmed.startsWith("ncryptsec1")) expected = "~162 chars";
    else if (trimmed.startsWith("nsec1")) expected = "63 chars";
    else if (/^[0-9a-f]+$/i.test(trimmed)) expected = "64 chars";
    const head = trimmed.slice(0, 10);
    const tail = trimmed.length > 16 ? trimmed.slice(-6) : "";
    return { len, expected, head, tail };
  }, [keyInput]);

  const handleKeyContinue = useCallback(async () => {
    setError("");
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setIsWorking(true);
    try {
      let secret: Uint8Array;
      if (isEncrypted) {
        if (!importPassword) {
          setError("Enter the passphrase that protects this encrypted key.");
          return;
        }
        try {
          secret = await new Promise<Uint8Array>((resolve, reject) => {
            setTimeout(() => {
              try { resolve(decryptImportedNcryptsec(trimmed, importPassword)); }
              catch (e) { reject(e); }
            }, 30);
          });
        } catch (decryptErr) {
          setError(describeKeyError(decryptErr, "decrypt"));
          return;
        }
      } else {
        try {
          secret = parseImportedKey(trimmed);
        } catch (parseErr) {
          setError(describeKeyError(parseErr, "parse"));
          return;
        }
      }
      const { npub } = pubkeyFromSecret(secret);
      setDecryptedSecret(secret);
      setDecryptedNpub(npub);
      debugAuth("step transition key -> passphrase");
      setStep("passphrase");
    } catch (err) {
      console.warn("Import key parse failed:", err);
      setError(describeKeyError(err, isEncrypted ? "decrypt" : "parse"));
    } finally {
      setIsWorking(false);
    }
  }, [keyInput, isEncrypted, importPassword]);

  const passwordValid = newPassword.length >= 8 && newPassword === confirmPassword;

  const finalizeLogin = useCallback(async (
    secret: Uint8Array,
    opts: { skipToast?: boolean; skipComplete?: boolean; persistPlainSecret?: boolean; toastDescription?: string } = {},
  ) => {
    setIsFinalizing(true);
    try {
      await loginWithLocalKey(secret, { persistPlainSecret: opts.persistPlainSecret });
      if (!opts.skipToast) {
        toast({
          title: "Welcome back",
          description: opts.toastDescription ?? "Your key is encrypted on this device.",
        });
      }
      // Wipe the import draft as soon as the session is real — leaving the
      // user-typed nsec / passphrases in sessionStorage past sign-in is
      // pointless and slightly worsens any later XSS exposure.
      clearImportDraft();
      debugAuth("draft cleared on login finalize");
      if (!opts.skipComplete) onComplete();
    } catch (err) {
      console.error("Sign-in after import failed:", err);
      toast({
        title: "Sign-in failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
      throw err;
    } finally {
      setIsFinalizing(false);
    }
  }, [loginWithLocalKey, onComplete, toast]);

  // No-passphrase path: persist the plaintext secret and sign in immediately.
  // This matches Ditto / Iris / Snort / Coracle / Damus Web behavior so a
  // pasted nsec survives reload, browser restart, and PWA respawn without
  // any further prompt.
  const handleStaySignedIn = useCallback(async () => {
    if (!decryptedSecret) return;
    setIsWorking(true);
    try {
      const { pubkey } = pubkeyFromSecret(decryptedSecret);
      // Imported accounts already have their own social graph — skip the new-user overlay.
      markOnboardingComplete(pubkey);
      try {
        await finalizeLogin(decryptedSecret, {
          persistPlainSecret: true,
          toastDescription: "Your key is saved on this device — you'll stay signed in.",
        });
      } catch {
        // finalizeLogin already toasted on failure.
        return;
      }
    } catch (err) {
      console.error("Stay-signed-in import failed:", err);
      toast({
        title: "Sign-in failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsWorking(false);
    }
  }, [decryptedSecret, finalizeLogin, toast]);

  const handleFinishImport = useCallback(async () => {
    if (!decryptedSecret || !passwordValid) return;
    setIsWorking(true);
    try {
      const ncryptsec = await new Promise<string>((resolve) => {
        setTimeout(() => resolve(encryptSecretKey(decryptedSecret, newPassword)), 30);
      });

      const { pubkey, npub } = pubkeyFromSecret(decryptedSecret);
      const record: StoredLocalAccount = {
        pubkey,
        npub,
        ncryptsec,
        createdAt: Date.now(),
      };

      // Persist first, then re-read from storage and decrypt. This catches
      // both a write failure (quota exceeded, Safari private mode, etc.) and
      // any encoding round-trip bug — while the user's original secret is
      // still on screen, instead of locking them out on the next unlock.
      try {
        saveLocalAccountStrict(record);
      } catch (saveErr) {
        console.error("Failed to save imported key to local storage:", saveErr);
        toast({
          title: "Couldn't save your key on this device",
          description: "Storage may be full or blocked (e.g. private browsing). Free up space or try a normal window, then try again — your secret is still in the box above.",
          variant: "destructive",
        });
        return;
      }

      let verified: Uint8Array | null = null;
      try {
        const reloaded = loadLocalAccount();
        if (!reloaded || reloaded.ncryptsec !== ncryptsec || reloaded.pubkey !== pubkey) {
          throw new Error("stored record did not round-trip");
        }
        verified = await new Promise<Uint8Array>((resolve, reject) => {
          setTimeout(() => {
            try { resolve(decryptStored(reloaded.ncryptsec, newPassword)); }
            catch (e) { reject(e); }
          }, 30);
        });
        if (verified.length !== decryptedSecret.length) {
          throw new Error("length mismatch");
        }
        let diff = 0;
        for (let i = 0; i < verified.length; i++) {
          diff |= verified[i] ^ decryptedSecret[i];
        }
        if (diff !== 0) throw new Error("byte mismatch");
      } catch (verifyErr) {
        console.error("Encrypted key failed verification round-trip:", verifyErr);
        // Clear the bad record so the next unlock isn't fed corrupted data.
        clearLocalAccount();
        toast({
          title: "Couldn't verify the encrypted key",
          description: "Your key wasn't saved cleanly on this device. Please try again — your secret is still in the box above.",
          variant: "destructive",
        });
        return;
      } finally {
        if (verified) verified.fill(0);
      }
      // Imported accounts already have their own social graph — don't trigger the new-user onboarding overlay
      markOnboardingComplete(pubkey);
      // Best-effort: ask the OS / browser password manager to remember the passphrase
      // keyed by this npub. On the next visit we can auto-fill, no copy-paste needed.
      void tryStorePassphraseInPasswordManager(npub, newPassword);
      setSavedAccount(record);

      // Decide up-front whether we'll show the passkey nudge so we can set
      // the deferral flag BEFORE login finalizes (otherwise Login.tsx's
      // pubkey-watching effect races us to the redirect and unmounts the
      // ImportKeyFlow before the passkey UI ever renders).
      const canOffer = await canOfferPasskeyEnrollment();
      if (canOffer) setPasskeyNudgePending(true);

      // Sign in IMMEDIATELY — never leave the user in a "blob on disk but
      // pubkey is null" window. If the passkey nudge follows, it does so
      // with the user already authenticated; skipping or cancelling the
      // nudge can no longer strand them on the Launch Station.
      try {
        await finalizeLogin(decryptedSecret, { skipToast: canOffer, skipComplete: canOffer });
      } catch {
        // finalizeLogin already toasted a "Sign-in failed" message. Clear
        // the deferral flag and bail without re-toasting from the outer
        // catch — the user can retry from the passphrase step.
        if (canOffer) setPasskeyNudgePending(false);
        return;
      }

      if (canOffer) {
        debugAuth("step transition passphrase -> passkey (post-login nudge)");
        setStep("passkey");
        setIsWorking(false);
        return;
      }
      // No passkey nudge — finalizeLogin already ran with skipComplete=false
      // semantics (defaulted false here), so onComplete fired and we're done.
    } catch (err) {
      console.error("Finish import failed:", err);
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsWorking(false);
    }
  }, [decryptedSecret, newPassword, passwordValid, finalizeLogin, toast]);

  const handlePasskeyEnrolled = useCallback((blob: PasskeyEnrollment) => {
    if (!savedAccount) return;
    const updated: StoredLocalAccount = { ...savedAccount, passkey: blob };
    saveLocalAccount(updated);
    setSavedAccount(updated);
    setPasskeyEnrolled(true);
    debugAuth("passkey enrolled");
    // The user is already signed in at this point (handleFinishImport ran
    // loginWithLocalKey before transitioning into this step), so we no
    // longer call loginWithLocalKey here.
  }, [savedAccount]);

  const handlePasskeyDone = useCallback(() => {
    debugAuth("passkey nudge dismissed");
    // The user is already signed in. Clear the deferral flag, wipe the
    // draft (belt-and-braces; finalizeLogin already did so), and let the
    // login page complete its post-login redirect.
    setPasskeyNudgePending(false);
    clearImportDraft();
    toast({ title: "Welcome back", description: "Your key is encrypted on this device." });
    onComplete();
  }, [onComplete, toast]);

  return (
    <div className="space-y-4" data-testid="container-import-key">
      {step === "key" && (
        <Card className={cardCls}>
          <CardContent className="p-5 sm:p-6 space-y-5 sm:space-y-6" data-testid="card-import-step-key">
          <form onSubmit={(e) => { e.preventDefault(); if (!isWorking && keyInput.trim() && (!isEncrypted || importPassword)) handleKeyContinue(); }} className="space-y-5 sm:space-y-6">
            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${isOverlay ? "bg-white/5 border border-white/10" : "bg-foreground/5 border border-border/40"}`}>
                  <KeyRound className={`w-5 h-5 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className={`text-sm font-semibold ${titleCls}`} data-testid="text-import-title">Use your existing key</h3>
                  <p className={`text-xs mt-0.5 ${descCls}`}>Paste your account key — it looks like <code>nsec1…</code> (or a long string of letters and numbers).</p>
                </div>
              </div>
              <a
                href="/help"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WTF is this? — open the FAQ in a new tab"
                data-testid="link-import-wtf"
                className={`group/wtf shrink-0 self-start sm:self-auto inline-flex items-center gap-2 rounded-full transition-all duration-300 px-2 py-1.5 sm:px-2.5 sm:py-1.5 ${isOverlay ? "border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/25" : "border border-border/50 bg-foreground/[0.03] hover:bg-foreground/[0.06] hover:border-border"}`}
              >
                <span className="relative shrink-0 -rotate-[8deg] group-hover/wtf:-rotate-[14deg] group-hover/wtf:scale-110 transition-transform duration-500 ease-out">
                  <WtfAlienIcon className={`w-6 h-6 sm:w-5 sm:h-5 transition-all duration-500 ${isOverlay ? "text-brand/80 group-hover/wtf:text-brand-strong group-hover/wtf:drop-shadow-[0_0_10px_rgba(167,139,250,0.55)]" : "text-brand/80 group-hover/wtf:text-brand-strong group-hover/wtf:drop-shadow-[0_0_10px_rgba(124,58,237,0.4)]"}`} />
                  <span className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full transition-all duration-500 ${isOverlay ? "bg-brand/70 group-hover/wtf:bg-brand group-hover/wtf:shadow-[0_0_6px_rgba(167,139,250,0.6)]" : "bg-brand/60 group-hover/wtf:bg-brand group-hover/wtf:shadow-[0_0_6px_rgba(124,58,237,0.5)]"}`} />
                </span>
                <span className="hidden sm:flex flex-col leading-none transform -rotate-[2deg] pr-0.5">
                  <span className={`text-[11px] font-black tracking-tight ${isOverlay ? "text-brand" : "text-brand dark:text-brand/90"}`}>
                    Help &amp; Guides
                  </span>
                  <span className={`text-[7px] uppercase tracking-[0.3em] font-bold mt-0.5 ${isOverlay ? "text-brand/50" : "text-brand/40"}`}>
                    get started
                  </span>
                </span>
              </a>
            </div>

            <div className={`rounded-md p-3 ${isOverlay ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-500/5 border border-amber-500/30"}`}>
              <div className="flex items-start gap-2">
                <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-amber-300" : "text-amber-600"}`} />
                <p className={`text-xs leading-relaxed ${descCls}`}>
                  This key unlocks your whole account. Pasting it here is fine — or sign in with a browser extension or signer app instead.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Secret key</Label>
              <div className="relative">
                <Input
                  type="text"
                  value={keyInput}
                  onChange={(e) => { setKeyInput(e.target.value); setError(""); }}
                  placeholder="nsec1… or ncryptsec1… or 64-char hex"
                  className={`font-mono ${inputCls} h-11 pr-10 text-xs tracking-tight`}
                  style={{
                    fontSize: 16,
                    ...({ WebkitTextSecurity: showKey ? "none" : "disc" } as React.CSSProperties),
                  }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  data-testid="input-import-key"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1 rounded ${eyeBtnCls}`}
                  aria-label={showKey ? "Hide secret key" : "Reveal secret key"}
                  data-testid="button-toggle-key-visibility"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {pastePreview ? (
                <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${subtleCls}`} data-testid="text-paste-preview">
                  <span className="font-mono">
                    {pastePreview.head}{pastePreview.tail ? "…" + pastePreview.tail : ""}
                  </span>
                  <span>·</span>
                  <span>
                    {pastePreview.len} chars{pastePreview.expected ? ` (expected ${pastePreview.expected})` : ""}
                  </span>
                </div>
              ) : (
                <p className={`text-xs ${subtleCls}`}>Hidden by default. Tap the eye to reveal.</p>
              )}
            </div>

            {isEncrypted && (
              <div className="space-y-2">
                <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Decryption passphrase</Label>
                <div className="relative">
                  <Input
                    type={showImport ? "text" : "password"}
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Passphrase that protects this key"
                    className={`${inputCls} pr-10`}
                    style={{ fontSize: 16 }}
                    autoComplete="current-password"
                    data-testid="input-import-passphrase"
                  />
                  <button
                    type="button"
                    onClick={() => setShowImport((v) => !v)}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1 rounded ${eyeBtnCls}`}
                  >
                    {showImport ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive" data-testid="text-import-error">{error}</p>}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 pt-2">
              {/* type="button" is LOAD-BEARING. A button inside a form defaults
                  to type="submit", and this one comes BEFORE Continue in DOM
                  order (flex-col-reverse only flips the visuals) — so it was
                  the form's DEFAULT submit button. Pressing Enter in the
                  passphrase field therefore "clicked" BACK: clearImportDraft()
                  ran, the flow exited, and a user who had just pasted a 162-
                  char ncryptsec plus passphrase watched it all vanish.
                  Reported as "enter clears everything instead of continuing". */}
              <Button type="button" variant="ghost" onClick={() => { clearImportDraft(); debugAuth("draft cleared on cancel"); onBack(); }} className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div className="hidden sm:block sm:flex-1" />
              <Button
                type="submit"
                disabled={!keyInput.trim() || (isEncrypted && !importPassword) || isWorking}
                className={`w-full sm:w-auto text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                data-testid="button-import-continue"
              >
                {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : null}
                {isWorking ? "Reading…" : "Continue"} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </form>
          </CardContent>
        </Card>
      )}

      {step === "passphrase" && (
        <Card className={cardCls}>
          <CardContent className="p-4 sm:p-5 space-y-4 sm:space-y-5" data-testid="card-import-step-passphrase">
            {passphraseMode === "stay" ? (
              <>
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-md ${isOverlay ? "bg-emerald-500/10 border border-emerald-400/25" : "bg-emerald-500/10 border border-emerald-500/25"}`}>
                    <KeyRound className={`w-5 h-5 ${isOverlay ? "text-emerald-300" : "text-emerald-700"}`} />
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${titleCls}`} data-testid="text-import-stay-title">Stay signed in on this device</h3>
                    <p className={`text-xs mt-0.5 ${descCls}`}>Your key is saved on this device. Reload, restart, or reopen — you're still in.</p>
                  </div>
                </div>

                <div className={`rounded-md p-3 ${isOverlay ? "bg-amber-500/5 border border-amber-500/20" : "bg-amber-500/5 border border-amber-500/30"}`}>
                  <div className="flex items-start gap-2">
                    <ShieldAlert className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-amber-300" : "text-amber-600"}`} />
                    <p className={`text-xs leading-relaxed ${descCls}`}>
                      Your key lives in this browser profile. Anyone with access to this device can use this account. Sign out from the menu to remove it.
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleStaySignedIn}
                  disabled={isWorking}
                  className={`w-full text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                  data-testid="button-stay-signed-in"
                >
                  {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <ArrowRightCircle className="w-4 h-4 mr-2" />}
                  {isWorking ? "Signing in…" : "Stay signed in & continue"}
                </Button>

                <div className={`flex items-center gap-3 pt-1`}>
                  <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border/60"}`} />
                  <span className={`text-[10px] font-brand uppercase tracking-[0.18em] ${subtleCls}`}>or</span>
                  <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border/60"}`} />
                </div>

                <Button
                  variant="ghost"
                  onClick={() => setPassphraseMode("lock")}
                  disabled={isWorking}
                  className={`w-full text-[11px] font-brand uppercase tracking-widest ${ghostBtnCls}`}
                  data-testid="button-switch-to-passphrase"
                >
                  <Lock className="w-3.5 h-3.5 mr-1.5" />
                  Lock with a passphrase instead
                </Button>

                <div className="flex justify-start pt-1">
                  <Button
                    variant="ghost"
                    onClick={() => setStep("key")}
                    disabled={isWorking}
                    className={`text-[11px] font-brand uppercase tracking-widest ${ghostBtnCls}`}
                    data-testid="button-back-to-key"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (passwordValid && !isWorking) handleFinishImport(); }}>
                {/* Hidden username field so password managers (iCloud Keychain, Google PM, 1Password)
                    pair the saved passphrase with this account's npub instead of treating each
                    Relay Outpost login as a separate, indistinguishable entry. */}
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={decryptedNpub}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none", height: 0, width: 0 }}
                />
                <div className="flex items-center gap-3">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-md ${isOverlay ? "bg-white/5 border border-white/10" : "bg-foreground/5 border border-border/40"}`}>
                    <Lock className={`w-5 h-5 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />
                  </div>
                  <div>
                    <h3 className={`text-sm font-semibold ${titleCls}`} data-testid="text-import-passphrase-title">Set a passphrase for this device</h3>
                    <p className={`text-xs mt-0.5 ${descCls}`}>We'll re-encrypt your key with it. You'll be asked to enter it on every reload.</p>
                  </div>
                </div>

                <div className="space-y-3 mt-4">
                  <div className="space-y-2">
                    <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Passphrase</Label>
                    <div className="relative">
                      <Input
                        type={showNew ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className={`${inputCls} pr-10`}
                        style={{ fontSize: 16 }}
                        name="new-password"
                        autoComplete="new-password"
                        autoFocus
                        data-testid="input-new-passphrase"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNew((v) => !v)}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1 rounded ${eyeBtnCls}`}
                      >
                        {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Confirm</Label>
                    <Input
                      type={showNew ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Type it again"
                      className={inputCls}
                      style={{ fontSize: 16 }}
                      autoComplete="new-password"
                      data-testid="input-new-passphrase-confirm"
                    />
                    {confirmPassword && newPassword !== confirmPassword && (
                      <p className="text-xs text-destructive">Passphrases don't match</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setPassphraseMode("stay")}
                    className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`}
                    data-testid="button-switch-to-stay"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <div className="hidden sm:block sm:flex-1" />
                  <Button
                    type="submit"
                    disabled={!passwordValid || isWorking}
                    className={`w-full sm:w-auto text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                    data-testid="button-finish-import"
                  >
                    {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                    {isWorking ? "Encrypting…" : "Finish & sign in"}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {step === "passkey" && savedAccount && decryptedSecret && (
        <Card className={cardCls}>
          <CardContent className="p-4 sm:p-5 space-y-4 sm:space-y-5" data-testid="card-import-step-passkey">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${isOverlay ? "bg-emerald-500/10 border border-emerald-400/25" : "bg-emerald-500/10 border border-emerald-500/25"}`}>
                <KeyRound className={`w-5 h-5 ${isOverlay ? "text-emerald-300" : "text-emerald-700"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className={`text-sm font-semibold ${titleCls}`} data-testid="text-import-passkey-title">You're in. One last optional step.</h3>
                <p className={`text-xs mt-0.5 ${descCls}`}>Make signing in instant on this device — your passphrase still works as a backup.</p>
              </div>
            </div>

            <PasskeyEnrollmentCard
              variant={variant}
              secretKey={decryptedSecret}
              pubkey={savedAccount.pubkey}
              npub={savedAccount.npub}
              accountLabel={savedAccount.label || "Relay Outpost account"}
              enrolled={passkeyEnrolled}
              onEnrolled={handlePasskeyEnrolled}
            />

            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 pt-1">
              {!passkeyEnrolled && (
                <Button
                  variant="ghost"
                  onClick={handlePasskeyDone}
                  disabled={isFinalizing}
                  className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`}
                  data-testid="button-skip-passkey"
                >
                  Skip for now
                </Button>
              )}
              <div className="hidden sm:block sm:flex-1" />
              <Button
                onClick={handlePasskeyDone}
                disabled={isFinalizing}
                className={`w-full sm:w-auto text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                data-testid="button-finish-passkey"
              >
                {isFinalizing ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <ArrowRightCircle className="w-4 h-4 mr-2" />}
                {isFinalizing ? "Signing in…" : passkeyEnrolled ? "Continue" : "Continue with passphrase"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
