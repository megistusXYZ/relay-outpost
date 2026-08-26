/**
 * The rooms nested under one community row in Chats.
 *
 * Two sources, one list. PINS are the rooms the member arranged deliberately
 * (Stage 2.8) — they stay first, in pin order, and keep their unpin control.
 * JOINED rooms are everything in the member's kind-10009 for this relay — the
 * rooms they are actually IN, which used to be invisible here unless pinned.
 *
 * Honesty rules, in order of how expensive they were to learn:
 *
 * - `activity === null` means the relay never answered (or refused us). Every
 *   row renders SILENT — no timestamp, no unread. Reading "we never got to
 *   ask" as "quiet room" is the three-outcomes collapse RELAY_REACHABILITY.md
 *   exists to prevent.
 * - A groupId absent from an ANSWERED map is also not a claim: the batch
 *   fetch resolves on EOSE-or-timeout with whatever arrived. Absence only
 *   ever downgrades to "no dot" — it never invents a zero.
 * - A room with no name from either source is skipped, not titled "Chat".
 *   A row that cannot say what it is should not be a row; the community row
 *   above it is still the way in.
 *
 * Pure, so every one of those rules is a unit test instead of a conditional
 * buried in ChatList's render.
 */

export interface RoomRow {
  groupId: string;
  name: string;
  pinned: boolean;
  /** Present only on pinned rows — the id the unpin control needs. */
  pinId?: string;
  /** Newest activity in SECONDS, only when the relay answered with one. */
  lastActivity?: number;
  unread: boolean;
}

export interface BuildRoomRowsInput {
  /** Pinned rooms for this relay, already labelled (pinDisplayLabel), in pin order. */
  pins: Array<{ channelId: string; id: string; label: string }>;
  /** The member's kind-10009 entries scoped to this relay, in list order. */
  joined: Array<{ groupId: string; name?: string }>;
  /** groupId → newest kind-9 created_at (seconds). null = relay never answered. */
  activity: Record<string, number> | null;
  /** Local read mark (seconds) per room — lib/room-read.ts. */
  lastReadOf: (groupId: string) => number;
  /** Max rows; pins are never dropped, joined rooms overflow. Default 6. */
  cap?: number;
}

export interface RoomRowsResult {
  rows: RoomRow[];
  /** Joined rooms hidden behind the cap — "+N more rooms". */
  overflow: number;
}

export const DEFAULT_ROOM_ROWS_CAP = 6;

export function buildRoomRows(input: BuildRoomRowsInput): RoomRowsResult {
  const { pins, joined, activity, lastReadOf } = input;
  const cap = input.cap ?? DEFAULT_ROOM_ROWS_CAP;

  const clockOf = (groupId: string): number | undefined => {
    if (!activity) return undefined;
    const t = activity[groupId];
    return typeof t === "number" && t > 0 ? t : undefined;
  };
  const unreadOf = (groupId: string): boolean => {
    const t = clockOf(groupId);
    return typeof t === "number" && t > lastReadOf(groupId);
  };

  const toRow = (groupId: string, name: string, pinned: boolean, pinId?: string): RoomRow => ({
    groupId,
    name,
    pinned,
    ...(pinId ? { pinId } : {}),
    ...(clockOf(groupId) !== undefined ? { lastActivity: clockOf(groupId) } : {}),
    unread: unreadOf(groupId),
  });

  const nameByGroup = new Map(joined.filter((j) => j.name?.trim()).map((j) => [j.groupId, j.name!.trim()]));

  // Pins first, in the order the user arranged them. A pin whose label fell
  // through to the generic tab label arrives here already filtered out by the
  // caller (isRoomPin + label check) — but a joined name can still rescue one.
  const pinnedRows: RoomRow[] = [];
  const pinnedIds = new Set<string>();
  for (const p of pins) {
    const name = p.label.trim() || nameByGroup.get(p.channelId) || "";
    if (!name) continue;
    pinnedIds.add(p.channelId);
    pinnedRows.push(toRow(p.channelId, name, true, p.id));
  }

  // Joined rooms the pins didn't already cover: newest first among the rooms
  // whose clock we actually know; unknown clocks keep the list's own order
  // underneath — the same "no reason to move it" rule the community ordering
  // uses one level up.
  const seen = new Set<string>(pinnedIds);
  const clocked: Array<{ row: RoomRow; t: number }> = [];
  const unclocked: RoomRow[] = [];
  for (const j of joined) {
    if (seen.has(j.groupId)) continue;
    seen.add(j.groupId);
    const name = j.name?.trim();
    if (!name) continue;
    const row = toRow(j.groupId, name, false);
    const t = clockOf(j.groupId);
    if (typeof t === "number") clocked.push({ row, t });
    else unclocked.push(row);
  }
  clocked.sort((a, b) => b.t - a.t);
  const joinedRows = [...clocked.map((c) => c.row), ...unclocked];

  // Pins are never dropped — the user chose them one by one. Joined rooms fill
  // whatever room the cap leaves and the rest is an honest count, not a lie of
  // completeness.
  const slots = Math.max(0, cap - pinnedRows.length);
  const rows = [...pinnedRows, ...joinedRows.slice(0, slots)];
  return { rows, overflow: joinedRows.length - Math.min(joinedRows.length, slots) };
}
