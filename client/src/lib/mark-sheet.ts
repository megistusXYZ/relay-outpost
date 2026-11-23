/**
 * A sheet that opened out of the Relay mark is on screen (owner, 2026-11-23).
 * While one is, the mark is the sheet's close control, so the footer's own
 * mark is not shown: there is one mark on screen, not two. The sheet holds
 * this while it is mounted, its closing animation included.
 */
import { useSyncExternalStore } from "react";

let open = 0;
const listeners = new Set<() => void>();
const tell = () => { for (const l of listeners) l(); };

/** Call when a mark sheet mounts; the returned function lets go. */
export function holdMarkForSheet(): () => void {
  open++;
  tell();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open = Math.max(0, open - 1);
    tell();
  };
}

export function useMarkInSheet(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => open > 0,
    () => false,
  );
}

/**
 * Is the mark really on screen? A mark that has stepped aside (a chat thread,
 * the keyboard) is still in the page, faded and moved below the screen, and
 * one already carried by an open sheet is hidden: a sheet must not grow out
 * of a spot nobody can see.
 */
export function markIsOnScreen(m: { opacity: number; visibility: string; top: number; bottom: number; width: number }, viewportHeight: number): boolean {
  if (m.width <= 0) return false;
  if (m.visibility === "hidden" || m.opacity < 0.5) return false;
  return m.top < viewportHeight && m.bottom > 0;
}

/** Where the footer's mark is right now, or null when it is not on screen (wide screens, the docked menu, stepped aside). */
export function footerMarkRect(): DOMRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(".mobile-nav-mark");
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  const c = getComputedStyle(el);
  return markIsOnScreen({ opacity: Number(c.opacity), visibility: c.visibility, top: r.top, bottom: r.bottom, width: r.width }, window.innerHeight) ? r : null;
}
