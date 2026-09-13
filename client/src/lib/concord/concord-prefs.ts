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

/**
 * Encrypted calls (Concord CORD-07), DEFAULT OFF while they're being proven:
 * only an explicit "1" shows the Call button and call bar. Stored on this
 * device only, never in the NIP-78 synced settings, because a synced setting
 * publishes an event on every change.
 */
const CALLS_KEY = "ro_concord_calls";

export function isConcordCallsEnabled(): boolean {
  try { return localStorage.getItem(CALLS_KEY) === "1"; } catch { return false; }
}

export function setConcordCallsEnabled(on: boolean): void {
  try { localStorage.setItem(CALLS_KEY, on ? "1" : "0"); } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

/** Reactive read of the calls switch. */
export function useConcordCallsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => (isConcordCallsEnabled() ? "1" : "0"), () => "0") === "1";
}
