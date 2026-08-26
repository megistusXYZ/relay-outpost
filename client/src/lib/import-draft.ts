// Short-lived sessionStorage backing for an in-progress key import so the
// user doesn't lose their work if the page gets reloaded mid-flow (notably
// on mobile, where the OS evicts the tab during keyboard / focus changes).
// Cleared the moment the user finishes import or backs out.
//
// Security note: the user-typed key string and passphrases are already in
// component state (JS memory) during the import flow. sessionStorage is
// scoped to this single tab and is wiped when the tab closes — it does
// not widen the exposure beyond what's already in memory, but it does
// let us survive a single reload. Drafts are also auto-purged after
// DRAFT_MAX_AGE_MS so a wandering user doesn't leave a key sitting
// indefinitely.

const DRAFT_KEY = "relay-outpost-import-draft";
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ImportStep = "key" | "passphrase" | "passkey";

export interface ImportDraft {
  step?: ImportStep;
  // The exact string the user typed: nsec1…, ncryptsec1…, or 64-char hex.
  // We do NOT persist the derived raw secret bytes — re-derivation on
  // hydrate is cheap and avoids storing redundant secret material.
  keyInput?: string;
  // Passphrase that protects an ncryptsec1 paste. Only relevant on the
  // "key" step; cleared on transition past it.
  importPassword?: string;
  // The new device passphrase being chosen on the "passphrase" step.
  // Cleared once login is finalised.
  newPassword?: string;
  confirmPassword?: string;
  // Cached npub so we can show the password-manager hint and the passkey
  // step copy without having to re-derive from the secret on hydrate.
  decryptedNpub?: string;
  savedAt?: number;
}

function isStorageAvailable(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

export function loadImportDraft(): ImportDraft | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      return null;
    }
    return parsed as ImportDraft;
  } catch {
    return null;
  }
}

export function saveImportDraft(draft: ImportDraft): void {
  if (!isStorageAvailable()) return;
  try {
    if (!draftHasResumableContent(draft)) {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      return;
    }
    const payload = JSON.stringify({ ...draft, savedAt: Date.now() });
    sessionStorage.setItem(DRAFT_KEY, payload);
  } catch {
    // sessionStorage can throw in private browsing or when full — silent
    // failure is fine, the user just loses resume-on-reload.
  }
}

export function clearImportDraft(): void {
  if (!isStorageAvailable()) return;
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

function draftHasResumableContent(draft: ImportDraft): boolean {
  if (typeof draft.keyInput === "string" && draft.keyInput.trim().length > 0) return true;
  if (typeof draft.newPassword === "string" && draft.newPassword.length > 0) return true;
  if (typeof draft.confirmPassword === "string" && draft.confirmPassword.length > 0) return true;
  return false;
}
