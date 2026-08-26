/**
 * Discover feed preferences + the `ro_discover_v2` kill-switch.
 *
 * v2 gates the engine (curated relay sampling + algorithmic mix + safe-floor
 * language/kind filtering) that powers the "For You" feed. It defaults ON
 * (decided after device QA): `isDiscoverV2` treats unset as on, and the
 * Settings toggle is the kill-switch (stores "0" to opt out). When off, the
 * feed behaves as before v2 (Primal + chronological).
 */
import { useSyncExternalStore } from "react";

const V2_KEY = "ro_discover_v2";
const SORT_KEY = "ro_discover_sort";
export const DISCOVER_PREFS_CHANGED = "discover-prefs-changed";

export type DiscoverSort = "mix" | "latest";

export function isDiscoverV2(): boolean {
  try {
    return localStorage.getItem(V2_KEY) !== "0"; // default ON (unset = on); user opts out with "0"
  } catch {
    return true;
  }
}

export function setDiscoverV2(on: boolean): void {
  try {
    localStorage.setItem(V2_KEY, on ? "1" : "0");
  } catch {}
  emit();
}

export function getDiscoverSort(): DiscoverSort {
  try {
    return localStorage.getItem(SORT_KEY) === "latest" ? "latest" : "mix";
  } catch {
    return "mix";
  }
}

export function setDiscoverSort(sort: DiscoverSort): void {
  try {
    localStorage.setItem(SORT_KEY, sort);
  } catch {}
  emit();
}

function emit(): void {
  try {
    window.dispatchEvent(new Event(DISCOVER_PREFS_CHANGED));
  } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(DISCOVER_PREFS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISCOVER_PREFS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read of the Discover prefs (re-renders on change, same or cross-tab). */
export function useDiscoverPrefs(): { v2: boolean; sort: DiscoverSort } {
  const snap = useSyncExternalStore(
    subscribe,
    () => `${isDiscoverV2() ? 1 : 0}:${getDiscoverSort()}`,
    () => "0:mix",
  );
  const [v2, sort] = snap.split(":");
  return { v2: v2 === "1", sort: (sort as DiscoverSort) || "mix" };
}
