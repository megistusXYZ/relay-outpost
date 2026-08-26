import { useCallback, useSyncExternalStore } from "react";

// Accessibility contrast level. "normal" is the default (theme already tuned to
// pass WCAG AA); "high"/"maximum" apply progressively stronger token overrides
// (see :root[data-contrast=...] blocks in index.css) for users who need it.
export type ContrastLevel = "normal" | "high" | "maximum";

const STORAGE_KEY = "relay-outpost-contrast-level";
const LEVELS: ContrastLevel[] = ["normal", "high", "maximum"];

function getInitialLevel(): ContrastLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LEVELS as string[]).includes(stored)) return stored as ContrastLevel;
  } catch {}
  return "normal";
}

let globalLevel: ContrastLevel = getInitialLevel();
const listeners = new Set<() => void>();

function getSnapshot(): ContrastLevel {
  return globalLevel;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function applyContrast(level: ContrastLevel, persist = true) {
  globalLevel = level;
  const root = document.documentElement;
  if (level === "normal") {
    root.removeAttribute("data-contrast");
  } else {
    root.setAttribute("data-contrast", level);
  }
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, level);
    } catch {}
  }
  listeners.forEach((cb) => cb());
}

// Apply on module load so the attribute is set before first paint where possible.
applyContrast(globalLevel, false);

if (typeof window !== "undefined") {
  // Mirror remote (NIP-78) changes pushed from other devices.
  window.addEventListener("nip78-contrast-applied", ((e: CustomEvent<string>) => {
    const lvl = e.detail;
    if ((LEVELS as string[]).includes(lvl)) applyContrast(lvl as ContrastLevel, false);
  }) as EventListener);
}

/**
 * Imperative setter for non-component callers (use-theme's preset reset).
 * Persists like the hook's setLevel does.
 */
export function setContrastLevel(level: ContrastLevel): void {
  applyContrast(level);
}

export function useContrast() {
  const level = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setLevel = useCallback((l: ContrastLevel) => {
    applyContrast(l);
  }, []);

  return { level, setLevel, levels: LEVELS };
}
