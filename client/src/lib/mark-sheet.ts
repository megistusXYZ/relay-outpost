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

/** Where the footer's mark is right now, or null when it is not on screen (wide screens, the docked menu). */
export function footerMarkRect(): DOMRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(".mobile-nav-mark");
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 ? r : null;
}
