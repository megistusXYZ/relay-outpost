/**
 * The groups-with-something-new set behind the Chats badge, as a tiny store
 * every badge can read without loading the group-chat library.
 *
 * The watcher that fills it (concord-unread.ts) leans on the whole Concord
 * key store; it runs inside the signed-in-only badge engine
 * (hooks/chats-badge-engine.tsx) and writes here. A visitor reads an empty
 * set and downloads none of it.
 */
import { useSyncExternalStore } from "react";

let unreadCommunities: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function setUnreadCommunities(next: ReadonlySet<string>): void {
  unreadCommunities = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useUnreadCommunities(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => unreadCommunities, () => unreadCommunities);
}
