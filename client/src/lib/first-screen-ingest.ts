/**
 * Take a signed-out visitor's first screen in while the page's code is still
 * downloading, so Home mounts with the notes already in the store instead of
 * adding them afterwards (and then waiting out the feed's 400 ms batching).
 * Measured 2026-10-03 on a throttled phone: the notes arrived around 1 s, the
 * page mounted at 3.4 s, and the posts showed 0.6 s after that.
 *
 * Runs only when index.html started the request (a signed-out visitor on
 * "/"). The scores are held here for Home's spam floor (see firstScreenRanks).
 */
import { eventStore, registerProfileInAllCaches } from "./nostr";
import { takeFirstScreen } from "./first-screen";

const EMPTY: ReadonlyMap<string, number> = new Map();
let ranks: ReadonlyMap<string, number> = EMPTY;
let taken = false;
const listeners = new Set<() => void>();

/** The first screen's author scores, once taken (empty before, and for everyone else). */
export function firstScreenRanks(): ReadonlyMap<string, number> {
  return ranks;
}

/** For useSyncExternalStore: told when the scores arrive. */
export function subscribeFirstScreenRanks(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Whether the first screen has already been taken in (Home then doesn't ask again). */
export function firstScreenTaken(): boolean {
  return taken;
}

export function ingestEarlyFirstScreen(): void {
  if (typeof window === "undefined" || !window.__roFirstScreen) return;
  taken = true;
  void takeFirstScreen().then((fs) => {
    if (!fs) return;
    for (const p of fs.profiles) registerProfileInAllCaches(p);
    ranks = fs.ranks;
    for (const l of listeners) l();
    for (const n of fs.notes) eventStore.add(n);
  });
}
