/**
 * "Show technical details" (owner, 2026-10-04). The console speaks plainly:
 * kinds of posts by name, people by name, "the relay said no" in words. With
 * this on — off by default, remembered on this device — it also shows the
 * protocol: kind numbers, keys (npub/hex), method names and NIP numbers.
 */
import { useSyncExternalStore } from "react";

const KEY = "ro_technical_details";
export const TECHNICAL_DETAILS_EVENT = "relay-outpost:technical-details";

export function isTechnicalDetails(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setTechnicalDetails(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* this visit only */ }
  try { window.dispatchEvent(new CustomEvent(TECHNICAL_DETAILS_EVENT)); } catch { /* no window */ }
}

function subscribe(onChange: () => void) {
  window.addEventListener(TECHNICAL_DETAILS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(TECHNICAL_DETAILS_EVENT, onChange); window.removeEventListener("storage", onChange); };
}

/** The setting, live: flipping it updates every screen showing it. */
export function useTechnicalDetails(): boolean {
  return useSyncExternalStore(subscribe, isTechnicalDetails, () => false);
}
