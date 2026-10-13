/**
 * Events known to be deleted, and by whom. Only the author's own deletion
 * counts: a properly signed deletion by someone else naming your post must
 * change nothing (owner QA, 2026-10-12: it had been blanking rows in
 * threads), so readers ask `isDeletedBy(id, author)` with the post's own
 * author. Feeds drop a deleted post; a thread keeps a tombstone where replies
 * hang off one. In memory only: a reload re-learns from the relays.
 */
import { useSyncExternalStore } from "react";

/** id → pubkey of the deletion's signer. The author's own mark is never overwritten. */
const deleted = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

export function markDeleted(ids: string | string[], by: string): void {
  let changed = false;
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    if (!id || !by) continue;
    const have = deleted.get(id);
    if (have === by) continue;
    // A later mark from someone else never replaces one that may be the author's.
    if (have && have !== by) continue;
    deleted.set(id, by);
    changed = true;
  }
  if (!changed) return;
  version += 1;
  for (const l of listeners) l();
}

/** True only when the deletion came from the post's own author. */
export function isDeletedBy(id: string, author: string): boolean {
  return !!author && deleted.get(id) === author;
}

export function deletedBy(id: string): string | undefined {
  return deleted.get(id);
}

let snapshot: ReadonlyMap<string, string> = new Map();
let snapshotVersion = -1;
/** Re-renders when the map changes. The returned map is a new object per change, so it works as a memo dependency. */
export function useDeletedEvents(): ReadonlyMap<string, string> {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
  if (snapshotVersion !== v) { snapshot = new Map(deleted); snapshotVersion = v; }
  return snapshot;
}

/** The author's own deletion, from a map snapshot. */
export function deletedByAuthor(map: ReadonlyMap<string, string>, id: string | undefined, author: string | undefined): boolean {
  return !!id && !!author && map.get(id) === author;
}

/** Tests only. */
export function _resetDeletedEvents(): void {
  deleted.clear();
  version += 1;
  for (const l of listeners) l();
}
