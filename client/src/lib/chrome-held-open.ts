/**
 * "Show menu": the folded Relay mark was tapped, so the phone's chrome (the
 * bottom menu and the top bar) is held open although the page is scrolled
 * down. Both ends read this one flag so they come back together and leave
 * together (owner, 2026-11-23). Scrolling further down, or back up, lets go.
 */
import { useSyncExternalStore } from "react";

let held = false;
const listeners = new Set<() => void>();
const set = (next: boolean) => {
  if (held === next) return;
  held = next;
  for (const l of listeners) l();
};

export const holdChromeOpen = () => set(true);
export const releaseChrome = () => set(false);

export function useChromeHeldOpen(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => held,
    () => false,
  );
}
