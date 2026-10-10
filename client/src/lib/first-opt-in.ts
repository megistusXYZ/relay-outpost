/**
 * The first time an account opens the wider network (owner, 2026-10-10):
 * Trust & safety goes to Careful, sensitive posts stay hidden, and media
 * from outside your space stays blurred — once per account. They chose the
 * network, not the worst of it; loosening later is theirs to do and is
 * never undone by a second flip. The marker rides the synced settings so a
 * second device doesn't tighten again (lib/nip78-settings.ts).
 */
import { applyTrustChoice } from "./trust-choice";
import { writeBlurOutside } from "./outside-space-blur";

export const FIRST_OPT_IN_PREFIX = "ro_wider_first_on:";

export function firstOptInKey(pubkey: string): string {
  return `${FIRST_OPT_IN_PREFIX}${pubkey}`;
}

export function hasFirstOptIn(pubkey: string): boolean {
  try { return localStorage.getItem(firstOptInKey(pubkey)) === "1"; } catch { return false; }
}

export function markFirstOptIn(pubkey: string): void {
  try { localStorage.setItem(firstOptInKey(pubkey), "1"); } catch {}
}

/** Tighten once. Returns true when it did (the caller says so in plain words). */
export function applyFirstOptIn(pubkey: string): boolean {
  if (hasFirstOptIn(pubkey)) return false;
  applyTrustChoice("careful");
  try { localStorage.removeItem("sensitiveContent"); } catch {} // the default: hidden until tapped
  writeBlurOutside(true);
  markFirstOptIn(pubkey);
  return true;
}
