/**
 * A person's own choices about their private chats: which are pinned to the
 * top, which are muted, and how long their messages in a chat last.
 *
 * NIP-17 carries messages, not settings, so these are kept on this device,
 * per account. A chat is named by its key (lib/dm-room.ts), so the same choice
 * applies to a one-to-one chat and to a chat with several people alike.
 *
 * They also follow the person to their other devices: each choice is kept
 * with the time it was made ("marks", below), and travels inside the
 * encrypted read-state document the app already syncs
 * (lib/read-state-sync.ts). For each choice the later one wins, on whichever
 * device it was made — including the choice to undo one.
 *
 * The rules are pure functions over plain objects; reading and writing them
 * is at the bottom.
 */

import { READSTATE_CHANGED_EVENT } from "@/lib/dm-read";

export interface DmPrefs {
  /** Chats kept at the top of the list, most recently pinned first. */
  pinned: string[];
  /** Chats that don't count as unread and don't alert. */
  muted: string[];
  /** chat key → how long MY messages there last, in seconds. Absent = for good. */
  timers: Record<string, number>;
}

export const EMPTY_PREFS: DmPrefs = { pinned: [], muted: [], timers: {} };

/** The timers offered. 0 is "off". */
export const TIMER_OPTIONS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: "Off" },
  { seconds: 60 * 60, label: "1 hour" },
  { seconds: 24 * 60 * 60, label: "1 day" },
  { seconds: 7 * 24 * 60 * 60, label: "1 week" },
];

/** How many chats can be pinned: a pinned list longer than a screen pins nothing. */
export const MAX_PINNED = 5;

export function isPinned(prefs: DmPrefs, room: string): boolean {
  return prefs.pinned.includes(room);
}

/** Pin or unpin. The newest pin leads; past the limit the oldest pin gives way. */
export function setPinned(prefs: DmPrefs, room: string, on: boolean): DmPrefs {
  const rest = prefs.pinned.filter((k) => k !== room);
  return { ...prefs, pinned: on ? [room, ...rest].slice(0, MAX_PINNED) : rest };
}

export function isMutedChat(prefs: DmPrefs, room: string): boolean {
  return prefs.muted.includes(room);
}

export function setMutedChat(prefs: DmPrefs, room: string, on: boolean): DmPrefs {
  const rest = prefs.muted.filter((k) => k !== room);
  return { ...prefs, muted: on ? [...rest, room] : rest };
}

/** The chat's timer in seconds; 0 when messages there are kept. */
export function timerOf(prefs: DmPrefs, room: string): number {
  const t = prefs.timers[room];
  return typeof t === "number" && t > 0 ? t : 0;
}

export function setTimer(prefs: DmPrefs, room: string, seconds: number): DmPrefs {
  const timers = { ...prefs.timers };
  if (seconds > 0) timers[room] = Math.floor(seconds);
  else delete timers[room];
  return { ...prefs, timers };
}

/** When a message written at `writtenAt` in this chat stops being shown, if it does. */
export function expirationFor(prefs: DmPrefs, room: string, writtenAt: number): number | undefined {
  const t = timerOf(prefs, room);
  return t > 0 ? writtenAt + t : undefined;
}

