import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import * as nip49 from "nostr-tools/nip49";
import type { PasskeyEnrollment } from "@/lib/passkey";
import { namespacedKey, getAccount as getRegisteredAccount } from "@/lib/account-registry";

const STORAGE_KEY = "relay-outpost-local-account";
const ONBOARDING_KEY = "relay-outpost-onboarding-complete";
const FIRST_POST_DRAFT_KEY_PREFIX = "relay-outpost-onboarding-first-post-draft:";

// Plaintext secret used by the "stay signed in on this device" path. Stored
// as an nsec1… string so it's compact, standard, and easy to audit. This is
// the same trade-off Ditto / Iris / Snort / Coracle / Damus Web make: the
// secret lives on disk so reload/PWA-respawn doesn't kick the user out,
// and it is wiped on logout / vanish / forget-account.
export const LOCAL_SECRET_STORAGE_KEY = "relay-outpost-local-secret";

export interface FirstPostDraft {
  text: string;
  imageUrl: string | null;
  updatedAt: number;
}

function firstPostDraftKey(pubkey: string): string {
  return `${FIRST_POST_DRAFT_KEY_PREFIX}${pubkey}`;
}

export function loadFirstPostDraft(pubkey: string): FirstPostDraft | null {
  if (!pubkey) return null;
  try {
    const raw = localStorage.getItem(firstPostDraftKey(pubkey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FirstPostDraft>;
    const text = typeof parsed?.text === "string" ? parsed.text : "";
    const imageUrl = typeof parsed?.imageUrl === "string" && parsed.imageUrl ? parsed.imageUrl : null;
    if (!text && !imageUrl) return null;
    return { text, imageUrl, updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : Date.now() };
  } catch {
    return null;
  }
}

export function saveFirstPostDraft(pubkey: string, draft: { text: string; imageUrl: string | null }): void {
  if (!pubkey) return;
  try {
    if (!draft.text && !draft.imageUrl) {
      localStorage.removeItem(firstPostDraftKey(pubkey));
      return;
    }
    const payload: FirstPostDraft = {
      text: draft.text,
      imageUrl: draft.imageUrl,
      updatedAt: Date.now(),
    };
    localStorage.setItem(firstPostDraftKey(pubkey), JSON.stringify(payload));
  } catch {}
}

export function clearFirstPostDraft(pubkey: string): void {
  if (!pubkey) return;
  try { localStorage.removeItem(firstPostDraftKey(pubkey)); } catch {}
}

export interface StoredLocalAccount {
  pubkey: string;
  npub: string;
  ncryptsec: string;
  label?: string;
  createdAt: number;
  /**
   * Optional passkey enrollment. When present, the user can unlock with
   * Face ID / Touch ID / Fingerprint / Windows Hello via WebAuthn PRF, and
   * the passphrase becomes the recovery path.
   *
   * Stored entirely on the user's device — Relay Outpost has no copy of the
   * passkey, the PRF output, or any part of this blob.
   */
  passkey?: PasskeyEnrollment;
}

export interface NewLocalAccount {
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
  nsec: string;
}

export function generateLocalAccount(): NewLocalAccount {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const npub = nip19.npubEncode(pubkey);
  const nsec = nip19.nsecEncode(secretKey);
  return { secretKey, pubkey, npub, nsec };
}

export function encryptSecretKey(secretKey: Uint8Array, password: string): string {
  const logn = 16;
  return nip49.encrypt(secretKey, password, logn, 0x02);
}

let encryptWorker: Worker | null = null;
let encryptWorkerSeq = 0;
let encryptWorkerUnsupported = false;

function getEncryptWorker(): Worker | null {
  if (encryptWorkerUnsupported) return null;
  if (encryptWorker) return encryptWorker;
  if (typeof Worker === "undefined") {
    encryptWorkerUnsupported = true;
    return null;
  }
  try {
    encryptWorker = new Worker(
      new URL("../workers/encrypt-key.worker.ts", import.meta.url),
      { type: "module" },
    );
    return encryptWorker;
  } catch (err) {
    console.warn("[local-account] Web Worker unavailable, falling back to inline encryption.", err);
    encryptWorkerUnsupported = true;
    encryptWorker = null;
    return null;
  }
}

function encryptInline(secretKey: Uint8Array, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Yield to the event loop so the spinner paints before the heavy work.
    setTimeout(() => {
      try {
        resolve(encryptSecretKey(secretKey, password));
      } catch (err) {
        reject(err);
      }
    }, 30);
  });
}

