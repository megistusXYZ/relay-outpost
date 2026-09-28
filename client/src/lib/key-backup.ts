/**
 * Reminding people to back up their key. The backup is the only thing that
 * moves an account between devices and browsers (we keep no copy), so a key
 * that lives only in this browser is one cleared cache away from being lost.
 */

/** A day: long enough that sign-up isn't followed by a nag, short enough to matter. */
const NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface BackupFacts {
  /** The secret key lives in this browser (a local account), not in a signer app, extension or bunker. */
  keyInThisBrowser: boolean;
  /** When the account was created here; undefined for accounts older than this record. */
  createdAt: number | undefined;
  /** When a backup was last made (file, password manager, or copied key). */
  backedUpAt: number | undefined;
  /** "Later" pushes the nudge back until this time. */
  snoozedUntil: number | undefined;
}

/**
 * What to show: nothing, the Account-page row, or the Account row plus a nudge.
 */
export function backupNudge(facts: BackupFacts, now: number): "none" | "row" | "nudge" {
  if (!facts.keyInThisBrowser || facts.backedUpAt !== undefined) return "none";
  if (facts.snoozedUntil !== undefined && now < facts.snoozedUntil) return "row";
  if (facts.createdAt !== undefined && now - facts.createdAt >= NUDGE_AFTER_MS) return "nudge";
  return "row";
}

// ── What this device remembers (per account, device-only) ───────────────────
const KEY = "ro_key_backup";
/** "Later" means later: three days before the nudge comes back. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

type Record = { createdAt?: number; backedUpAt?: number; snoozedUntil?: number };

function readAll(): { [pubkey: string]: Record } {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? JSON.parse(raw) : {};
    return all && typeof all === "object" ? all : {};
  } catch { return {}; }
}

function update(pubkey: string, patch: Record): void {
  try {
    const all = readAll();
    all[pubkey] = { ...all[pubkey], ...patch };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

/** Sign-up: remember when this account was made, so the nudge waits a day. */
export function markAccountCreated(pubkey: string, now: number): void {
  update(pubkey, { createdAt: now });
}

/** A backup was made: a file downloaded, saved to a password manager, or the key copied. */
export function markBackedUp(pubkey: string, now: number): void {
  update(pubkey, { backedUpAt: now });
}

export function snoozeBackupNudge(pubkey: string, now: number): void {
  update(pubkey, { snoozedUntil: now + SNOOZE_MS });
}

/** The facts backupNudge decides on, for this account. */
export function backupFacts(pubkey: string, keyInThisBrowser: boolean): BackupFacts {
  const r = readAll()[pubkey] ?? {};
  return { keyInThisBrowser, createdAt: r.createdAt, backedUpAt: r.backedUpAt, snoozedUntil: r.snoozedUntil };
}
