/**
 * A person's own choices about their private chats: which are pinned to the
 * top, which are muted, and how long their messages in a chat last.
 *
 * NIP-17 carries messages, not settings, so these stay on this device, per
 * account (as Brainstorm and Amethyst keep theirs). A chat is named by its
 * key (lib/dm-room.ts), so the same choice applies to a one-to-one chat and to
 * a chat with several people alike.
 *
 * The rules are pure functions over a plain object; reading and writing it is
 * at the bottom.
 */

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

export function writeDmPrefs(pubkey: string, prefs: DmPrefs): void {
  try {
    localStorage.setItem(KEY(pubkey), JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent(DM_PREFS_EVENT));
  } catch { /* storage full or blocked: the choice lasts for this visit only */ }
}