function disposeWorker() {
  if (encryptWorker) {
    try { encryptWorker.terminate(); } catch {}
    encryptWorker = null;
  }
}

function encryptViaWorker(worker: Worker, secretKey: Uint8Array, password: string): Promise<string> {
  const id = ++encryptWorkerSeq;
  return new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<{ id: number; ok: boolean; ncryptsec?: string; error?: string }>) => {
      const data = event.data;
      if (!data || data.id !== id) return;
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      if (data.ok && data.ncryptsec) {
        resolve(data.ncryptsec);
      } else {
        reject(new Error(data.error || "Encryption failed"));
      }
    };
    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message || "Encryption worker error"));
    };
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    try {
      worker.postMessage({ id, secretKey, password });
    } catch (err) {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(err);
    }
  });
}

export async function encryptSecretKeyAsync(secretKey: Uint8Array, password: string): Promise<string> {
  const worker = getEncryptWorker();
  if (!worker) return encryptInline(secretKey, password);
  try {
    return await encryptViaWorker(worker, secretKey, password);
  } catch (err) {
    console.warn("[local-account] Encryption worker failed, falling back to inline.", err);
    encryptWorkerUnsupported = true;
    disposeWorker();
    return encryptInline(secretKey, password);
  }
}

export function decryptStored(ncryptsec: string, password: string): Uint8Array {
  return nip49.decrypt(ncryptsec, password);
}

export function parseImportedKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Empty key");
  if (trimmed.startsWith("nsec1")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Not a valid nsec");
    return decoded.data as Uint8Array;
  }
  if (trimmed.startsWith("ncryptsec1")) {
    throw new Error("This is an encrypted key. Provide the passphrase to unlock it.");
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  throw new Error("Unrecognized key format. Use nsec1… or 64-char hex.");
}

export function decryptImportedNcryptsec(ncryptsec: string, password: string): Uint8Array {
  const trimmed = ncryptsec.trim();
  if (!trimmed.startsWith("ncryptsec1")) {
    throw new Error("Not an ncryptsec");
  }
  return nip49.decrypt(trimmed, password);
}

export function pubkeyFromSecret(secretKey: Uint8Array): { pubkey: string; npub: string } {
  const pubkey = getPublicKey(secretKey);
  return { pubkey, npub: nip19.npubEncode(pubkey) };
}

export function loadLocalAccount(): StoredLocalAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLocalAccount;
    if (!parsed?.ncryptsec || !parsed?.pubkey) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Multi-account: every write of the encrypted-blob singleton is mirrored to a
 * per-pubkey namespaced slot so the blob survives while ANOTHER account
 * occupies the singleton (the account switcher restores it on switch-back).
 * The blob is the same NIP-49 ncryptsec record the app always stored — the
 * mirror never introduces new plaintext key material.
 */
function mirrorLocalAccountBlob(account: StoredLocalAccount, json: string): void {
  if (!account?.pubkey) return;
  try { localStorage.setItem(namespacedKey(STORAGE_KEY, account.pubkey), json); } catch {}
}

export function saveLocalAccount(account: StoredLocalAccount): void {
  try {
    const json = JSON.stringify(account);
    localStorage.setItem(STORAGE_KEY, json);
    mirrorLocalAccountBlob(account, json);
  } catch {}
}

/**
 * Persist the account and surface any storage failure (quota exceeded,
 * Safari private mode, etc.) so the caller can react instead of silently
 * losing the write. Used during sign-in flows where a failed save would
 * lock the user out on next unlock.
 */
export function saveLocalAccountStrict(account: StoredLocalAccount): void {
  const json = JSON.stringify(account);
  localStorage.setItem(STORAGE_KEY, json);
  // The singleton write is the critical one; the multi-account mirror is
  // best-effort so a quota failure here can't fail an otherwise-good save.
  mirrorLocalAccountBlob(account, json);
}

export function clearLocalAccount(): void {
  try {
    // Tidy the namespaced mirror ONLY when the blob's pubkey was never
    // registered as an account (an aborted create/import flow). A registered
    // account's mirror must survive — it's what switch-back restores; its
    // removal happens exclusively through the registry's removeAccount.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { pubkey?: string };
        if (parsed?.pubkey && !getRegisteredAccount(parsed.pubkey)) {
          localStorage.removeItem(namespacedKey(STORAGE_KEY, parsed.pubkey));
        }
      } catch {}
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function hasStoredLocalAccount(): boolean {
  return loadLocalAccount() !== null;
}

/**
 * Read the plaintext device secret used by the "stay signed in" path.
 * Returns null when the user has not opted into the persistent path,
 * when storage is unavailable, or when the stored value is malformed.
 */
export function loadLocalSecret(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(LOCAL_SECRET_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith("nsec1")) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== "nsec") return null;
      return decoded.data as Uint8Array;
    }
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLocalSecret(secretKey: Uint8Array): void {
  try {
    const nsec = nip19.nsecEncode(secretKey);
    localStorage.setItem(LOCAL_SECRET_STORAGE_KEY, nsec);
  } catch {}
}

