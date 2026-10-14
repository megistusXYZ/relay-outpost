/**
 * The adult confirmation before the wider network (owner, 2026-10-13).
 *
 * Turning the wider network on is a decision for adults: anyone can post
 * anything there and nobody checks it all first. The switch asks once per
 * account, in plain words — 18 or older, and I understand — and remembers
 * the answer with the moment it was given, so it is asked once, never on
 * turning off, and a second device doesn't ask again (the record rides the
 * synced settings, lib/nip78-settings.ts).
 *
 * This is the record, not the words: the words live in the sheet.
 */

export const CONSENT_PREFIX = "ro_wider_consent:";

export function consentKey(pubkey: string): string {
  return `${CONSENT_PREFIX}${pubkey}`;
}

/** When this account confirmed, as an ISO moment; null when it never has (or the record is damaged). */
export function adultConsentAt(pubkey: string): string | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(consentKey(pubkey)); } catch { return null; }
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

export function hasAdultConsent(pubkey: string): boolean {
  return adultConsentAt(pubkey) !== null;
}

/** The person confirmed, now (or at `at`). */
export function recordAdultConsent(pubkey: string, at: Date = new Date()): void {
  try { localStorage.setItem(consentKey(pubkey), at.toISOString()); } catch {}
}

/** Ask only when turning ON, only with an account, only when never answered. */
export function needsAdultConfirm(pubkey: string | null | undefined, turningOn: boolean): boolean {
  if (!pubkey || !turningOn) return false;
  return !hasAdultConsent(pubkey);
}
