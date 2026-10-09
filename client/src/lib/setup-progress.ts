/**
 * Set up your community — the owner's own progress (owner, 2026-10-09).
 *
 * What the relay can't tell us — a step ticked or skipped by hand, "just
 * me", "I copied the link", and whether the list is hidden — used to live in
 * one browser's localStorage, so the phone and the laptop disagreed and every
 * device had to be told "Hide" again. It is now one small record kept with
 * the community (kind 30078, d = relay-outpost/setup/<relay>, by the owner,
 * like the rules record), so every device reads the same thing. Last writer
 * wins, whole: an undo on the phone is not resurrected by the laptop's older
 * copy. The browser keeps the last record it saw so the list opens where it
 * left off, and still works offline.
 *
 * Pure.
 */
import type { SetupItemId } from "./setup-checklist";

export interface SetupProgress {
  done: SetupItemId[];
  skipped: SetupItemId[];
  hidden: boolean;
  /** Unix seconds of the last change; 0 for never. */
  at: number;
}

const IDS: ReadonlySet<string> = new Set(["identity", "about", "who-can-post", "team", "inbox", "badge", "share"]);
const isId = (v: unknown): v is SetupItemId => typeof v === "string" && IDS.has(v);

export const PROGRESS_D_TAG = (relayUrl: string) => `relay-outpost/setup/${relayUrl}`;

export function emptyProgress(): SetupProgress {
  return { done: [], skipped: [], hidden: false, at: 0 };
}

/** The record's content, or null when it isn't one. Steps we don't know are dropped. */
export function readProgress(content: string): SetupProgress | null {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.done) || !Array.isArray(r.skipped)) return null;
  return {
    done: r.done.filter(isId),
    skipped: r.skipped.filter(isId),
    hidden: r.hidden === true,
    at: typeof r.at === "number" && r.at > 0 ? Math.floor(r.at) : 0,
  };
}

const without = (xs: SetupItemId[], id: SetupItemId) => xs.filter((x) => x !== id);
const withOnce = (xs: SetupItemId[], id: SetupItemId) => (xs.includes(id) ? xs : [...xs, id]);

export function markDone(p: SetupProgress, id: SetupItemId, at: number): SetupProgress {
  return { ...p, done: withOnce(p.done, id), skipped: without(p.skipped, id), at };
}

export function unmark(p: SetupProgress, id: SetupItemId, at: number): SetupProgress {
  return { ...p, done: without(p.done, id), skipped: without(p.skipped, id), at };
}

export function skipStep(p: SetupProgress, id: SetupItemId, at: number): SetupProgress {
  return { ...p, skipped: withOnce(p.skipped, id), done: without(p.done, id), at };
}

export function setHidden(p: SetupProgress, hidden: boolean, at: number): SetupProgress {
  return { ...p, hidden, at };
}

/** The newer of two copies, whole. */
export function newer(a: SetupProgress | null, b: SetupProgress | null): SetupProgress | null {
  if (!a) return b;
  if (!b) return a;
  return b.at >= a.at ? b : a;
}
