/**
 * Ids of events known to be deleted: the reader's own deletions now, and
 * everyone's (incoming kind 5) next. Feeds drop them; a thread keeps a
 * tombstone where replies hang off one. In memory only: a reload re-learns
 * from the relays.
 */
import { useSyncExternalStore } from "react";

const deleted = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();

export function markDeleted(ids: string | string[]): void {
  let changed = false;
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    if (id && !deleted.has(id)) { deleted.add(id); changed = true; }
  }
  if (!changed) return;
  version += 1;
  for (const l of listeners) l();
}

export function isDeleted(id: string): boolean {
  return deleted.has(id);
}

let snapshot: ReadonlySet<string> = new Set();
let snapshotVersion = -1;
/** Re-renders when the set changes. The returned set is a new object per change, so it works as a memo dependency. */
export function useDeletedEvents(): ReadonlySet<string> {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
  if (snapshotVersion !== v) { snapshot = new Set(deleted); snapshotVersion = v; }
  return snapshot;
}

/** Tests only. */
export function _resetDeletedEvents(): void {
  deleted.clear();
  version += 1;
  for (const l of listeners) l();
}
