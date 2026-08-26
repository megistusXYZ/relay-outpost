/**
 * Desktop primary-chrome preference + the `ro_classic_sidebar` escape hatch.
 *
 * The desktop Stories rail (a slim icon-only ring rail that brings the mobile
 * OrbitMenu language to desktop) is the DEFAULT desktop chrome. Users who prefer
 * the original labeled sidebar tree flip "Classic sidebar" on — a kill-switch in
 * the Concord/Discover mould: unset = new rail, `"1"` = classic sidebar.
 *
 * Desktop-only: the setting has no effect on mobile (OrbitMenu overlay +
 * MobileFooter are untouched); callers gate on the viewport themselves.
 */
import { useSyncExternalStore } from "react";

const CLASSIC_KEY = "ro_classic_sidebar";
export const DESKTOP_CHROME_CHANGED = "desktop-chrome-changed";

/** True when the user has opted back into the original labeled sidebar. */
export function isClassicSidebar(): boolean {
  try {
    return localStorage.getItem(CLASSIC_KEY) === "1"; // default OFF (unset = new rail)
  } catch {
    return false;
  }
}

export function setClassicSidebar(on: boolean): void {
  try {
    localStorage.setItem(CLASSIC_KEY, on ? "1" : "0");
  } catch {}
  try {
    window.dispatchEvent(new Event(DESKTOP_CHROME_CHANGED));
  } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(DESKTOP_CHROME_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DESKTOP_CHROME_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read (re-renders on change, same tab or cross-tab). */
export function useClassicSidebar(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (isClassicSidebar() ? "1" : "0"),
    () => "0",
  ) === "1";
}
