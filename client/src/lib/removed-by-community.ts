/**
 * Ids of posts an admin removed from a community in this session. Only the
 * admin's own view needs it: the relay stops serving the post, so everyone
 * else simply doesn't get it. Where replies hang off a removed post, a
 * placeholder keeps their place (lib/community-removal.ts).
 */
import { useSyncExternalStore } from "react";

const removed = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

export function markRemovedByCommunity(id: string): void {
  if (!id || removed.has(id)) return;
  removed.add(id);
  version += 1;
  for (const l of listeners) l();
}

let snapshot: ReadonlySet<string> = new Set();
let snapshotVersion = -1;
export function useRemovedByCommunity(): ReadonlySet<string> {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
  if (snapshotVersion !== v) { snapshot = new Set(removed); snapshotVersion = v; }
  return snapshot;
}
