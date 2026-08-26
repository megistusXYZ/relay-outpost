import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ArrowRight, AtSign, BadgeCheck, Camera, Check, CheckCircle2, ChevronDown, Code2, Copy, Dice5, Download, Eye, EyeOff, FileText, Info, KeyRound, Link2, Lock, Mic, PlayCircle, QrCode, Rss, Save, ShieldAlert, User, Upload, UserCircle2, X, Youtube } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CameraOutpostIcon } from "@/components/icons/CameraOutpostIcon";
import { BitcoinIcon } from "@/components/FeedIcons";
import { savePodcastFeed, KIND_PODCAST_RSS, PODCAST_D_TAG } from "@/lib/music";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import { generateLocalAccount, encryptSecretKeyAsync, saveLocalAccountStrict, loadLocalAccount, clearLocalAccount, downloadBackupFile, saveCredentialToPasswordManager, decryptStored, markOnboardingComplete, type NewLocalAccount, type StoredLocalAccount } from "@/lib/local-account";
import { DEFAULT_RELAYS } from "@/lib/relay-constants";
import { getDiscoverFeedRelays } from "@/lib/discover-relays";
import { getPreferredLanguages } from "@/lib/language";
import { classifyStorageEnvironment, classifyStorageEnvironmentAsync, describeStorageOutcome, type StorageEnvironment } from "@/lib/key-storage-environment";
import { generatePassphraseSuggestion } from "@/lib/passphrase-suggest";
import { PasskeyEnrollmentCard } from "@/components/PasskeyEnrollmentCard";
import type { PasskeyEnrollment } from "@/lib/passkey";
import { publishEvent, verifySignedEventKind } from "@/lib/nostr";
import { clientTags, KIND_METADATA, KIND_FOLLOW_LIST } from "@/lib/nostr-helpers";
import { CURATED_SEED_PUBKEYS, buildAnchorFollows } from "@/lib/curated-seed-follows";
import { setInviteConnect } from "@/lib/invite-connect";
import { joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import { triggerGrapeRankCalculation } from "@/lib/graperank";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { markNewAccountPublicNostrOff } from "@/lib/public-nostr";
import { markIaMovedNoticeSeen } from "@/lib/ia-moved-notice";
import { uploadToNostrBuild, setBlossomServers, publishBlossomServerList, DEFAULT_BLOSSOM_SERVERS } from "@/lib/media-upload";
import { setLocalDMRelays, publishDMRelayList, DM_FALLBACK_RELAYS } from "@/lib/outbox";
import { loadSignupDraft, saveSignupDraft, clearSignupDraft, bytesToHex, hexToBytes, draftHasResumableContent } from "@/lib/account-draft";
import { trackSignupEvent } from "@/lib/signup-telemetry";
import { finalizeEvent, nip19 } from "nostr-tools";
import { QRCodeSVG } from "qrcode.react";
import { RelayOutpostInlineLoader, RelayOutpostIcon } from "@/components/RelayOutpostLoader";

interface Props {
  variant?: "page" | "overlay";
  onBack: () => void;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

type FeaturedLinkType = "rss" | "substack" | "medium" | "youtube" | "vimeo" | "rumble" | "podcast" | "code" | "web" | null;

function detectFeaturedLinkType(raw: string): { type: FeaturedLinkType; label: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { type: null, label: "" };
  let host = "";
  let path = "";
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    host = u.hostname.replace(/^www\./i, "").toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return { type: null, label: "" };
  }
  if (!host) return { type: null, label: "" };
  if (/\.(rss|xml|atom)$/.test(path) || /\/(rss|feed|atom)\/?$/.test(path)) {
    return { type: "rss", label: "RSS feed" };
  }
  if (host.endsWith("substack.com")) return { type: "substack", label: "Substack" };
  if (host === "medium.com" || host.endsWith(".medium.com")) return { type: "medium", label: "Medium" };
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return { type: "youtube", label: "YouTube" };
  if (host === "vimeo.com" || host.endsWith(".vimeo.com")) return { type: "vimeo", label: "Vimeo" };
  if (host === "rumble.com" || host.endsWith(".rumble.com")) return { type: "rumble", label: "Rumble" };
  if (
    host === "fountain.fm" ||
    host === "podcastindex.org" ||
    host.includes("anchor.fm") ||
    host.includes("podcasts.apple.com") ||
    host.includes("open.spotify.com")
  ) {
    return { type: "podcast", label: "Podcast" };
  }
  if (host === "github.com" || host === "gitlab.com" || host === "codeberg.org") {
    return { type: "code", label: "Code" };
  }
  return { type: "web", label: "Website" };
}

function FieldInfo({ title, body, testId, isOverlay }: { title: string; body: React.ReactNode; testId?: string; isOverlay: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${title}?`}
          className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full transition-all ${isOverlay ? "text-brand/70 bg-white/[0.06] hover:bg-brand/20 hover:text-brand-strong focus-visible:bg-brand/20 focus-visible:text-brand-strong" : "text-brand/70 bg-brand/[0.08] hover:bg-brand/20 hover:text-brand focus-visible:bg-brand/20"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
          data-testid={testId}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="z-[110] w-72 max-w-[calc(100vw-2rem)] p-3.5 field-info-overlay border-brand/30 text-white/90"
      >
        <div className="space-y-1.5">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-brand">{title}</p>
          <div className="text-xs leading-relaxed text-white/90 [&_strong]:font-semibold [&_strong]:text-white">
            {body}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CreateAccountFlow({ variant = "page", onBack, onComplete }: Props) {
  const { loginWithLocalKey, updateFollows } = useNostrAuth();
  const { setWotEnabled, notifyRecalculating } = useGrapeRankScores();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [picture, setPicture] = useState("");
  const [banner, setBanner] = useState("");
  const [nip05, setNip05] = useState("");
  const [website, setWebsite] = useState("");
  const [rss, setRss] = useState("");
  const [lud16, setLud16] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const featuredLinkInfo = useMemo(() => detectFeaturedLinkType(website), [website]);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("");
  const [bannerStatus, setBannerStatus] = useState("");
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState<NewLocalAccount | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [stored, setStored] = useState<StoredLocalAccount | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [downloadJustSaved, setDownloadJustSaved] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verified, setVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  // Tracks which passphrase value we last ran the decrypt round-trip
  // against. Prevents the auto-verify effect from firing repeatedly for
  // the same stable confirmed value, and lets any state-reset path
  // force a fresh test by clearing this ref.
  const verifiedAgainstRef = useRef<string | null>(null);
  // Monotonic run token. Bumped by every state path that invalidates a
  // prior encryption/verification context (passphrase edits, account
  // regenerate, re-encrypt into a new `stored` record). An in-flight
  // scrypt decrypt captures the token at start and refuses to commit a
  // `verified=true` result if the token has moved by completion —
  // otherwise a slow verify against an old `stored` could silently
  // flip the flag against a newer, untested record.
  const verifyRunIdRef = useRef(0);
  const [savedToManager, setSavedToManager] = useState(false);
  const [passkeyBlob, setPasskeyBlob] = useState<PasskeyEnrollment | null>(null);
  const [ackOnlyMe, setAckOnlyMe] = useState(false);
  const acknowledged = ackOnlyMe;
  // Secure-step UI: reveal the password fallback, and the optional Advanced
  // (backup file / recovery code / password-manager) disclosure.
  const [showPasswordPath, setShowPasswordPath] = useState(false);
  const [showSecureAdvanced, setShowSecureAdvanced] = useState(false);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [showRecoveryCode, setShowRecoveryCode] = useState(false);
  const [showNsec, setShowNsec] = useState(false);
  const [copiedNsec, setCopiedNsec] = useState(false);
  const [storageEnv, setStorageEnv] = useState<StorageEnvironment>(() => classifyStorageEnvironment());
  useEffect(() => {
    let cancelled = false;
    classifyStorageEnvironmentAsync()
      .then((env) => { if (!cancelled) setStorageEnv(env); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Hydrate signup draft on mount. Mobile browsers (especially iOS PWAs)
  // routinely evict the page from memory when the file picker opens or the
  // keyboard pushes the viewport around — without a draft, the user lands
  // back on the Launch Station with no inputs. We restore here so they can
  // pick up where they left off. Only honour the draft on the FIRST step,
  // since steps 2–4 deal with the real saved/encrypted record.
  const hydratedRef = useRef(false);
  // Track whether this signup session is the result of resuming a draft so
  // the terminal telemetry events (`signup_completed` / `signup_abandoned`)
  // can carry that flag and we can compute resume-driven completion rate.
  const wasResumedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = loadSignupDraft();
    if (!draft) return;
    // Only treat this mount as a resumed session if the persisted draft
    // actually carried meaningful work. An empty/stale draft would
    // otherwise inflate the resumed-vs-fresh funnel and undermine the
    // whole point of this telemetry.
    if (draftHasResumableContent(draft)) {
      wasResumedRef.current = true;
      trackSignupEvent("draft_hydrated");
    }
    if (draft.displayName) setDisplayName(draft.displayName);
    if (draft.username) setUsername(draft.username);
    if (draft.bio) setBio(draft.bio);
    if (draft.picture) setPicture(draft.picture);
    if (draft.banner) setBanner(draft.banner);
    if (draft.nip05) setNip05(draft.nip05);
    if (draft.website) setWebsite(draft.website);
    if (draft.rss) setRss(draft.rss);
    if (draft.lud16) setLud16(draft.lud16);
    if (draft.account?.secretKeyHex) {
      try {
        const sk = hexToBytes(draft.account.secretKeyHex);
        // Recompute `nsec` from the secret key rather than persisting it —
        // there's no reason to keep two copies of the same secret material
        // in storage.
        setAccount({
          secretKey: sk,
          pubkey: draft.account.pubkey,
          npub: draft.account.npub,
          nsec: nip19.nsecEncode(sk),
        });
      } catch (e) {
        console.warn("[CreateAccount] failed to restore draft keypair:", e);
      }
    }
    // Don't restore step past 1 — anything beyond step 1 requires the
    // encrypted/stored record which we deliberately don't persist here.
  }, []);

  // Persist the in-progress draft on change (debounced) so a sudden tab
  // restart doesn't wipe what the user just typed/uploaded.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = setTimeout(() => {
      saveSignupDraft({
        displayName, username, bio, picture, banner,
        nip05, website, rss, lud16,
        step: 1,
        account: account ? {
          secretKeyHex: bytesToHex(account.secretKey),
          pubkey: account.pubkey,
          npub: account.npub,
        } : undefined,
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [displayName, username, bio, picture, banner, nip05, website, rss, lud16, account]);

  const handleBack = useCallback(() => {
    // The user explicitly bailed out — drop the draft so the Launch Station
    // doesn't keep nagging them with a "Resume signup" chip.
    // Only count this as an "abandon" if there was actual work in flight,
    // otherwise we'd inflate the abandon counter on trivial back-button
    // taps from the empty form.
    const draft = loadSignupDraft();
    if (draft && draftHasResumableContent(draft)) {
      trackSignupEvent("signup_abandoned", { wasResumed: wasResumedRef.current });
    }
    clearSignupDraft();
    onBack();
  }, [onBack]);
  const storageOutcome = useMemo(
    () => describeStorageOutcome(storageEnv, savedToManager),
    [storageEnv, savedToManager],
  );

  const isOverlay = variant === "overlay";
  const cardCls = isOverlay ? "border-white/10 bg-black/40 backdrop-blur-lg" : "border-border/60 bg-card/50";
  const titleCls = isOverlay ? "text-white" : "";
  const descCls = isOverlay ? "text-white/60" : "text-muted-foreground";
  const subtleCls = isOverlay ? "text-white/70" : "text-muted-foreground";
  const inputCls = isOverlay ? "bg-black/30 border-white/15 text-white placeholder:text-white/50" : "bg-background/50 placeholder:text-muted-foreground/70";
  const primaryBtnCls = isOverlay ? "bg-white text-black hover:bg-white/90" : "bg-foreground text-background hover:bg-foreground/90";
  const ghostBtnCls = isOverlay ? "text-white/60" : "text-muted-foreground";

  const passwordStrength = useMemo(() => {
    if (!password) return { label: "", score: 0 };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    const labels = ["Too short", "Weak", "OK", "Good", "Strong", "Very strong"];
    return { label: labels[score] || "", score };
  }, [password]);

  const passwordValid = password.length >= 8 && password === confirmPassword;

  // If the user edits the passphrase after we've already encrypted, the saved
  // ncryptsec no longer corresponds to what they're typing. Drop the stored
  // record + verification state so they have to re-encrypt and re-verify.
  useEffect(() => {
    if (!stored) return;
    setStored(null);
    setDownloaded(false);
    setDownloadJustSaved(false);
    setShowVerify(false);
    setVerified(false);
    setVerifyError("");
    setIsVerifying(false);
    verifiedAgainstRef.current = null;
    verifyRunIdRef.current += 1;
    setSavedToManager(false);
    setSavedEncryptedToManager(false);
    setPasskeyBlob(null);
    // We intentionally only react to passphrase edits, not to `stored` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, confirmPassword]);

  // Lazily generate the signup keypair on first need (e.g. uploading an
  // avatar/banner before the user clicks Continue) so we can sign the
  // upload's NIP-98 auth header. The same account is reused when the user
  // proceeds to step 2, so the npub they back up matches the key that
  // signed any upload auth events.
  const ensureSignupAccount = useCallback((): NewLocalAccount => {
    if (account) return account;
    const acct = generateLocalAccount();
    setAccount(acct);
    return acct;
  }, [account]);

  const makeLocalSigner = useCallback((secretKey: Uint8Array) => ({
    signEvent: async (event: any) => finalizeEvent(event, secretKey),
  }), []);

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const acct = ensureSignupAccount();
      const signer = makeLocalSigner(acct.secretKey);
      const result = await uploadToNostrBuild(file, setAvatarStatus, signer, { maxDimension: 512 });
      setPicture(result.url);
      toast({ title: "Avatar uploaded" });
    } catch (err: any) {
      console.error("Avatar upload failed:", err);
      toast({ title: "Upload failed", description: err?.message || "Could not upload avatar.", variant: "destructive" });
    }
    setAvatarUploading(false);
    setAvatarStatus("");
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }, [toast, ensureSignupAccount, makeLocalSigner]);

  const handleBannerUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerUploading(true);
    try {
      const acct = ensureSignupAccount();
      const signer = makeLocalSigner(acct.secretKey);
      const result = await uploadToNostrBuild(file, setBannerStatus, signer, { maxDimension: 1920 });
      setBannerLoaded(false);
      setBanner(result.url);
      toast({ title: "Banner uploaded" });
    } catch (err: any) {
      console.error("Banner upload failed:", err);
      toast({ title: "Upload failed", description: err?.message || "Could not upload banner.", variant: "destructive" });
    }
    setBannerUploading(false);
    setBannerStatus("");
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  }, [toast, ensureSignupAccount, makeLocalSigner]);

  const handleStep1Continue = useCallback(() => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast({ title: "Choose a display name", description: "Pick anything — you can change it later.", variant: "destructive" });
      return;
    }
    // Reuse the account if one was already generated to sign an avatar or
    // banner upload — regenerating here would orphan the key that signed
    // any uploaded NIP-98 headers and change the npub the user sees next.
    const acct = account ?? generateLocalAccount();
    if (!account) setAccount(acct);
    // Regenerating the account invalidates any prior encryption / verification
    // state — clear it so a stale "verified" flag from a previous key context
    // can never gate Continue past the storage step.
    setStored(null);
    setDownloaded(false);
    setDownloadJustSaved(false);
    setShowVerify(false);
    setVerified(false);
    setVerifyError("");
    setIsVerifying(false);
    verifiedAgainstRef.current = null;
    verifyRunIdRef.current += 1;
    setSavedToManager(false);
    setSavedNsecToManager(false);
    setSavedEncryptedToManager(false);
    setPasskeyBlob(null);
    setStep(2);
  }, [displayName, toast, account]);

  const handleEncryptAndSave = useCallback(async () => {
    if (!account || !passwordValid) return;
    setIsWorking(true);
    try {
      const ncryptsec = await encryptSecretKeyAsync(account.secretKey, password);
      const record: StoredLocalAccount = {
        pubkey: account.pubkey,
        npub: account.npub,
        ncryptsec,
        label: displayName.trim() || undefined,
        createdAt: Date.now(),
      };

      // Persist first, then re-read from storage and decrypt. This catches
      // both a write failure (quota exceeded, Safari private mode, etc.) and
      // any encoding round-trip bug — while the freshly generated secret is
      // still in memory, instead of locking the user out on the next unlock.
      try {
        saveLocalAccountStrict(record);
      } catch (saveErr) {
        console.error("Failed to save new key to local storage:", saveErr);
        toast({
          title: "Couldn't save your key on this device",
          description: "Storage may be full or blocked (e.g. private browsing). Free up space or try a normal window, then try again.",
          variant: "destructive",
        });
        return;
      }

      let verified: Uint8Array | null = null;
      try {
        const reloaded = loadLocalAccount();
        if (!reloaded || reloaded.ncryptsec !== ncryptsec || reloaded.pubkey !== account.pubkey) {
          throw new Error("stored record did not round-trip");
        }
        verified = await new Promise<Uint8Array>((resolve, reject) => {
          setTimeout(() => {
            try { resolve(decryptStored(reloaded.ncryptsec, password)); }
            catch (e) { reject(e); }
          }, 30);
        });
        if (verified.length !== account.secretKey.length) {
          throw new Error("length mismatch");
        }
        let diff = 0;
        for (let i = 0; i < verified.length; i++) {
          diff |= verified[i] ^ account.secretKey[i];
        }
        if (diff !== 0) throw new Error("byte mismatch");
      } catch (verifyErr) {
        console.error("Encrypted key failed verification round-trip:", verifyErr);
        // Clear the bad record so the next unlock isn't fed corrupted data,
        // and leave `stored` unset so the user is offered a retry instead of
        // being allowed to advance toward sign-in.
        clearLocalAccount();
        toast({
          title: "Couldn't verify the encrypted key",
          description: "Your key wasn't saved cleanly on this device. Please try again — your secret is still here, no data was lost.",
          variant: "destructive",
        });
        return;
      } finally {
        // Wipe the unlocked verification copy from memory immediately.
        if (verified) verified.fill(0);
      }

      setStored(record);
      setVerified(false);
      setVerifyError("");
      setIsVerifying(false);
      verifiedAgainstRef.current = null;
      verifyRunIdRef.current += 1;
      setShowVerify(false);
      // Don't silently hand credentials to the password manager here. The
      // explicit "Save encrypted key to password manager" button that
      // appears after verify succeeds routes through
      // `saveCredentialToPasswordManager()` with the full npub as the
      // username, which is the only path we want firing for new accounts.
      toast({ title: "Password set", description: "You'll use it to sign in next time. Grab the backup file under Advanced too." });
    } catch (err) {
      console.error("Encrypt failed:", err);
      toast({ title: "Encryption failed", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setIsWorking(false);
    }
  }, [account, password, passwordValid, displayName, toast]);

  const handleDownloadBackup = useCallback(() => {
    if (!stored) return;
    downloadBackupFile(stored, {
      displayName: displayName.trim() || undefined,
      // At signup, the user is publishing to the default relay set.
      // NIP-05 / lud16 are not configured at this point.
      relays: [...DEFAULT_RELAYS],
      // Include the raw nsec alongside the encrypted ncryptsec. This
      // makes the file more sensitive — see the file's own "HEADS UP"
      // section for the storage caveat the user is shown.
      nsec: account?.nsec,
    });
    setDownloaded(true);
    setDownloadJustSaved(true);
    setShowVerify(true);
    setTimeout(() => setDownloadJustSaved(false), 2400);
  }, [stored, displayName, account]);

  const handleVerifyPassphrase = useCallback(async (passphrase: string) => {
    if (!stored || !account) return;
    if (!passphrase) return;
    // Capture the run token + the ncryptsec we're testing against.
    // If the user edits the passphrase or regenerates the account
    // while scrypt is in flight, those paths bump `verifyRunIdRef`
    // and we must not commit a stale success onto the new context.
    const runId = verifyRunIdRef.current;
    // Remember which value we're about to test so the auto-verify effect
    // doesn't re-fire for the same string while scrypt is running.
    verifiedAgainstRef.current = passphrase;
    setIsVerifying(true);
    setVerifyError("");
    try {
      // Yield so the testing state can paint before the heavy scrypt work.
      await new Promise<void>((r) => setTimeout(r, 30));
      const decrypted = decryptStored(stored.ncryptsec, passphrase);
      const matches =
        decrypted.length === account.secretKey.length &&
        decrypted.every((b, i) => b === account.secretKey[i]);
      // Stale-completion guard: if the context has changed since we
      // started, drop the result on the floor. The fresh context will
      // schedule its own verify.
      if (runId !== verifyRunIdRef.current) return;
      if (!matches) {
        // Decrypted to a *different* key — shouldn't happen in the
        // auto-verify path since we just encrypted with this same
        // passphrase, but surface it rather than pass silently.
        // IMPORTANT: keep `verifiedAgainstRef.current` set to the tested
        // passphrase so the auto-verify effect's dedupe guard prevents
        // an immediate retry loop. Retry is explicit (Retry button).
        setVerifyError("Couldn't decrypt that backup on this device.");
        setVerified(false);
      } else {
        setVerified(true);
        setVerifyError("");
      }
    } catch (err) {
      if (runId !== verifyRunIdRef.current) return;
      console.warn("[CreateAccount] verify decrypt failed:", err);
      // Keep the ref set (see note above) — Retry is user-initiated.
      setVerifyError("Couldn't decrypt that backup on this device.");
      setVerified(false);
    } finally {
      if (runId === verifyRunIdRef.current) setIsVerifying(false);
    }
  }, [stored, account]);

  // Auto-verify: once the user has a stable confirmed passphrase and has
  // saved the backup file, silently run the decrypt round-trip. No third
  // input needed — the confirm field already tested the user can
  // reproduce the string character-for-character. We debounce so
  // scrypt doesn't thrash as the confirm field is being typed, and the
  // verifiedAgainstRef gate ensures we don't re-run for the same value.
  useEffect(() => {
    if (!showVerify) return;
    if (!stored || !account) return;
    if (verified || isVerifying) return;
    if (verifyError) return; // Failure is user-resolved via Retry; don't auto-loop.
    if (!password || password !== confirmPassword) return;
    if (password.length < 8) return;
    if (verifiedAgainstRef.current === password) return;
    const handle = setTimeout(() => {
      void handleVerifyPassphrase(password);
    }, 400);
    return () => clearTimeout(handle);
  }, [showVerify, stored, account, password, confirmPassword, verified, isVerifying, verifyError, handleVerifyPassphrase]);

  const handlePasskeyEnrolled = useCallback(async (blob: PasskeyEnrollment) => {
    // Case A — account already secured with a password: just attach the passkey
    // as an extra one-tap unlock.
    if (stored) {
      setPasskeyBlob(blob);
      const updated: StoredLocalAccount = { ...stored, passkey: blob };
      try {
        saveLocalAccountStrict(updated);
        setStored(updated);
      } catch (err) {
        console.error("Failed to attach passkey blob to stored account:", err);
        toast({
          title: "Couldn't save passkey on this device",
          description: "Storage may be full or blocked. You can still sign in with your password.",
          variant: "destructive",
        });
      }
      return;
    }

    // Case B — passkey-first: the user never typed a password. The passkey wraps
    // the secret key on its own, but our on-device record still needs an
    // encrypted blob (ncryptsec) to be valid. Generate a strong random recovery
    // passphrase the user never has to see, encrypt under it, and attach the
    // passkey. Day-to-day unlock is the passkey; recovery is the synced passkey
    // or the optional backup file's raw key.
    if (!account) return;
    setIsWorking(true);
    try {
      const recoveryPass = generatePassphraseSuggestion(8);
      const ncryptsec = await encryptSecretKeyAsync(account.secretKey, recoveryPass);
      const record: StoredLocalAccount = {
        pubkey: account.pubkey,
        npub: account.npub,
        ncryptsec,
        label: displayName.trim() || undefined,
        createdAt: Date.now(),
        passkey: blob,
      };
      try {
        saveLocalAccountStrict(record);
      } catch (saveErr) {
        console.error("Failed to save passkey-secured key:", saveErr);
        toast({
          title: "Couldn't save your account on this device",
          description: "Storage may be full or blocked (e.g. private browsing). Try a normal window, then try again.",
          variant: "destructive",
        });
        return;
      }
      // Round-trip verify before we trust the record (same discipline as the
      // password path) — proves the encrypted blob decrypts back to the key.
      let check: Uint8Array | null = null;
      try {
        const reloaded = loadLocalAccount();
        if (!reloaded || reloaded.ncryptsec !== ncryptsec || reloaded.pubkey !== account.pubkey) {
          throw new Error("stored record did not round-trip");
        }
        check = decryptStored(reloaded.ncryptsec, recoveryPass);
        if (check.length !== account.secretKey.length) throw new Error("length mismatch");
        let diff = 0;
        for (let i = 0; i < check.length; i++) diff |= check[i] ^ account.secretKey[i];
        if (diff !== 0) throw new Error("byte mismatch");
      } catch (verifyErr) {
        console.error("Passkey-secured key failed verification round-trip:", verifyErr);
        clearLocalAccount();
        toast({
          title: "Couldn't secure your account",
          description: "Your key wasn't saved cleanly on this device. Please try again — nothing was lost.",
          variant: "destructive",
        });
        return;
      } finally {
        if (check) check.fill(0);
      }
      setPasskeyBlob(blob);
      setStored(record);
      setDownloaded(false);
      toast({ title: "Account secured", description: "Sign in with a tap next time." });
    } catch (err) {
      console.error("Passkey-first secure failed:", err);
      toast({ title: "Couldn't secure your account", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setIsWorking(false);
    }
  }, [stored, account, displayName, toast]);

  const handleSuggestPassphrase = useCallback(() => {
    const suggestion = generatePassphraseSuggestion(6);
    setPassword(suggestion);
    setConfirmPassword(suggestion);
    setShowPassword(true);
  }, []);

  const handleCopyNpub = useCallback(async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.npub);
      setCopiedNpub(true);
      setTimeout(() => setCopiedNpub(false), 2000);
    } catch {}
  }, [account]);

  const handleCopyNsec = useCallback(async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.nsec);
      setCopiedNsec(true);
      setTimeout(() => setCopiedNsec(false), 2000);
      toast({ title: "Secret key copied", description: "Paste it somewhere safe — anyone holding it controls the account." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the key and copy it by hand.", variant: "destructive" });
    }
  }, [account, toast]);

  // Step 2: invite the browser / OS password manager to store the raw nsec
  // keyed off the user's npub. On browsers without a native save path, fall
  // back to copy-to-clipboard and tell the user what to paste where.
  const [savingNsecToManager, setSavingNsecToManager] = useState(false);
  const [savedNsecToManager, setSavedNsecToManager] = useState(false);
  const handleSaveNsecToManager = useCallback(async () => {
    if (!account) return;
    setSavingNsecToManager(true);
    try {
      const label = displayName.trim() ? `${displayName.trim()} — Relay Outpost` : "Relay Outpost";
      const result = await saveCredentialToPasswordManager({
        username: account.npub,
        password: account.nsec,
        label,
      });
      if (result === "credential-api") {
        // Chromium path — the native save sheet fired. Key material never
        // left this tab.
        setSavedNsecToManager(true);
        toast({
          title: "Offered to your password manager",
          description: "Confirm in the browser prompt to save.",
        });
      } else {
        // `fallback` — Safari / Firefox don't expose a no-network save API
        // we can use without POSTing the secret somewhere, so we copy and
        // tell the user where to paste.
        try {
          await navigator.clipboard.writeText(account.nsec);
          toast({
            title: "Copied — paste into your password manager",
            description: "Your browser doesn't offer a no-network save here. Paste the key into 1Password, Bitwarden, or your manager of choice.",
          });
        } catch {
          toast({
            title: "Couldn't save automatically",
            description: "Use the Copy nsec button above and paste it into your password manager by hand.",
            variant: "destructive",
          });
        }
      }
    } catch (err) {
      console.error("Save nsec to password manager failed:", err);
      toast({
        title: "Couldn't reach your password manager",
        description: "Try again, or copy the key and paste it in manually.",
        variant: "destructive",
      });
    } finally {
      setSavingNsecToManager(false);
    }
  }, [account, displayName, toast]);

  // Step 3: once the passphrase is verified, offer to stash the encrypted
  // ncryptsec into the password manager. This is the recommended path —
  // the saved value is useless without the passphrase, and it makes the
  // account portable across devices that share a password manager.
  const [savingEncryptedToManager, setSavingEncryptedToManager] = useState(false);
  const [savedEncryptedToManager, setSavedEncryptedToManager] = useState(false);
  const handleSaveEncryptedToManager = useCallback(async () => {
    if (!account || !stored) return;
    setSavingEncryptedToManager(true);
    try {
      const label = displayName.trim() ? `${displayName.trim()} — Relay Outpost` : "Relay Outpost";
      const result = await saveCredentialToPasswordManager({
        username: account.npub,
        password: stored.ncryptsec,
        label,
      });
      if (result === "credential-api") {
        setSavedEncryptedToManager(true);
        setSavedToManager(true);
        toast({
          title: "Offered to your password manager",
          description: "Confirm in the browser prompt to save the encrypted key against your npub.",
        });
      } else {
        try {
          await navigator.clipboard.writeText(stored.ncryptsec);
          toast({
            title: "Copied — paste into your password manager",
            description: "Your browser doesn't offer a no-network save here. Paste the encrypted key into your manager of choice, keyed off your npub.",
          });
        } catch {
          toast({
            title: "Couldn't save automatically",
            description: "Use the Download encrypted backup button instead — it's the same material, as a file.",
            variant: "destructive",
          });
        }
      }
    } catch (err) {
      console.error("Save encrypted key to password manager failed:", err);
      toast({
        title: "Couldn't reach your password manager",
        description: "Try again, or download the encrypted backup file as a fallback.",
        variant: "destructive",
      });
    } finally {
      setSavingEncryptedToManager(false);
    }
  }, [account, stored, displayName, toast]);

  const handleFinish = useCallback(async () => {
    if (!account || !stored || !acknowledged) return;
    setIsWorking(true);
    try {
      await loginWithLocalKey(account.secretKey, { isNewAccount: true });
      // Publish kind 0 metadata in background
      const dn = displayName.trim();
      const metadata: Record<string, string> = {
        name: (username.trim() || dn),
        display_name: dn,
      };
      if (bio.trim()) metadata.about = bio.trim();
      if (picture.trim()) metadata.picture = picture.trim();
      if (banner.trim()) metadata.banner = banner.trim();
      if (nip05.trim()) metadata.nip05 = nip05.trim();
      if (website.trim()) metadata.website = website.trim();
      if (lud16.trim()) metadata.lud16 = lud16.trim();
      const tags: string[][] = [...clientTags()];
      if (
        website.trim() &&
        featuredLinkInfo.type &&
        featuredLinkInfo.type !== "web"
      ) {
        tags.push(["r", website.trim(), featuredLinkInfo.type]);
      }
      const eventTpl = {
        kind: KIND_METADATA,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify(metadata),
      };
      try {
        const signed = finalizeEvent(eventTpl, account.secretKey);
        // Defensive: even though the local-key path here always preserves
        // the kind, the rest of the codebase verifies kind after sign so
        // that if onboarding ever switches to an external signer (NIP-07
        // etc.) we never silently publish a kind-1 text note instead of a
        // kind-0 metadata event.
        if (!verifySignedEventKind(signed, KIND_METADATA)) {
          console.warn("[CreateAccount] signer mutated event kind; skipping publish");
        } else {
          void publishEvent(signed);
        }
      } catch (e) {
        console.warn("[CreateAccount] kind 0 publish failed:", e);
      }
      // Publish a NIP-65 relay list (kind 10002) seeded with the app's default
      // relays, so OTHER Nostr clients (Damus, Primal, Amethyst, …) can discover
      // where to find this account's posts from day one. Without it a brand-new
      // account is effectively invisible to the wider ecosystem until it manually
      // sets relays. No marker on each "r" tag = read+write. Pushed to the
      // defaults plus the relay-list indexers so it propagates reliably.
      try {
        // Seed the recommended set from the curated relay pool (activity + free +
        // native-nostr + the device's language), keeping the app defaults first as
        // reliable write relays. New users only — never rewrites existing lists.
        const recommendedRelays = getDiscoverFeedRelays([...DEFAULT_RELAYS], true, getPreferredLanguages(), 10);
        const relayListEvent = {
          kind: 10002,
          created_at: Math.floor(Date.now() / 1000),
          tags: [...clientTags(), ...recommendedRelays.map((url) => ["r", url])],
          content: "",
        };
        const signedRelayList = finalizeEvent(relayListEvent, account.secretKey);
        if (!verifySignedEventKind(signedRelayList, 10002)) {
          console.warn("[CreateAccount] signer mutated relay-list kind; skipping publish");
        } else {
          void publishEvent(signedRelayList, [...DEFAULT_RELAYS, "wss://purplepag.es", "wss://relay.nostr.band"]);
        }
      } catch (e) {
        console.warn("[CreateAccount] relay list (kind 10002) publish failed:", e);
      }
      // Seed DM relays (kind 10050) and Blossom media servers (kind 10063) so a
      // brand-new account can receive DMs and upload images with zero setup —
      // the exact defaults Settings' "Use recommended" buttons apply. The
      // helpers also mirror the lists to localStorage, and we seed locally
      // FIRST so this device works even if the network publish fails.
      // Best-effort like the neighbors: never blocks account creation.
      try {
        const seedSigner = { signEvent: async (event: any) => finalizeEvent(event, account.secretKey) };
        setLocalDMRelays([...DM_FALLBACK_RELAYS]);
        void publishDMRelayList([...DM_FALLBACK_RELAYS], seedSigner).catch((e) => {
          console.warn("[CreateAccount] DM relay list (kind 10050) publish failed:", e);
        });
        setBlossomServers([...DEFAULT_BLOSSOM_SERVERS]);
        void publishBlossomServerList([...DEFAULT_BLOSSOM_SERVERS], seedSigner).catch((e) => {
          console.warn("[CreateAccount] Blossom server list (kind 10063) publish failed:", e);
        });
      } catch (e) {
        console.warn("[CreateAccount] DM/media seeding failed:", e);
      }
      // Publish the user's podcast RSS feed using the same dedicated event
      // (KIND_PODCAST_RSS + d-tag) the Media outpost reads for everyone else,
      // and mirror it to localStorage so it appears immediately on this device.
      let rssTrim = rss.trim();
      if (rssTrim && !/^https?:\/\//i.test(rssTrim)) {
        rssTrim = `https://${rssTrim}`;
      }
      if (rssTrim) {
        try {
          savePodcastFeed(account.pubkey, rssTrim);
          const podcastEvent = {
            kind: KIND_PODCAST_RSS,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["d", PODCAST_D_TAG], ...clientTags()],
            content: rssTrim,
          };
          const signedPodcast = finalizeEvent(podcastEvent, account.secretKey);
          if (!verifySignedEventKind(signedPodcast, KIND_PODCAST_RSS)) {
            console.warn("[CreateAccount] signer mutated podcast kind; skipping publish");
          } else {
            void publishEvent(signedPodcast);
          }
        } catch (e) {
          console.warn("[CreateAccount] podcast RSS publish failed:", e);
        }
      }
      // ---- New-account anchoring ----------------------------------------
      // Every new account gets at least one follow so the feed isn't empty on
      // day one AND their Web-of-Trust score has a real social graph to read.
      // If they arrived via a friend's invite link, the inviter is the best
      // possible anchor (a real relationship, already scored, already in the
      // outpost they're landing in); otherwise fall back to a small curated
      // starter set. Published here at creation so it survives a skipped
      // onboarding.
      try {
        let inviterHex: string | null = null;
        try { inviterHex = sessionStorage.getItem("relay-outpost-inviter"); } catch {}
        if (inviterHex && inviterHex === account.pubkey) inviterHex = null; // never follow yourself

        // Frictionless onboarding: every account follows exactly jack (a
        // deterministic WoT seed); invite arrivals additionally lead with
        // their inviter. No picker, no options — growth is organic.
        const anchor = buildAnchorFollows(inviterHex, CURATED_SEED_PUBKEYS);
        if (anchor.length > 0) {
          const followTpl = {
            kind: KIND_FOLLOW_LIST,
            created_at: Math.floor(Date.now() / 1000),
            tags: [...anchor.map((pk) => ["p", pk]), ...clientTags()],
            content: "",
          };
          try {
            const signedFollow = finalizeEvent(followTpl, account.secretKey);
            if (verifySignedEventKind(signedFollow, KIND_FOLLOW_LIST)) {
              void publishEvent(signedFollow);
              // Seed local follow state synchronously so any later follow merge
              // can never republish a kind-3 that drops the anchor (race-safe).
              updateFollows(() => [...anchor]);
            }
          } catch (e) {
            console.warn("[CreateAccount] anchor follow publish failed:", e);
          }
        }

        // Auto-join the outpost they were invited to (invited path only).
        if (inviterHex) {
          let inviteRelay: string | null = null;
          try { inviteRelay = sessionStorage.getItem("relay-outpost-invite-relay"); } catch {}
          if (inviteRelay) {
            void joinOutpostWithEnrichment(inviteRelay, undefined, account.pubkey).catch(() => {});
          }
        }
        // The follow half of the invite is fully consumed above, so hand the
        // person off rather than dropping them: the new account already follows
        // their inviter, and lands in a feed where they know nobody. This marker
        // is what lets InviteAcceptCard offer a one-tap hello — skipping its
        // follow step, which would otherwise re-ask for something already done.
        if (inviterHex) setInviteConnect({ inviter: inviterHex, step: "sayhi", source: "friend" });
        // Then clear the raw markers so the card can't ALSO run its follow flow.
        try {
          sessionStorage.removeItem("relay-outpost-inviter");
          sessionStorage.removeItem("relay-outpost-invite-relay");
        } catch {}

        // Auto-enable Web of Trust and fire the first score calc for every new
        // account (owner's decision) — safe now that an anchor always exists.
        // A per-pubkey once-guard stops a re-entered onboarding from re-firing;
        // the upstream ~30-min per-user cooldown is the server-side abuse cap.
        try {
          setWotEnabled(true);
          // Decision 4: public Nostr is OFF for new accounts and PRESERVED for
          // existing ones. This is the only place the opt-out is ever written,
          // and it must stay creation-only — never sign-in. An existing account
          // signing in on a fresh device has no stored value, and writing the
          // new-account default there would opt a long-time user out of their
          // own feed. Unset means ON precisely so that path stays safe; see
          // lib/public-nostr.ts.
          markNewAccountPublicNostrOff(account.pubkey);
          // Simplified navigation (Chats · Activity · Discover · You) is the
          // default a new account is born into. Existing accounts keep the nav
          // they know until the "your feed moved to Discover" line ships —
          // someone arriving today has no muscle memory to break, so they need
          // no such notice, which is exactly why this rail goes first.
          // Self-guards against overwriting an explicit choice on this device.
          // Never show a new account the "here's where things moved" line.
          // Nothing moved for someone who arrived after the move; that notice
          // is for people whose nav changed under them. (The nav itself needs
          // no marker any more — simplified IS the default now.)
          markIaMovedNoticeSeen(account.pubkey);
          const guardKey = `relay-outpost-initial-calc:${account.pubkey}`;
          if (!localStorage.getItem(guardKey)) {
            // The global signer registers via a React effect after this login;
            // triggerGrapeRankCalculation awaits a challenge fetch first, so the
            // signer is ready by the time it signs. Only consume the once-guard
            // when the calc actually started, so a rare transient failure never
            // permanently blocks the auto-calc.
            void triggerGrapeRankCalculation(account.pubkey)
              .then((r) => {
                if (r.ok || r.error === "rate_limited") {
                  try { localStorage.setItem(guardKey, "1"); } catch {}
                  notifyRecalculating();
                }
              })
              .catch(() => {});
          }
        } catch (e) {
          console.warn("[CreateAccount] WoT auto-enable failed:", e);
        }

      } catch (e) {
        console.warn("[CreateAccount] new-account anchoring failed:", e);
      }

      // The user is fully signed in — wipe the in-progress draft so the
      // next visit doesn't surface a stale "Resume signup" affordance.
      // Creation IS onboarding now — mark it complete so the gated surfaces
      // (PWA nudge, getting-started checklist, briefings) unlock immediately.
      try { markOnboardingComplete(account.pubkey); } catch {}
      trackSignupEvent("signup_completed", { wasResumed: wasResumedRef.current });
      clearSignupDraft();
      onComplete();
    } catch (err) {
      console.error("Finish failed:", err);
    } finally {
      setIsWorking(false);
    }
  }, [account, stored, acknowledged, displayName, username, bio, picture, banner, nip05, website, rss, lud16, loginWithLocalKey, updateFollows, setWotEnabled, notifyRecalculating, onComplete]);

  const stepDots = (
    <div className="flex items-center justify-center gap-1.5 mb-4">
      {[1, 2].map((n) => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all ${n === step ? "w-6" : "w-1.5"} ${
            n <= step ? (isOverlay ? "bg-white" : "bg-foreground") : (isOverlay ? "bg-white/15" : "bg-foreground/15")
          }`}
          data-testid={`step-dot-${n}`}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="container-create-account">
      {stepDots}

      {step === 1 && (() => {
        const continueBlockedReason = bannerUploading
          ? "Uploading banner…"
          : avatarUploading
          ? "Uploading avatar…"
          : !displayName.trim()
          ? "Add a display name to continue"
          : "";
        const fieldInputCls = `${inputCls} h-11 transition-shadow focus-visible:ring-2 ${isOverlay ? "focus-visible:ring-brand/40 focus-visible:shadow-[0_0_0_4px_rgba(139,92,246,0.08)]" : "focus-visible:ring-brand/30 focus-visible:shadow-[0_0_0_4px_rgba(139,92,246,0.06)]"}`;
        const optionalBadge = (
          <span className={`text-[8px] font-mono uppercase tracking-wider px-1 py-px rounded-sm leading-none ${isOverlay ? "text-white/55 bg-white/[0.04] border border-white/10" : "text-foreground/65 bg-foreground/[0.04] border border-border/40"}`}>Optional</span>
        );
        const labelBase = `text-xs font-brand uppercase tracking-widest flex items-center gap-1.5 ${subtleCls}`;
        return (
        <Card className={`${cardCls} relative overflow-hidden`}>
          {/* Soft brand glow accents */}
          <div aria-hidden className={`pointer-events-none absolute -top-24 -left-16 w-64 h-64 rounded-full blur-3xl ${isOverlay ? "bg-brand/10" : "bg-brand/[0.06]"}`} />
          <div aria-hidden className={`pointer-events-none absolute -bottom-24 -right-16 w-64 h-64 rounded-full blur-3xl ${isOverlay ? "bg-brand/[0.07]" : "bg-brand/[0.04]"}`} />

          <CardContent className="relative p-5 sm:p-6 space-y-6">
            {/* Branded header */}
            <div className={`relative rounded-xl p-4 ${isOverlay ? "bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent border border-white/10" : "bg-gradient-to-br from-brand/[0.06] via-foreground/[0.02] to-transparent border border-border/40"}`}>
              <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <h3 className={`text-base font-semibold tracking-tight ${titleCls}`} data-testid="text-step1-title">Create your profile</h3>
                  <p className={`text-xs mt-1 leading-relaxed ${descCls}`}>
                    Add a photo, banner, and a few details. Only the display name is required — you can change the rest later.
                  </p>
                </div>
                <a
                  href="/help"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WTF is this? — open the FAQ in a new tab"
                  data-testid="link-create-wtf"
                  className={`group/wtf shrink-0 self-start order-first sm:order-last inline-flex items-center gap-2 rounded-full transition-all duration-300 px-2 py-1.5 sm:px-2.5 sm:py-1.5 ${isOverlay ? "border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] hover:border-white/25" : "border border-border/50 bg-foreground/[0.03] hover:bg-foreground/[0.06] hover:border-border"}`}
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
            </div>

            {/* Banner + avatar (above-the-fold) */}
            <div className={`relative rounded-xl overflow-hidden border ${isOverlay ? "border-white/10 bg-white/[0.02]" : "border-border/40 bg-muted/30"}`}>
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} data-testid="input-upload-banner" />
              <div
                className={`relative w-full h-28 sm:h-32 cursor-pointer group/banner overflow-hidden ${isOverlay ? "profile-banner-bg" : "profile-banner-bg-light"}`}
                onClick={() => !bannerUploading && bannerInputRef.current?.click()}
                data-testid="banner-upload-zone"
              >
                {/* Always-on tiny LQIP placeholder so something paints instantly
                    while the real image streams in (or for new accounts that
                    haven't picked a banner yet). 328 bytes — costs nothing. */}
                <img
                  src="/images/default-relay-banner-lqip.jpg"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover scale-105 blur-[6px] pointer-events-none select-none"
                  draggable={false}
                />
                {banner ? (
                  <img
                    src={banner}
                    alt="Banner preview"
                    className={`relative w-full h-full object-cover transition-all duration-500 group-hover/banner:scale-[1.02] ${bannerLoaded ? "opacity-100" : "opacity-0"}`}
                    onLoad={() => setBannerLoaded(true)}
                    onError={() => setBannerLoaded(true)}
                    data-testid="img-banner-preview"
                  />
                ) : (
                  <>
                    {/* Ghost preview of the default banner so users see what would be used */}
                    <img
                      src="/images/default-relay-banner.jpg"
                      alt=""
                      aria-hidden="true"
                      loading="eager"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover opacity-[0.18] group-hover/banner:opacity-[0.28] transition-opacity duration-500 pointer-events-none select-none"
                      draggable={false}
                    />
                    <div aria-hidden className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/10 via-transparent to-black/40" />
                    <div aria-hidden className="absolute inset-0 pointer-events-none [background:radial-gradient(120%_80%_at_50%_50%,transparent_40%,rgba(0,0,0,0.35)_100%)]" />
                    {/* Subtle violet→cyan aurora wash for cosmic depth — very low
                        opacity so it never overwhelms the banner art. */}
                    <div aria-hidden className="absolute inset-0 pointer-events-none opacity-60 [background:radial-gradient(80%_120%_at_15%_30%,rgba(139,92,246,0.18),transparent_55%),radial-gradient(70%_110%_at_85%_70%,rgba(56,189,248,0.14),transparent_55%)]" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
                      <div className="relative">
                        {/* Soft violet halo behind the pill */}
                        <div aria-hidden className="absolute -inset-1.5 rounded-full bg-brand/8 blur-md pointer-events-none" />
                        <div className={`relative flex items-center px-3.5 py-1.5 rounded-full backdrop-blur-md ring-1 ring-brand/15 ${isOverlay ? "bg-black/65 text-white group-hover/banner:bg-black/75 border border-white/15" : "bg-black/70 text-white group-hover/banner:bg-black/80 border border-white/20"} transition-colors shadow-[0_2px_10px_rgba(0,0,0,0.35)]`}>
                          <span className="text-xs font-medium tracking-tight">Add a banner image</span>
                        </div>
                      </div>
                      <span className="text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">1500 × 500 recommended</span>
                    </div>
                  </>
                )}
                {/* Shimmer over the LQIP while a user-uploaded banner is still
                    decoding, so it feels alive instead of stuck. */}
                {banner && !bannerLoaded && (
                  <div aria-hidden className="absolute inset-0 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-shimmer" />
                  </div>
                )}
                {/* Subtle full-banner dim on hover for affordance — no
                    centered button anymore; the action lives in the corner. */}
                <div aria-hidden className="absolute inset-0 bg-black/0 group-hover/banner:bg-black/20 transition-colors pointer-events-none" />
                {/* Corner-aligned Upload pill — visible by default so mobile
                    users (no hover) can still see the call-to-action, slightly
                    brighter on hover. Skipped when a banner is already set;
                    the existing bottom-right Replace button covers that case. */}
                {!banner && !bannerUploading && (
                  <div
                    className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 bg-black/55 group-hover/banner:bg-black/75 backdrop-blur-sm rounded-full pl-2.5 pr-3 py-1 shadow-md transition-colors pointer-events-none"
                    data-testid="banner-upload-pill"
                  >
                    <Upload className="w-3 h-3 text-white" />
                    <span className="text-[10px] sm:text-xs font-brand uppercase tracking-widest text-white">Upload</span>
                  </div>
                )}
                {banner && !bannerUploading && (
                  <>
                    <button
                      type="button"
                      className="absolute bottom-2 right-2 z-10 flex items-center gap-1.5 bg-black/55 hover:bg-black/75 text-white rounded-full pl-2.5 pr-3 py-1 backdrop-blur-sm shadow-md text-xs font-brand uppercase tracking-widest transition-colors"
                      onClick={(e) => { e.stopPropagation(); bannerInputRef.current?.click(); }}
                      data-testid="button-replace-banner"
                    >
                      <Camera className="w-3 h-3" />
                      Replace
                    </button>
                    <button
                      type="button"
                      className="absolute top-2 right-2 z-10 h-7 w-7 flex items-center justify-center bg-black/55 hover:bg-black/75 text-white/85 hover:text-white rounded-full backdrop-blur-sm shadow-md transition-colors"
                      onClick={(e) => { e.stopPropagation(); setBanner(""); }}
                      data-testid="button-remove-banner"
                      aria-label="Remove banner"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {bannerUploading && bannerStatus && (
                  <div className="absolute top-2 left-2 z-10">
                    <span className="text-xs font-mono uppercase tracking-wider text-white/90 bg-black/55 backdrop-blur-sm rounded-full px-2.5 py-1 flex items-center gap-1.5">
                      <RelayOutpostInlineLoader className="w-3 h-3 text-white" />
                      {bannerStatus}
                    </span>
                  </div>
                )}
              </div>
              {/* Avatar overlay row — caption stacks below the avatar on
                   narrow screens so longer text can never push upward and
                   collide with the banner content above. */}
              <div className="relative -mt-10 sm:-mt-12 px-4 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3">
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} data-testid="input-upload-avatar" />
                  <div className="relative shrink-0">
                    {avatarUploading && (
                      <div aria-hidden className={`absolute inset-0 rounded-full blur-md animate-pulse ${isOverlay ? "bg-brand/40" : "bg-brand/25"}`} />
                    )}
                    <div
                      className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full border-[3px] cursor-pointer group/avatar overflow-hidden shadow-xl transition-transform hover:scale-[1.03] ${isOverlay ? "border-white/20 bg-[radial-gradient(circle_at_30%_25%,#2a3550_0%,#0f1626_55%,#05080f_100%)]" : "border-background bg-muted"}`}
                      onClick={() => !avatarUploading && avatarInputRef.current?.click()}
                      data-testid="button-upload-avatar"
                    >
                      {picture ? (
                        <img src={picture} alt="Avatar preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center ${isOverlay ? "bg-brand/15" : "bg-primary/10"}`}>
                          <CameraOutpostIcon className={`w-12 h-12 sm:w-14 sm:h-14 ${isOverlay ? "text-white/40" : "text-white/50 drop-shadow-sm"}`} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover/avatar:bg-black/35 transition-colors rounded-full flex items-center justify-center">
                        <div className="opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                          {avatarUploading ? <RelayOutpostInlineLoader className="w-5 h-5 text-white" /> : <Upload className="w-5 h-5 text-white" />}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full flex items-center justify-center shadow-lg pointer-events-none ${isOverlay ? "bg-white text-black border-2 border-black/80" : "bg-foreground text-background border-2 border-background"}`}
                      aria-hidden
                    >
                      {avatarUploading ? <RelayOutpostInlineLoader className="w-3 h-3" /> : <Camera className="w-3.5 h-3.5" />}
                    </div>
                    {picture && !avatarUploading && (
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 h-5 w-5 bg-destructive/90 hover:bg-destructive text-white rounded-full flex items-center justify-center z-10 shadow-md"
                        onClick={(e) => { e.stopPropagation(); setPicture(""); }}
                        data-testid="button-remove-avatar"
                        aria-label="Remove avatar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 sm:pb-1.5">
                    {avatarUploading && avatarStatus ? (
                      <span className={`text-xs flex items-center gap-1.5 ${subtleCls}`}>
                        <RelayOutpostInlineLoader className="w-3 h-3" />
                        {avatarStatus}
                      </span>
                    ) : (
                      <>
                        <p className={`text-xs font-medium leading-tight ${isOverlay ? "text-white/85" : "text-foreground/85"}`}>Profile photo</p>
                        <p className={`text-[11px] sm:text-xs mt-0.5 leading-snug ${subtleCls}`}>
                          <span className="sm:hidden">Tap to change · max 10MB</span>
                          <span className="hidden sm:inline">Tap avatar or banner to change · PNG/JPG, up to 10MB</span>
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Essentials: display name + bio (above the fold) */}
            <div className="space-y-4">
              {/* Display name (required) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {/* Display name (required) */}
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={labelBase}>
                      <User className="w-3 h-3 opacity-60" />
                      Display name
                      <span className={`text-xs tracking-normal ${isOverlay ? "text-brand" : "text-brand"}`}>*</span>
                    </Label>
                    {displayName && (
                      <span className={`text-xs tabular-nums ${subtleCls}`}>{displayName.length}/50</span>
                    )}
                  </div>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value.slice(0, 50))}
                    placeholder="e.g. Buzz"
                    className={fieldInputCls}
                    style={{ fontSize: 16 }}
                    autoFocus
                    data-testid="input-display-name"
                  />
                  <p className={`text-xs ${subtleCls}`}>Shown publicly on your profile.</p>
                </div>

                {/* Username (optional) */}
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <Label className={labelBase}>
                      <AtSign className="w-3 h-3 opacity-60" />
                      Username
                      {optionalBadge}
                    </Label>
                    {username && (
                      <span className={`text-xs tabular-nums ${subtleCls}`}>{username.length}/30</span>
                    )}
                  </div>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.slice(0, 30))}
                    placeholder="e.g. Buzz333"
                    className={fieldInputCls}
                    style={{ fontSize: 16 }}
                    autoCapitalize="off"
                    autoCorrect="off"
                    data-testid="input-username"
                  />
                  <p className={`text-xs ${subtleCls}`}>Short handle. Defaults to display name.</p>
                </div>
              </div>

              {/* Bio */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className={labelBase}>
                    <FileText className="w-3 h-3 opacity-60" />
                    Bio
                    {optionalBadge}
                  </Label>
                  {bio && (
                    <span className={`text-xs tabular-nums ${subtleCls}`}>{bio.length}/500</span>
                  )}
                </div>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 500))}
                  placeholder="Tell the network about yourself…"
                  rows={3}
                  className={`resize-none ${fieldInputCls} h-auto py-2.5`}
                  style={{ fontSize: 16 }}
                  data-testid="input-bio"
                />
              </div>
            </div>

            {/* Add more details (collapsible) */}
            <div
              className={`rounded-xl border-2 sm:border ${
                isOverlay
                  ? "border-brand/40 sm:border-white/10 bg-brand/[0.06] sm:bg-white/[0.02]"
                  : "border-primary/40 sm:border-border/40 bg-primary/[0.05] sm:bg-muted/20"
              } shadow-[0_0_24px_-8px_rgba(139,92,246,0.45)] sm:shadow-none`}
            >
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                aria-controls="create-advanced-panel"
                className={`w-full flex items-center gap-3 sm:gap-2 px-4 py-4 sm:py-3 text-left rounded-xl transition-colors ${isOverlay ? "hover:bg-white/[0.04]" : "hover:bg-foreground/[0.03]"}`}
                data-testid="button-toggle-add-more-details"
              >
                {/* Icon bubble — bold on mobile, flat on desktop */}
                <span
                  className={`relative shrink-0 inline-flex items-center justify-center w-9 h-9 sm:w-auto sm:h-auto rounded-full sm:rounded-none ${
                    isOverlay
                      ? "bg-brand/25 sm:bg-transparent ring-1 ring-brand/40 sm:ring-0"
                      : "bg-primary/15 sm:bg-transparent ring-1 ring-primary/35 sm:ring-0"
                  }`}
                >
                  <span aria-hidden className="absolute inset-0 rounded-full blur-md bg-brand/30 sm:hidden" />
                  <RelayOutpostIcon className={`relative w-5 h-5 sm:w-4 sm:h-4 ${isOverlay ? "text-brand sm:text-brand/80" : "text-brand sm:text-brand/80"}`} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm sm:text-xs font-semibold tracking-tight ${isOverlay ? "text-white" : "text-foreground"}`}>Add more details</p>
                  <p className={`text-xs sm:text-[11px] mt-0.5 sm:hidden ${subtleCls}`}>
                    Verified address, featured link, Bitcoin tips — all optional.
                  </p>
                </div>
                <span
                  className={`shrink-0 inline-flex items-center justify-center w-7 h-7 sm:w-auto sm:h-auto rounded-full sm:rounded-none transition-colors ${
                    isOverlay ? "bg-white/[0.06] sm:bg-transparent" : "bg-foreground/[0.05] sm:bg-transparent"
                  }`}
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""} ${ghostBtnCls}`} />
                </span>
              </button>

              {showAdvanced && (
                <div
                  id="create-advanced-panel"
                  className={`px-4 pb-4 pt-1 space-y-4 border-t ${isOverlay ? "border-white/10" : "border-border/40"}`}
                >
                  {/* NIP-05 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label className={labelBase}>
                        <BadgeCheck className="w-3 h-3 opacity-60" />
                        Verified address
                        {optionalBadge}
                      </Label>
                      <FieldInfo
                        isOverlay={isOverlay}
                        title="Verified address"
                        testId="info-nip05"
                        body={
                          <p>A username on your own domain, like <strong>you@yoursite.com</strong>. It shows a verified badge next to your name and works everywhere — set it up with your domain host.</p>
                        }
                      />
                    </div>
                    <Input
                      value={nip05}
                      onChange={(e) => setNip05(e.target.value)}
                      placeholder="you@yoursite.com"
                      className={fieldInputCls}
                      style={{ fontSize: 16 }}
                      inputMode="email"
                      autoCapitalize="off"
                      autoCorrect="off"
                      data-testid="input-nip05"
                    />
                    <p className={`text-xs ${subtleCls}`}>A verified username on your own domain.</p>
                  </div>

                  {/* Featured link or feed (smart-detect) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label className={labelBase}>
                        <Link2 className="w-3 h-3 opacity-60" />
                        Featured link
                        {optionalBadge}
                      </Label>
                      <FieldInfo
                        isOverlay={isOverlay}
                        title="Featured link"
                        testId="info-website"
                        body={
                          <p>One spotlight link on your profile — website, Substack, YouTube, GitHub, podcast, anything. We auto-detect it and show a matching icon. Links straight to your URL, no redirect.</p>
                        }
                      />
                    </div>
                    <Input
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="Website, Substack, YouTube, GitHub…"
                      className={fieldInputCls}
                      style={{ fontSize: 16 }}
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      data-testid="input-website"
                    />
                    {featuredLinkInfo.type ? (
                      <div
                        className={`inline-flex items-center gap-1.5 mt-0.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full ${ isOverlay ? "bg-brand/15 border border-brand/30 text-brand" : "bg-brand/10 border border-brand/30 text-brand" }`}
                        data-testid="text-featured-link-type"
                      >
                        {featuredLinkInfo.type === "rss" && <Rss className="w-3 h-3" />}
                        {featuredLinkInfo.type === "podcast" && <Mic className="w-3 h-3" />}
                        {featuredLinkInfo.type === "youtube" && <Youtube className="w-3 h-3" />}
                        {(featuredLinkInfo.type === "vimeo" || featuredLinkInfo.type === "rumble") && <PlayCircle className="w-3 h-3" />}
                        {(featuredLinkInfo.type === "substack" || featuredLinkInfo.type === "medium") && <FileText className="w-3 h-3" />}
                        {featuredLinkInfo.type === "code" && <Code2 className="w-3 h-3" />}
                        {featuredLinkInfo.type === "web" && <Link2 className="w-3 h-3" />}
                        Detected: {featuredLinkInfo.label}
                      </div>
                    ) : (
                      <p className={`text-xs ${subtleCls}`}>One link to feature on your profile. We'll detect the type automatically.</p>
                    )}
                  </div>

                  {/* RSS feed — surfaces in the user's Media outpost */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label className={labelBase}>
                        <Rss className="w-3 h-3 opacity-60" />
                        RSS feed
                        {optionalBadge}
                      </Label>
                      <FieldInfo
                        isOverlay={isOverlay}
                        title="RSS feed"
                        testId="info-rss"
                        body={
                          <p>Add a podcast or blog <strong>RSS</strong> feed and your episodes show in your profile's Media section, playable right there. Any standard RSS link works.</p>
                        }
                      />
                    </div>
                    <Input
                      value={rss}
                      onChange={(e) => setRss(e.target.value)}
                      placeholder="https://yourblog.com/rss.xml"
                      className={fieldInputCls}
                      style={{ fontSize: 16 }}
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      data-testid="input-rss"
                    />
                    <p className={`text-xs ${subtleCls}`}>If set, episodes will appear in your profile's Media outpost.</p>
                  </div>

                  {/* Lightning */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label className={labelBase}>
                        <BitcoinIcon className="w-3.5 h-3.5 opacity-80 text-amber-500" />
                        Bitcoin tips
                        {optionalBadge}
                      </Label>
                      <FieldInfo
                        isOverlay={isOverlay}
                        title="Bitcoin tips"
                        testId="info-lud16"
                        body={
                          <p>An address like <strong>you@strike.me</strong> that lets people tip you <strong>Bitcoin</strong>, straight to your wallet. Get a free one from Strike, Alby, or Coinos.</p>
                        }
                      />
                    </div>
                    <Input
                      value={lud16}
                      onChange={(e) => setLud16(e.target.value)}
                      placeholder="e.g. you@strike.me"
                      className={fieldInputCls}
                      style={{ fontSize: 16 }}
                      inputMode="email"
                      autoCapitalize="off"
                      autoCorrect="off"
                      data-testid="input-lud16"
                    />
                    <p className={`text-xs ${subtleCls}`}>Let people tip you in Bitcoin, straight to your wallet.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="space-y-2 pt-1">
              {continueBlockedReason && (
                <div className={`flex items-center justify-end gap-1.5 text-xs font-mono uppercase tracking-wider ${subtleCls}`} data-testid="text-continue-blocked-reason">
                  {(avatarUploading || bannerUploading) && <RelayOutpostInlineLoader className="w-3 h-3" />}
                  <span>{continueBlockedReason}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleBack} className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`} data-testid="button-create-back">
                  <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Button>
                <div className="flex-1" />
                <Button
                  onClick={handleStep1Continue}
                  disabled={!displayName.trim() || avatarUploading || bannerUploading}
                  className={`group/cta relative text-xs font-brand uppercase tracking-widest h-11 px-5 shadow-lg transition-all hover:shadow-xl disabled:shadow-none ${
                    isOverlay
                      ? "bg-gradient-to-r from-white to-white/90 text-black hover:from-white hover:to-white shadow-white/20"
                      : "bg-gradient-to-r from-brand to-brand text-white hover:from-brand hover:to-brand shadow-brand/25"
                  }`}
                  data-testid="button-create-step1-continue"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover/cta:translate-x-0.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {step === 2 && account && (
        <Card className={cardCls}>
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-md ${isOverlay ? "bg-white/5 border border-white/10" : "bg-foreground/5 border border-border/40"}`}>
                {stored ? <Check className={`w-5 h-5 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} /> : <Lock className={`w-5 h-5 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />}
              </div>
              <div>
                <h3 className={`text-base font-semibold tracking-tight ${titleCls}`} data-testid="text-step2-title">
                  {stored ? "You're all set" : "Secure your account"}
                </h3>
                <p className={`text-xs mt-0.5 leading-relaxed ${descCls}`}>
                  {stored
                    ? (passkeyBlob ? "Sign in with a tap next time. One last thing:" : "Sign in with your password next time. One last thing:")
                    : "One tap and you're in — we keep your account safe on this device."}
                </p>
              </div>
            </div>

            {!stored ? (
              <div className="space-y-4">
                {/* Recommended one-tap path — the card self-hides on devices
                    without a platform authenticator. */}
                <PasskeyEnrollmentCard
                  variant={variant}
                  secretKey={account.secretKey}
                  pubkey={account.pubkey}
                  npub={account.npub}
                  accountLabel={displayName.trim() || "Relay Outpost"}
                  enrolled={false}
                  onEnrolled={handlePasskeyEnrolled}
                />
                {isWorking && (
                  <p className={`text-xs text-center flex items-center justify-center gap-2 ${subtleCls}`}>
                    <RelayOutpostInlineLoader className="w-3.5 h-3.5" /> Securing your account…
                  </p>
                )}

                {/* Password fallback */}
                <div className={`rounded-md ${isOverlay ? "border border-white/10" : "border border-border/40"}`}>
                  <button
                    type="button"
                    onClick={() => setShowPasswordPath((v) => !v)}
                    className={`w-full px-3 py-2.5 flex items-center gap-2 text-left ${isOverlay ? "hover:bg-white/5" : "hover:bg-foreground/5"}`}
                    data-testid="button-toggle-password-path"
                  >
                    <KeyRound className={`w-4 h-4 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${titleCls}`}>Set a password instead</p>
                      <p className={`text-xs ${descCls}`}>Sign in with a password you save to your browser.</p>
                    </div>
                    <ArrowRight className={`w-3.5 h-3.5 transition-transform ${showPasswordPath ? "rotate-90" : ""} ${ghostBtnCls}`} />
                  </button>

                  {showPasswordPath && (
                    <div className={`px-3 py-3 space-y-3 border-t ${isOverlay ? "border-white/10 bg-black/20" : "border-border/40 bg-foreground/[0.02]"}`}>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Password</Label>
                          <button
                            type="button"
                            onClick={handleSuggestPassphrase}
                            className={`inline-flex items-center gap-1 text-[10px] font-brand uppercase tracking-[0.14em] font-bold px-2 py-1 rounded-md transition-colors ${isOverlay ? "text-brand hover:text-white hover:bg-brand/20 border border-brand/20" : "text-brand hover:text-brand/80 hover:bg-brand/10 border border-brand/25"}`}
                            data-testid="button-suggest-passphrase"
                          >
                            <Dice5 className="w-3 h-3" /> Suggest 6 random words
                          </button>
                        </div>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="At least 8 characters"
                            className={`${inputCls} pr-10`}
                            style={{ fontSize: 16 }}
                            autoComplete="new-password"
                            data-testid="input-passphrase"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className={`absolute right-2 top-1/2 -translate-y-1/2 ${ghostBtnCls}`}
                            data-testid="button-toggle-passphrase-visibility"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        {password && (
                          <div className="flex items-center gap-2">
                            <div className={`h-1 flex-1 rounded-full overflow-hidden ${isOverlay ? "bg-white/10" : "bg-foreground/10"}`}>
                              <div
                                className={`h-full transition-all ${passwordStrength.score <= 1 ? "bg-red-500" : passwordStrength.score === 2 ? "bg-amber-500" : passwordStrength.score === 3 ? "bg-yellow-500" : "bg-emerald-500"}`}
                                style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                              />
                            </div>
                            <span className={`text-xs font-mono uppercase tracking-wider ${subtleCls}`}>{passwordStrength.label}</span>
                          </div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={`text-xs font-brand uppercase tracking-widest ${subtleCls}`}>Confirm password</Label>
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Type it again"
                          className={inputCls}
                          style={{ fontSize: 16 }}
                          autoComplete="new-password"
                          data-testid="input-passphrase-confirm"
                        />
                        {confirmPassword && password !== confirmPassword && (
                          <p className="text-xs text-destructive">Passwords don't match</p>
                        )}
                      </div>
                      <Button
                        onClick={handleEncryptAndSave}
                        disabled={!passwordValid || isWorking}
                        className={`w-full text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`}
                        data-testid="button-encrypt-key"
                      >
                        {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                        {isWorking ? "Saving…" : "Save password & continue"}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setStep(1)} className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`} data-testid="button-step2-back">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`rounded-md p-3 flex items-start gap-2 ${isOverlay ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-emerald-500/10 border border-emerald-500/30"}`} data-testid="panel-secured">
                  <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${isOverlay ? "text-emerald-300" : "text-emerald-700"}`} />
                  <p className={`text-xs leading-relaxed ${isOverlay ? "text-emerald-100" : "text-emerald-900"}`}>
                    Your account is saved on this device{passkeyBlob ? " and unlocks with a tap" : ""}. Only you hold the key that controls it.
                  </p>
                </div>

                <label className={`flex items-start gap-2.5 cursor-pointer p-3 rounded-md transition-colors ${ackOnlyMe ? (isOverlay ? "bg-emerald-500/[0.07] border border-emerald-400/25" : "bg-emerald-500/[0.05] border border-emerald-500/25") : (isOverlay ? "bg-white/[0.03] border border-white/10 hover:bg-white/[0.05]" : "bg-foreground/[0.03] border border-border/30 hover:bg-foreground/[0.05]")}`}>
                  <input type="checkbox" checked={ackOnlyMe} onChange={(e) => setAckOnlyMe(e.target.checked)} className="mt-0.5" data-testid="checkbox-ack-only-me" />
                  <span className={`text-xs leading-relaxed ${descCls}`}>
                    I understand only I can recover this account — there's no password reset.
                  </span>
                </label>

                <div className={`rounded-md ${isOverlay ? "border border-white/10" : "border border-border/40"}`}>
                  <button
                    type="button"
                    onClick={() => setShowSecureAdvanced((v) => !v)}
                    className={`w-full px-3 py-2.5 flex items-center gap-2 text-left ${isOverlay ? "hover:bg-white/5" : "hover:bg-foreground/5"}`}
                    data-testid="button-toggle-secure-advanced"
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${showSecureAdvanced ? "rotate-180" : ""} ${ghostBtnCls}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${titleCls}`}>Advanced: backup &amp; recovery</p>
                      <p className={`text-xs ${descCls}`}>Download a backup, view your public username, or reveal your recovery code.</p>
                    </div>
                  </button>
                  {showSecureAdvanced && (
                    <div className={`px-3 py-3 space-y-3 border-t ${isOverlay ? "border-white/10 bg-black/20" : "border-border/40 bg-foreground/[0.02]"}`}>
                      <div className="space-y-1.5">
                        <p className={`text-[10px] font-brand uppercase tracking-[0.18em] font-bold ${subtleCls}`}>Your public username</p>
                        <code className={`block text-[11px] break-all font-mono ${isOverlay ? "text-white/80" : "text-foreground/80"}`} data-testid="text-new-npub">{account.npub}</code>
                        <Button size="sm" variant="outline" onClick={handleCopyNpub} className={`h-8 text-[11px] font-brand uppercase tracking-[0.12em] font-bold ${isOverlay ? "border-white/15 text-white/85 hover:bg-white/10" : ""}`} data-testid="button-copy-npub">
                          {copiedNpub ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                          {copiedNpub ? "Copied" : "Copy"}
                        </Button>
                      </div>

                      <Button
                        onClick={handleDownloadBackup}
                        variant="outline"
                        className={`w-full text-xs font-brand uppercase tracking-widest transition-all ${downloadJustSaved ? (isOverlay ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700") : (isOverlay ? "border-white/20 text-white/80" : "")}`}
                        data-testid="button-download-backup"
                      >
                        {downloadJustSaved ? <CheckCircle2 className="w-4 h-4 mr-2" /> : downloaded ? <Check className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                        {downloadJustSaved ? "Saved — keep it safe" : downloaded ? "Backup saved — download again" : "Download backup file"}
                      </Button>
                      <p className={`text-[11px] leading-relaxed ${subtleCls}`}>The backup is the only thing that moves your account between devices and browsers. We keep no copy.</p>

                      <div className={`rounded-md ${isOverlay ? "border border-white/10" : "border border-border/40"}`}>
                        <button
                          type="button"
                          onClick={() => setShowNsec((v) => !v)}
                          aria-pressed={showNsec}
                          className={`w-full px-3 py-2 flex items-center gap-2 text-left ${isOverlay ? "hover:bg-white/5" : "hover:bg-foreground/5"}`}
                          data-testid="button-reveal-nsec-step3"
                        >
                          {showNsec ? <EyeOff className={`w-4 h-4 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} /> : <Eye className={`w-4 h-4 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />}
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-semibold ${titleCls}`}>{showNsec ? "Hide recovery code" : "Reveal recovery code"}</p>
                            <p className={`text-xs ${descCls}`}>Your raw key. Anyone holding it controls the account.</p>
                          </div>
                        </button>
                        {showNsec && (
                          <div className={`px-3 py-2.5 space-y-2 border-t ${isOverlay ? "border-white/10 bg-black/20" : "border-border/40 bg-foreground/[0.02]"}`}>
                            <code className={`block text-xs break-all font-mono p-2 rounded select-all ${isOverlay ? "bg-black/40 text-white/80" : "bg-background text-foreground/80"}`} data-testid="text-step3-nsec">{account.nsec}</code>
                            <Button size="sm" variant="outline" onClick={handleCopyNsec} className={`w-full text-xs font-brand uppercase tracking-widest ${isOverlay ? "border-white/20 text-white/80" : ""}`} data-testid="button-copy-nsec-step3">
                              {copiedNsec ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                              {copiedNsec ? "Copied" : "Copy recovery code"}
                            </Button>
                          </div>
                        )}
                      </div>

                      {!passkeyBlob && (
                        <Button
                          onClick={handleSaveEncryptedToManager}
                          disabled={savingEncryptedToManager}
                          variant="outline"
                          className={`w-full text-xs font-brand uppercase tracking-widest transition-all ${savedEncryptedToManager ? (isOverlay ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700") : (isOverlay ? "border-white/20 text-white/80" : "")}`}
                          data-testid="button-save-ncryptsec-to-password-manager"
                        >
                          {savingEncryptedToManager ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : savedEncryptedToManager ? <Check className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                          {savingEncryptedToManager ? "Saving…" : savedEncryptedToManager ? "Saved to password manager" : "Save to password manager"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <p className={`text-[10px] leading-relaxed ${subtleCls}`} data-testid="text-create-legal-links">
                  By continuing you accept our{" "}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground/80" data-testid="link-create-covenant">Terms</a>
                  {" "}and{" "}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-foreground/80" data-testid="link-create-privacy">Privacy</a>
                  . Your keys are yours — if you lose them, no one can recover them for you.
                </p>

                <div className="flex items-center gap-2 pt-1">
                  <Button variant="ghost" onClick={() => setStep(1)} className={`text-xs font-brand uppercase tracking-widest ${ghostBtnCls}`} data-testid="button-step2-back">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <div className="flex-1" />
                  <Button onClick={handleFinish} disabled={!acknowledged || isWorking} className={`text-xs font-brand uppercase tracking-widest ${primaryBtnCls}`} data-testid="button-finish-create">
                    {isWorking ? <RelayOutpostInlineLoader className="w-4 h-4 mr-2" /> : null}
                    {isWorking ? "Signing in…" : "Go to my feed"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