/** "1 hour" for a timer, "" when off. */
export function timerLabel(seconds: number): string {
  if (!(seconds > 0)) return "";
  return TIMER_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${Math.round(seconds / 3600)} hours`;
}

/**
 * The chat list's order: pinned chats first, in the order they were pinned;
 * the rest as they came (newest message first). A pin for a chat that isn't in
 * the list is simply not shown.
 */
export function pinnedFirst<T extends { pubkey: string }>(chats: readonly T[], prefs: DmPrefs): T[] {
  if (prefs.pinned.length === 0) return [...chats];
  const byKey = new Map(chats.map((c) => [c.pubkey, c]));
  const pinned = prefs.pinned.map((k) => byKey.get(k)).filter((c): c is T => !!c);
  const pinnedKeys = new Set(pinned.map((c) => c.pubkey));
  return [...pinned, ...chats.filter((c) => !pinnedKeys.has(c.pubkey))];
}

/* ---- each choice, with when it was made ---- */

/**
 * `pin:<chat>`, `mute:<chat>`, `timer:<chat>` → the choice (1/0, or the
 * timer's seconds; 0 is "off") and when it was made (ms). An undone choice
 * stays as a 0: without it, a device that hasn't heard would bring it back.
 */
export type DmPrefMarks = Record<string, { v: number; at: number }>;

const MARK_KINDS = ["pin", "mute", "timer"] as const;
const MAX_MARKS = 400;

function flat(prefs: DmPrefs): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of prefs.pinned) out[`pin:${k}`] = 1;
  for (const k of prefs.muted) out[`mute:${k}`] = 1;
  for (const [k, v] of Object.entries(prefs.timers)) if (v > 0) out[`timer:${k}`] = v;
  return out;
}

/** The marks after `prev` became `next` at time `at`: only what changed is re-stamped. */
export function marksAfter(prev: DmPrefs, next: DmPrefs, marks: DmPrefMarks, at: number): DmPrefMarks {
  const before = flat(prev), after = flat(next);
  const out: DmPrefMarks = { ...marks };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = after[key] ?? 0;
    if ((before[key] ?? 0) !== v || !out[key]) out[key] = { v, at };
  }
  return capMarks(out);
}

/** Marks for choices made before marks existed: kept, but dated so that any dated choice wins. */
export function backfilledMarks(prefs: DmPrefs, marks: DmPrefMarks): DmPrefMarks {
  const out: DmPrefMarks = { ...marks };
  // Pins keep their order: the first pin is the newest.
  prefs.pinned.forEach((k, i) => { if (!out[`pin:${k}`]) out[`pin:${k}`] = { v: 1, at: prefs.pinned.length - i }; });
  for (const [key, v] of Object.entries(flat(prefs))) if (!out[key]) out[key] = { v, at: 1 };
  return out;
}

function validMark(key: string, m: unknown): m is { v: number; at: number } {
  if (!MARK_KINDS.some((k) => key.startsWith(`${k}:`) && key.length > k.length + 1)) return false;
  const e = m as { v?: unknown; at?: unknown } | null;
  return !!e && typeof e.v === "number" && Number.isFinite(e.v) && e.v >= 0 && typeof e.at === "number" && Number.isFinite(e.at) && e.at > 0;
}

/** Two devices' marks as one: per choice the later wins (a tie goes to the larger value, so both sides agree). */
export function mergeMarks(a: DmPrefMarks | null | undefined, b: DmPrefMarks | null | undefined): DmPrefMarks {
  const out: DmPrefMarks = {};
  for (const side of [a, b]) {
    for (const [key, m] of Object.entries(side ?? {})) {
      if (!validMark(key, m)) continue;
      const had = out[key];
      if (!had || m.at > had.at || (m.at === had.at && m.v > had.v)) out[key] = { v: Math.floor(m.v), at: m.at };
    }
  }
  return capMarks(out);
}

/** Bounded: undone choices are dropped first, oldest first. */
function capMarks(marks: DmPrefMarks): DmPrefMarks {
  const entries = Object.entries(marks);
  if (entries.length <= MAX_MARKS) return marks;
  entries.sort((x, y) => (Number(y[1].v > 0) - Number(x[1].v > 0)) || y[1].at - x[1].at);
  return Object.fromEntries(entries.slice(0, MAX_MARKS));
}

/** The choices the marks add up to. */
export function prefsFromMarks(marks: DmPrefMarks): DmPrefs {
  const pins: Array<[string, number]> = [];
  const muted: string[] = [];
  const timers: Record<string, number> = {};
  for (const [key, m] of Object.entries(marks)) {
    if (!validMark(key, m) || m.v <= 0) continue;
    const at = key.indexOf(":");
    const kind = key.slice(0, at), chat = key.slice(at + 1);
    if (kind === "pin") pins.push([chat, m.at]);
    else if (kind === "mute") muted.push(chat);
    else timers[chat] = Math.floor(m.v);
  }
  pins.sort((x, y) => y[1] - x[1]);
  return { pinned: pins.slice(0, MAX_PINNED).map(([k]) => k), muted, timers };
}

/* ---- kept on this device, per account ---- */

const KEY = (pubkey: string) => `ro_dm_prefs_v1_${pubkey}`;
export const DM_PREFS_EVENT = "dm-prefs-changed";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

/** Whatever was stored, as valid prefs: a damaged entry costs that entry, not the lot. */
export function parsePrefs(raw: unknown): DmPrefs {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PREFS, timers: {} };
  const r = raw as Record<string, unknown>;
  const timers: Record<string, number> = {};
  if (r.timers && typeof r.timers === "object") {
    for (const [k, v] of Object.entries(r.timers as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) timers[k] = Math.floor(v);
    }
  }
  return { pinned: Array.from(new Set(strings(r.pinned))).slice(0, MAX_PINNED), muted: Array.from(new Set(strings(r.muted))), timers };
}

export function readDmPrefs(pubkey: string | null | undefined): DmPrefs {
  if (!pubkey) return { ...EMPTY_PREFS, timers: {} };
  try { return parsePrefs(JSON.parse(localStorage.getItem(KEY(pubkey)) || "null")); } catch { return { ...EMPTY_PREFS, timers: {} }; }
}

const MARKS_KEY = (pubkey: string) => `ro_dm_prefs_marks_v1_${pubkey}`;

/** This device's marks, including undated choices from before marks existed. */
export function readDmPrefMarks(pubkey: string): DmPrefMarks {
  let stored: DmPrefMarks = {};
  try { stored = mergeMarks(JSON.parse(localStorage.getItem(MARKS_KEY(pubkey)) || "null"), null); } catch { /* none */ }
  return backfilledMarks(readDmPrefs(pubkey), stored);
}

export function writeDmPrefs(pubkey: string, prefs: DmPrefs): void {
  try {
    const marks = marksAfter(readDmPrefs(pubkey), prefs, readDmPrefMarks(pubkey), Date.now());
    localStorage.setItem(MARKS_KEY(pubkey), JSON.stringify(marks));
    localStorage.setItem(KEY(pubkey), JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(DM_PREFS_EVENT));
    // The reader chose something here: the synced document is due a publish.
    window.dispatchEvent(new CustomEvent(READSTATE_CHANGED_EVENT));
  } catch { /* storage full or blocked: the choice lasts for this visit only */ }
}

/**
 * Choices arriving from another device. Returns true when they changed
 * anything here. The screen is told; the "something changed here" event is
 * not fired, so this does not echo straight back out.
 */
export function applyRemoteDmPrefMarks(pubkey: string, remote: DmPrefMarks | null | undefined): boolean {
  if (!remote) return false;
  try {
    const local = readDmPrefMarks(pubkey);
    const merged = mergeMarks(local, remote);
    const before = JSON.stringify(readDmPrefs(pubkey));
    const next = prefsFromMarks(merged);
    localStorage.setItem(MARKS_KEY(pubkey), JSON.stringify(merged));
    if (JSON.stringify(next) === before) return false;
    localStorage.setItem(KEY(pubkey), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(DM_PREFS_EVENT));
    return true;
  } catch {
    return false;
  }
}
