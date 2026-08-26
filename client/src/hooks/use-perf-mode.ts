import { useCallback, useSyncExternalStore } from "react";

// Performance / "Lite" mode. Lite mode strips GPU-expensive backdrop blur and
// decorative overlays (see index.css `html[data-perf="lite"]`) so the app scrolls
// smoothly on older / mobile / data-saver devices. The attribute is set pre-paint
// by an inline bootstrap in index.html; this hook keeps it in sync and lets the
// user override the auto-detection.
//
//   "auto" (default) — lite if the device looks low-end (see detectLowEnd)
//   "lite"           — force effects off (fastest)
//   "full"           — force the full frosted-glass aesthetic on
export type PerfMode = "auto" | "lite" | "full";

const STORAGE_KEY = "relay-outpost-perf";

/** Heuristic for "blur will stutter here." Kept in sync with the inline
 *  bootstrap in index.html. */
export function detectLowEnd(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const coarseTouch = n.maxTouchPoints > 0 && window.matchMedia("(pointer: coarse)").matches;
    return Boolean(
      coarseTouch ||
      (n.deviceMemory && n.deviceMemory <= 4) ||
      (n.hardwareConcurrency && n.hardwareConcurrency <= 4) ||
      n.connection?.saveData === true ||
      window.matchMedia("(prefers-reduced-transparency: reduce)").matches
    );
  } catch {
    return false;
  }
}

function getStored(): PerfMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "lite" || v === "full") return v;
  } catch {}
  return "auto";
}

function isLiteActive(mode: PerfMode): boolean {
  if (mode === "lite") return true;
  if (mode === "full") return false;
  return detectLowEnd();
}

let globalMode: PerfMode = getStored();
const listeners = new Set<() => void>();

function apply(mode: PerfMode, persist = true) {
  globalMode = mode;
  const root = document.documentElement;
  if (isLiteActive(mode)) root.setAttribute("data-perf", "lite");
  else root.removeAttribute("data-perf");
  if (persist) {
    try {
      if (mode === "auto") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }
  listeners.forEach((cb) => cb());
}

// Sync the attribute with the resolved mode (the inline bootstrap already set it
// pre-paint; this reconciles any edge cases without a flash).
if (typeof document !== "undefined") apply(globalMode, false);

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): PerfMode {
  return globalMode;
}

/**
 * Imperative setter for non-component callers (use-theme's preset reset).
 * Persists like the hook's setMode does ("auto" clears the stored override).
 */
export function setPerfMode(mode: PerfMode): void {
  apply(mode);
}

export function usePerfMode() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setMode = useCallback((m: PerfMode) => apply(m), []);
  return { mode, setMode, isLite: isLiteActive(mode), autoLite: detectLowEnd() };
}