export function clearLocalSecret(): void {
  try { localStorage.removeItem(LOCAL_SECRET_STORAGE_KEY); } catch {}
}

export function hasStoredLocalSecret(): boolean {
  try { return !!localStorage.getItem(LOCAL_SECRET_STORAGE_KEY); } catch { return false; }
}

export function markOnboardingComplete(pubkey: string): void {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(pubkey)) set.push(pubkey);
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(set));
  } catch {}
}

export function isOnboardingComplete(pubkey: string): boolean {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return false;
    const set: string[] = JSON.parse(raw);
    return Array.isArray(set) && set.includes(pubkey);
  } catch {
    return false;
  }
}

const NEW_ACCOUNT_KEY = "relay-outpost-new-account";

/**
 * Mark a pubkey as an account that was *created* inside Relay Outpost (vs an
 * existing key imported via login). Used to scope first-run nudges like the
 * Get Started checklist to genuinely new users — long-held imported keys
 * should never see "share your first post" / "follow 5 people".
 */
export function markNewAccount(pubkey: string): void {
  try {
    const raw = localStorage.getItem(NEW_ACCOUNT_KEY);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(pubkey)) set.push(pubkey);
    localStorage.setItem(NEW_ACCOUNT_KEY, JSON.stringify(set));
  } catch {}
}

export function isNewAccount(pubkey: string): boolean {
  try {
    const raw = localStorage.getItem(NEW_ACCOUNT_KEY);
    if (!raw) return false;
    const set: string[] = JSON.parse(raw);
    return Array.isArray(set) && set.includes(pubkey);
  } catch {
    return false;
  }
}

export interface BackupFileExtras {
  /** Display name the user set (kind 0 metadata "name"/"display_name"). */
  displayName?: string;
  /** NIP-05 verification address, if configured. */
  nip05?: string;
  /** Lightning address (lud16), if configured. */
  lud16?: string;
  /** Relays the user is currently writing to (NIP-65 write set or defaults). */
  relays?: string[];
  /**
   * Raw, unencrypted secret key in `nsec1…` form. When present, the file
   * includes a clearly-labeled RAW SECRET KEY section AND the surrounding
   * copy switches to a "this file is now sensitive" tone, because the
   * passphrase no longer protects it.
   */
  nsec?: string;
}

