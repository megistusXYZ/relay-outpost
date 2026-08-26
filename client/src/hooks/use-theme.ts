import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { setContrastLevel } from "@/hooks/use-contrast";
import { setPerfMode } from "@/hooks/use-perf-mode";

export type Theme = "dark" | "light" | "black";

/**
 * The toggle's cycle, descending brightness: light → dark → black → light.
 * Pure and exported so the order is pinned by test — every toggle surface
 * (OrbitMenu, Account, stories rail) calls toggleTheme() and inherits it.
 */
export function nextTheme(t: Theme): Theme {
  return t === "light" ? "dark" : t === "dark" ? "black" : "light";
}

const STORAGE_KEY = "relay-outpost-theme";
// Set once the user picks a theme ON THIS DEVICE. Device-local (not synced), so
// the NIP-78 settings sync won't yank the theme back to a stale value on load.
const EXPLICIT_KEY = "relay-outpost-theme-explicit";

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light") {
      // A stored "light" is a deliberate prior choice (dark is the default), so
      // treat existing light-mode users as explicit — protects them from the
      // sync flipping them to dark on load without having to re-toggle.
      try { if (!localStorage.getItem(EXPLICIT_KEY)) localStorage.setItem(EXPLICIT_KEY, "1"); } catch {}
      return "light";
    }
    if (stored === "black") return "black";
  } catch {}
  return "dark";
}

let globalTheme: Theme = getInitialTheme();
const listeners = new Set<() => void>();

function getSnapshot(): Theme {
  return globalTheme;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function applyTheme(t: Theme) {
  globalTheme = t;
  const root = document.documentElement;
  // Black KEEPS the .dark class (it is dark, with the lights out — every
  // dark: style and glass effect must keep applying) and adds the
  // data-theme attribute that index.css's surfaces-only overlay keys on.
  if (t === "dark" || t === "black") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  if (t === "black") {
    root.setAttribute("data-theme", "black");
  } else {
    root.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "black" ? "#050408" : t === "dark" ? "#09090b" : "#ffffff");
  listeners.forEach((cb) => cb());
}

applyTheme(globalTheme);

window.addEventListener("nip78-theme-applied", ((e: CustomEvent<string>) => {
  const t = e.detail;
  if (t !== "dark" && t !== "light" && t !== "black") return;
  // If the user has explicitly chosen a theme on this device, don't let the
  // synced settings override it (NIP-78 shares one timestamp across all
  // settings, so an unrelated change elsewhere could otherwise flip the theme
  // on load). A fresh device with no local choice still adopts the synced theme.
  try { if (localStorage.getItem(EXPLICIT_KEY) === "1") return; } catch {}
  applyTheme(t);
}) as EventListener);

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Picking a theme from the toggles is a PRESET, not just a palette swap
  // (owner call, 2026-08-18): Performance returns to Auto and Contrast to
  // Normal so every theme lands looking exactly as designed. Only EXPLICIT
  // user selection resets them — the NIP-78 sync path (applyTheme via the
  // event listener above) must never clobber a device-local a11y choice.
  const presetReset = () => {
    try { setContrastLevel("normal"); } catch {}
    try { setPerfMode("auto"); } catch {}
  };

  const setTheme = useCallback((t: Theme) => {
    try { localStorage.setItem(EXPLICIT_KEY, "1"); } catch {}
    presetReset();
    applyTheme(t);
  }, []);

  const toggleTheme = useCallback(() => {
    try { localStorage.setItem(EXPLICIT_KEY, "1"); } catch {}
    presetReset();
    applyTheme(nextTheme(globalTheme));
  }, []);

  // Black IS dark for every consumer that asks "dark-ish?" (icon tints, star
  // layers, contrast math) — only exact-theme consumers branch on `theme`.
  return { theme, setTheme, toggleTheme, isDark: theme !== "light" };
}
