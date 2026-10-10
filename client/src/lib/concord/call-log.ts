/**
 * Each screen's own record of its calls (owner, 2026-10-10): "You started the
 * call", "Ben joined the call", "Ben left the call", "You left the call" — as
 * rows in the room, so the next time two people disagree about what a call
 * did, the room itself says what this screen saw. Local only: nothing is
 * published, no new event kinds, nothing touches keys or relays. Kept for
 * the session (sessionStorage), per room.
 */
import { useSyncExternalStore } from "react";
import type { CallLogEntry } from "./call-words";

const PREFIX = "ro_call_log:";
const CHANGED = "concord-call-log-changed";
const KEEP = 40;

const key = (roomKey: string) => `${PREFIX}${roomKey}`;
const cache = new Map<string, CallLogEntry[]>();

export function readCallLog(roomKey: string): CallLogEntry[] {
  const hit = cache.get(roomKey);
  if (hit) return hit;
  let list: CallLogEntry[] = [];
  try {
    const raw = sessionStorage.getItem(key(roomKey));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((e) => e && typeof e.at === "number" && typeof e.text === "string");
  } catch {}
  cache.set(roomKey, list);
  return list;
}

export function appendCallLog(roomKey: string, entries: CallLogEntry[]): void {
  if (entries.length === 0) return;
  const next = [...readCallLog(roomKey), ...entries].slice(-KEEP);
  cache.set(roomKey, next);
  try { sessionStorage.setItem(key(roomKey), JSON.stringify(next)); } catch {}
  try { window.dispatchEvent(new CustomEvent(CHANGED, { detail: roomKey })); } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

const EMPTY: CallLogEntry[] = [];

/** The room's call rows, live. */
export function useCallLog(roomKey: string | null): CallLogEntry[] {
  return useSyncExternalStore(subscribe, () => (roomKey ? readCallLog(roomKey) : EMPTY), () => EMPTY);
}
