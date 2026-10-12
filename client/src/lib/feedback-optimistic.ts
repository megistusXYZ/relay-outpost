/**
 * Optimistic copies of the operator's own feedback actions (a status change,
 * a reply), shared by every reader: the App errors chip, the Feedback tab and
 * the Inbox badge all see the change the moment it is made, and it survives
 * switching chips or leaving the tab until the real round-trip lands.
 * A copy is forgotten after ten minutes; by then the real one has landed or
 * the send has failed and been rolled back.
 */
import { useSyncExternalStore } from "react";
import type { NostrEvent } from "nostr-tools";
import type { UnwrappedRumor } from "./dm";

const TTL_SEC = 600;
let rumors: UnwrappedRumor[] = [];
let events: NostrEvent[] = [];
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version += 1; for (const l of listeners) l(); };

export function addOptimisticRumor(r: UnwrappedRumor): void { rumors = [...rumors, r]; bump(); }
export function addOptimisticEvent(e: NostrEvent): void { events = [...events, e]; bump(); }
export function removeOptimistic(id: string): void {
  const nr = rumors.filter((r) => r.id !== id), ne = events.filter((e) => e.id !== id);
  if (nr.length === rumors.length && ne.length === events.length) return;
  rumors = nr; events = ne; bump();
}

/** The live copies, dropping any older than ten minutes. */
export function optimisticFeedback(nowSec: number = Math.floor(Date.now() / 1000)): { rumors: UnwrappedRumor[]; events: NostrEvent[] } {
  const fresh = (t: number) => nowSec - t <= TTL_SEC;
  return { rumors: rumors.filter((r) => fresh(r.created_at)), events: events.filter((e) => fresh(e.created_at)) };
}

export function useOptimisticFeedback(): { rumors: UnwrappedRumor[]; events: NostrEvent[] } {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => version,
    () => version,
  );
  void v;
  return optimisticFeedback();
}

/** Tests only. */
export function _resetOptimisticFeedback(): void { rumors = []; events = []; bump(); }
