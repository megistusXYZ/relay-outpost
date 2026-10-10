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
  /**
   * The account was made in Relay Outpost (lib/local-account isNewAccount).
   * Someone who brought their own key (a pasted nsec, a key file) already has
   * it, so there's nothing to remind them of.
   */
  createdHere: boolean;
  /** When the account was created here; undefined for accounts older than this record. */
  createdAt: number | undefined;
  /**
   * When the key was last saved (file, password manager, or copied as text).
   * Undefined when the mark on record is not a backup for this account: a
   * Touch ID-first account's old mark pointed at an encrypted copy it could
   * never open (see backupFacts).
   */
  backedUpAt: number | undefined;
  /** When "Check it works" last read the saved key back and it opened this account. */
  checkedAt?: number;
  /** "Later" pushes the nudge back until this time. */
  snoozedUntil: number | undefined;
  /** Reminder moments already met (owner, 2026-10-10): each is shown once. */
  dismissed?: BackupMoment[];
}

/**
 * Where the reminder meets them, with the signal and the message together:
 * "community" — they just made one (it now depends on their key);
 * "members" — someone joined it (people are counting on them).
 * The day-after card in Chats is the third moment and keeps its own timer.
 */
export type BackupMoment = "community" | "members";

/**
 * What to show: nothing, the Account-page row, or the Account row plus a nudge.
 */
export function backupNudge(facts: BackupFacts, now: number): "none" | "row" | "nudge" {
  if (!facts.keyInThisBrowser || !facts.createdHere || facts.backedUpAt !== undefined) return "none";
  if (facts.snoozedUntil !== undefined && now < facts.snoozedUntil) return "row";
  if (facts.createdAt !== undefined && now - facts.createdAt >= NUDGE_AFTER_MS) return "nudge";
  return "row";
}

/** The Account row's word: nothing to save here, not saved, saved, or saved and checked. */
export function backupStatus(facts: BackupFacts): "none" | "not-saved" | "saved" | "checked" {
  if (!facts.keyInThisBrowser || !facts.createdHere) return "none";
  if (facts.backedUpAt === undefined) return "not-saved";
  return facts.checkedAt !== undefined ? "checked" : "saved";
}

/** Is this reminder moment due: key not saved, and the moment not met before. */
export function momentDue(facts: BackupFacts, moment: BackupMoment): boolean {
  if (!facts.keyInThisBrowser || !facts.createdHere || facts.backedUpAt !== undefined) return false;
  return !(facts.dismissed ?? []).includes(moment);
}

/**
 * Finish on the sign-up's last step: a saved key, or a deliberate skip. Never a
 * tick in a box — a confirmation everyone expects is one nobody reads.
 */
export function canFinishSignup(s: { saved: boolean; skipped: boolean }): boolean {
  return s.saved || s.skipped;
}

// ── What this device remembers (per account, device-only) ───────────────────
const KEY = "ro_key_backup";
/** "Later" means later: three days before the nudge comes back. */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

type Record = {
  createdAt?: number;
  backedUpAt?: number;
  /** "key": the key itself was saved (file, text, password manager). Older marks have no shape. */
  backedUpWith?: "key";
  checkedAt?: number;
  snoozedUntil?: number;
  dismissed?: BackupMoment[];
};

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

/**
 * The key was saved. `with` says what was saved: "key" is the key itself (the
 * file, the text, the password-manager entry). A mark without a shape is from
 * before the key file existed and may point at an encrypted copy only.
 */
export function markBackedUp(pubkey: string, now: number, with_?: "key"): void {
  update(pubkey, with_ ? { backedUpAt: now, backedUpWith: with_ } : { backedUpAt: now });
}

/** "Check it works" read the saved key back and it opened this account. */
export function markBackupChecked(pubkey: string, now: number): void {
  update(pubkey, { checkedAt: now });
}

/** A reminder moment was met (saved, or closed): it is not shown again. */
export function dismissMoment(pubkey: string, moment: BackupMoment): void {
  const r = readAll()[pubkey] ?? {};
  const dismissed = r.dismissed ?? [];
  if (!dismissed.includes(moment)) update(pubkey, { dismissed: [...dismissed, moment] });
}

export function snoozeBackupNudge(pubkey: string, now: number): void {
  update(pubkey, { snoozedUntil: now + SNOOZE_MS });
}

/**
 * The facts backupNudge decides on, for this account.
 *
 * `passkeyFirst`: the account chose Touch ID / Face ID at sign-up and never
 * saw a password. Before 2026-10-10 its later backup was an encrypted copy
 * under a random password, so an unshaped mark on such an account is a false
 * "backed up" — dropped here, so the reminder returns and a real save fixes it.
 * A password account's old mark stays: that file opened with the password.
 */
export function backupFacts(
  pubkey: string,
  keyInThisBrowser: boolean,
  createdHere: boolean,
  opts: { passkeyFirst?: boolean } = {},
): BackupFacts {
  const r = readAll()[pubkey] ?? {};
  const trusted = r.backedUpWith === "key" || !opts.passkeyFirst;
  return {
    keyInThisBrowser,
    createdHere,
    createdAt: r.createdAt,
    backedUpAt: trusted ? r.backedUpAt : undefined,
    checkedAt: trusted ? r.checkedAt : undefined,
    snoozedUntil: r.snoozedUntil,
    dismissed: r.dismissed,
  };
}