export function downloadBackupFile(
  account: StoredLocalAccount,
  extrasOrDisplayName?: BackupFileExtras | string,
): void {
  // Backwards-compat: a plain string is treated as the displayName.
  const extras: BackupFileExtras =
    typeof extrasOrDisplayName === "string"
      ? { displayName: extrasOrDisplayName }
      : (extrasOrDisplayName ?? {});

  const accountCreated = new Date(account.createdAt);
  const backupGenerated = new Date();
  const dateStamp = backupGenerated.toISOString().slice(0, 10); // YYYY-MM-DD

  const relayList = (extras.relays && extras.relays.length > 0)
    ? extras.relays
    : null;
  const includesRawNsec = Boolean(extras.nsec);

  const lines: string[] = [
    includesRawNsec
      ? "RELAY OUTPOST — KEY BACKUP (CONTAINS RAW SECRET KEY)"
      : "RELAY OUTPOST — ENCRYPTED KEY BACKUP",
    "=====================================",
    "",
  ];

  if (includesRawNsec) {
    lines.push(
      "HEADS UP — THIS FILE IS SENSITIVE",
      "---------------------------------",
      "You asked Relay Outpost to include your raw secret key (nsec) in",
      "this backup. That means the passphrase no longer protects this file",
      "on its own — anyone who opens it can take over the account.",
      "",
      "Treat this file like cash: keep it on paper, on a USB drive in a",
      "drawer, or as an attachment inside an encrypted password manager.",
      "Do not email it to yourself, drop it in a shared cloud folder, or",
      "leave it in your Downloads folder.",
      "",
    );
  }

  lines.push(
    "WHO THIS IS",
    "-----------",
    `Display name:      ${extras.displayName || "(no name set)"}`,
    `Public key (npub): ${account.npub}`,
  );
  if (extras.nip05) lines.push(`NIP-05 address:    ${extras.nip05}`);
  if (extras.lud16) lines.push(`Lightning address: ${extras.lud16}`);
  lines.push(`Account created:   ${accountCreated.toISOString()}`);
  lines.push(`Backup generated:  ${backupGenerated.toISOString()}`);
  lines.push("");

  lines.push(
    "ENCRYPTED SECRET KEY (NIP-49)",
    "-----------------------------",
    "Without your passphrase, the string below is useless to anyone.",
    "",
    account.ncryptsec,
    "",
  );

  if (extras.nsec) {
    lines.push(
      "RAW SECRET KEY (nsec)",
      "---------------------",
      "This is the unwrapped version of the same key. No passphrase needed",
      "to use it — anyone holding the string below controls the account.",
      "It is here so you can paste it into Nostr clients or signers that",
      "don't yet support NIP-49 encrypted keys.",
      "",
      extras.nsec,
      "",
    );
  }

  if (relayList) {
    lines.push(
      "YOUR RELAYS",
      "-----------",
      "These are the servers your posts and profile were being written to",
      "when this backup was generated. Start a fresh client with these",
      "relays — if some of your posts seem missing, add any custom relays",
      "you set up later as well.",
      "",
      ...relayList.map((r) => `  - ${r}`),
      "",
    );
  }

  lines.push(
    "HOW TO RESTORE",
    "--------------",
    "  1. Open Relay Outpost (or any NIP-49 compatible client — e.g.",
    "     Amethyst, Damus, Coracle, nostrudel.ninja).",
    "  2. Choose Sign In → Use existing key.",
    "  3. Paste the ncryptsec1… string from above.",
    "  4. Enter your passphrase.",
    "",
    "IF YOU LOSE YOUR PASSPHRASE",
    "---------------------------",
    "Read this carefully: there is no password reset, no recovery email,",
    "no support team that can let you back in. Nostr accounts are",
    "non-custodial — you (and only you) hold the keys.",
    "",
    ...(includesRawNsec
      ? [
          "Because this file includes your raw secret key (nsec), losing the",
          "passphrase does NOT lock you out — you can still recover the",
          "account by importing the nsec string above into any Nostr client.",
          "Treat that as the safety net, not the main door: keep using the",
          "passphrase + encrypted key for day-to-day sign-ins, and store this",
          "file somewhere only you can reach.",
        ]
      : [
          "Without the passphrase, this file is just noise, and the account",
          "is gone. If you lose it, your only option is to create a fresh",
          "account and start over. So: store the passphrase somewhere you",
          "will actually find it again — a password manager is ideal.",
        ]),
    "",
    "PASSPHRASE HYGIENE",
    "------------------",
    "  - Save it in a password manager (1Password, Bitwarden, Apple",
    "    Keychain, etc.) — separate from this file.",
    "  - Never type it on a public or shared computer.",
    "  - Don't reuse a password from another website.",
    "  - This file and the passphrase should NEVER live in the same place.",
    "    If they do, the encryption no longer protects you.",
    "",
    "STORAGE TIPS",
    "------------",
    ...(includesRawNsec
      ? [
          "  - Print a paper copy and store it somewhere physical (a drawer,",
          "    a safe). Paper doesn't get ransomwared.",
          "  - If you keep a digital copy, put it inside an encrypted",
          "    container — a password manager attachment, an encrypted disk",
          "    image, a hardware-encrypted USB drive. Plain cloud storage",
          "    is NOT safe for this file because it contains the raw key.",
          "  - Two copies in two different places beats one perfect copy.",
        ]
      : [
          "  - Print a paper copy and store it somewhere physical (a drawer,",
          "    a safe). Paper doesn't get ransomwared.",
          "  - Keep a digital copy in cloud storage you trust (the file is",
          "    encrypted — that's the point).",
          "  - Two copies in two different places beats one perfect copy.",
        ]),
    "",
    "Anything not in this file (your wallet connection, custom relays you",
    "added later, etc.) is not backed up here. Re-link those after",
    "restoring.",
  );

  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeNpub = account.npub.slice(0, 12);
  a.download = `relay-outpost-keybackup-${safeNpub}-${dateStamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function tryStoreInPasswordManager(account: StoredLocalAccount, displayName?: string): Promise<boolean> {
  try {
    const w = window as unknown as { PasswordCredential?: new (init: { id: string; password: string; name?: string }) => unknown };
    if (!w.PasswordCredential || !navigator.credentials?.store) return false;
    const cred = new w.PasswordCredential({
      id: `${displayName || "Relay Outpost"} (${account.npub.slice(0, 12)}…)`,
      password: account.ncryptsec,
      name: displayName || "Relay Outpost",
    });
    await navigator.credentials.store(cred as Credential);
    return true;
  } catch {
    return false;
  }
}

/**
 * Store the user's *passphrase* in the OS / browser password manager,
 * keyed by their npub. On a return visit (same device or another device
 * synced with iCloud Keychain / Google Password Manager), the passphrase
 * field can be auto-filled — they only need to bring the encrypted key.
 */
export async function tryStorePassphraseInPasswordManager(npub: string, passphrase: string, displayName?: string): Promise<boolean> {
  try {
    const w = window as unknown as { PasswordCredential?: new (init: { id: string; password: string; name?: string }) => unknown };
    if (!w.PasswordCredential || !navigator.credentials?.store) return false;
    const cred = new w.PasswordCredential({
      id: npub,
      password: passphrase,
      name: displayName ? `${displayName} — Relay Outpost` : "Relay Outpost",
    });
    await navigator.credentials.store(cred as Credential);
    return true;
  } catch {
    return false;
  }
}

/**
 * Outcome of an attempt to hand credentials off to the OS / browser password
 * manager.
 *
 *  - `credential-api`: the Credential Management API's `store()` resolved.
 *    Chromium-based browsers will have shown a native save prompt and the
 *    key material never left this tab.
 *  - `fallback`: the browser does not expose a no-network save path (Safari,
 *    Firefox, older browsers). Caller must copy to clipboard and tell the
 *    user where to paste.
 *
 * We intentionally do NOT ship a hidden-form-submission fallback. That
 * pattern sends the secret over the network to our origin (even when
 * targeted at a hidden iframe) and would contradict our "nothing leaves
 * this device" promise.
 */
export type SaveCredentialResult = "credential-api" | "fallback";

export interface SaveCredentialOptions {
  /** Username field — always the user's npub so entries are keyed cleanly. */
  username: string;
  /** Password field — the nsec for raw saves, or the ncryptsec for the encrypted save. */
  password: string;
  /** Human-readable label the password manager will show in its list. */
  label?: string;
}

/**
 * Offer the user's credential to the browser / OS password manager via the
 * Credential Management API. No network request is ever made; on browsers
 * without `PasswordCredential` support we return `"fallback"` so the caller
 * can copy to clipboard and instruct the user. We deliberately avoid the
 * hidden-form-submission trick because it would POST the secret to our
 * origin (reaching server logs / CDNs), which we don't want.
 */
export async function saveCredentialToPasswordManager(opts: SaveCredentialOptions): Promise<SaveCredentialResult> {
  const { username, password, label } = opts;
  try {
    const w = window as unknown as {
      PasswordCredential?: new (init: { id: string; password: string; name?: string }) => unknown;
    };
    if (w.PasswordCredential && navigator.credentials?.store) {
      const cred = new w.PasswordCredential({ id: username, password, name: label });
      await navigator.credentials.store(cred as Credential);
      return "credential-api";
    }
  } catch (err) {
    console.warn("[local-account] Credential API save failed:", err);
  }
  return "fallback";
}

/**
 * Translate cryptic crypto / parsing errors into plain English the user can act on.
 */
export function describeKeyError(err: unknown, context: "parse" | "decrypt" = "parse"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();
  if (context === "decrypt") {
    if (lower.includes("invalid tag") || lower.includes("decrypt") || lower.includes("malformed") || lower.includes("authentication")) {
      return "That passphrase doesn't match this encrypted key. Double-check both — the passphrase is case-sensitive, and make sure the ncryptsec1… string was copied in full from your backup file.";
    }
    if (lower.includes("ncryptsec")) return raw;
    return "Couldn't decrypt this key. Verify the ncryptsec1… string is complete and the passphrase is correct.";
  }
  if (lower.includes("unrecognized") || lower.includes("not a valid") || lower.includes("not an ncryptsec")) {
    return "That doesn't look like a Nostr key. Paste an nsec1…, ncryptsec1…, or 64-character hex secret.";
  }
  if (lower.includes("empty")) return "Paste your secret key first.";
  return raw || "Couldn't read that key.";
}
