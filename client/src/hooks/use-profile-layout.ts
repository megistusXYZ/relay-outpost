import { useSyncExternalStore } from "react";

/**
 * Desktop profile-layout preference (VIEWER-controlled skin).
 * "classic" = the X-style layout (default). "identity" = the living-identity
 * layout (two-column: left rail + portfolio main). This is a local rendering
 * preference over each profile's existing data — nothing is published.
 *
 * The preference is stored regardless of viewport; the consumer only applies
 * the "identity" layout on DESKTOP widths (mobile always stays classic). Mirrors
 * the feed-style hook (localStorage + change event + NIP-78 apply signal).
 */
export type ProfileLayout = "classic" | "identity";

const STORAGE_KEY = "relay-outpost-profile-layout";
const CHANGE_EVENT = "profile-layout-changed";

export function readProfileLayout(): ProfileLayout {
  // Default is IDENTITY on desktop (the consumer gates to desktop widths; mobile
  // always renders classic). Only an explicit "classic" opt-out falls back.
  try {
    return localStorage.getItem(STORAGE_KEY) === "classic" ? "classic" : "identity";
  } catch {
    return "identity";
  }
}

/** Persist the choice and notify every mounted profile to re-render live. */
export function setProfileLayout(layout: ProfileLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // cross-tab
  window.addEventListener("nip78-settings-applied", onChange); // remote-settings apply
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("nip78-settings-applied", onChange);
  };
}

/** Read the current profile layout, re-rendering on change (same tab or cross-tab). */
export function useProfileLayout(): ProfileLayout {
  return useSyncExternalStore(subscribe, readProfileLayout, () => "identity");
}
