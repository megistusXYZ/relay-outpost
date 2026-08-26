/**
 * Concord feature flag. DEFAULT ON — encrypted outposts are on unless the user
 * explicitly flips the Settings toggle OFF (a kill-switch, same shape as the
 * Discover flag). Semantics: unset or "1" → on; only an explicit "0" → off.
 * This is what lets an invited user (esp. a brand-new account) land straight in
 * the chat instead of a "not enabled on this device" wall.
 */
import { useSyncExternalStore } from "react";

const KEY = "ro_concord_enabled";
const CHANGED = "concord-prefs-changed";

export function isConcordEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setConcordEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

/** Force the flag on (used when accepting an invite — you can't gate someone
 *  out of a link they were handed). No-op if they haven't explicitly killed it. */
export function forceEnableConcord(): void {
  try { if (localStorage.getItem(KEY) === "0") localStorage.setItem(KEY, "1"); } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read of the Concord flag. */
export function useConcordEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => (isConcordEnabled() ? "1" : "0"), () => "0") === "1";
}
