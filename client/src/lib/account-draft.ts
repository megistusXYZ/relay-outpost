import { trackSignupEvent } from "./signup-telemetry";

// Short-lived sessionStorage backing for an in-progress signup so the user
// doesn't lose their work if the page gets reloaded mid-flow (notably on
// mobile where the OS evicts the tab when the file picker opens or memory
// pressure rises). Cleared the moment the user finishes signup or backs out.

const DRAFT_KEY = "relay-outpost-signup-draft";
// Eager-purge drafts older than this on load. Signup is a short flow and
// nobody legitimately resumes a 24h-old draft; bounding lifetime limits how
// long a sessionStorage'd secret could linger if the user wandered off.
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SignupDraft {
  step?: 1 | 2 | 3 | 4;
  displayName?: string;
  username?: string;
  bio?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  website?: string;
  rss?: string;
  lud16?: string;
  // Pre-passphrase keypair generated to sign NIP-98 upload auth headers.
  // We persist it so reloads don't change the user's npub mid-flow and
  // already-uploaded media remain owned by the same key. Cleared on
  // successful finish or explicit cancel. Note: only the raw secret key
  // is persisted (`secretKeyHex`); the `nsec` bech32 form is recomputed
  // on hydrate to avoid duplicating secret material in storage.
  account?: {
    secretKeyHex: string;
    pubkey: string;
    npub: string;
  };
  savedAt?: number;
}

function isStorageAvailable(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadSignupDraft(): SignupDraft | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      // Stale beyond the max-age — proactively wipe so any persisted secret
      // doesn't outlive the bound.
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      return null;
    }
    return parsed as SignupDraft;
  } catch {
    return null;
  }
}

export function saveSignupDraft(draft: SignupDraft): void {
  if (!isStorageAvailable()) return;
  try {
    // Don't persist an empty draft — it would fool the resume-detection
    // path into thinking the user had work in flight on the next mount,
    // which would in turn pollute the resumed-vs-fresh telemetry funnel.
    // If a previous (now-empty) draft is sitting in storage, eagerly
    // clear it so we don't keep serving a stale "Resume signup" hint.
    if (!draftHasResumableContent(draft)) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      return;
    }
    const payload = JSON.stringify({ ...draft, savedAt: Date.now() });
    sessionStorage.setItem(DRAFT_KEY, payload);
    // Fire `draft_started` the first time a non-empty draft hits storage in
    // this page load. Used by the resume-flow telemetry to measure how many
    // signups the resume mechanism is even eligible to catch.
    trackSignupEvent("draft_started");
  } catch {
    // sessionStorage can throw in private browsing or when full — silent
    // failure is fine, the user just won't get resume-on-reload.
  }
}

export function clearSignupDraft(): void {
  if (!isStorageAvailable()) return;
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

// Fields whose presence counts as "the user has work to resume". Kept in
// sync with what `CreateAccountFlow` persists so the resume chip and the
// stale-chunk-recovery suppression activate for any non-empty draft, not
// just the most obvious profile fields.
type DraftTextField =
  | "displayName" | "username" | "bio" | "picture" | "banner"
  | "nip05" | "website" | "rss" | "lud16";
const DRAFT_TEXT_FIELDS: readonly DraftTextField[] = [
  "displayName", "username", "bio", "picture", "banner",
  "nip05", "website", "rss", "lud16",
];

export function hasSignupDraft(): boolean {
  const draft = loadSignupDraft();
  if (!draft) return false;
  return draftHasResumableContent(draft);
}

export function draftHasResumableContent(draft: SignupDraft): boolean {
  for (const f of DRAFT_TEXT_FIELDS) {
    const v = draft[f];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  if (draft.account?.secretKeyHex) return true;
  return false;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    // Reject non-hex input outright instead of silently coercing NaN -> 0,
    // which would yield a corrupted secret key on hydrate.
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
