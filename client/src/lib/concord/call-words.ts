/**
 * What a call says about itself (owner, 2026-10-10, from the first-use
 * review). Neither person on that call could answer "does this go anywhere
 * else?" or "is it over?" from their screen. The words here are the answers:
 * who can join, what happens when you're the last one left, and a log of
 * who came and went that each screen keeps for itself.
 */

/** Who a group's call reaches. Technically: a room on our media server, joined only by members holding the group's keys, end-to-end encrypted. */
export function callScopeLine(groupName: string): string {
  const who = groupName.trim() || "this group";
  return `Only members of ${who} can join. Nothing leaves this room.`;
}

/** How long the last one left stays before the room lets them go. */
export const ALONE_LEAVE_MS = 60_000;

/**
 * The last one left. `aloneSince` is set the moment the others have all gone
 * (never for a call you started and are waiting in: nobody had come yet).
 */
export function aloneState(s: { aloneSince: number | null; now: number }, leaveAfterMs = ALONE_LEAVE_MS): { alone: boolean; secondsLeft: number; leaveNow: boolean } {
  if (s.aloneSince === null) return { alone: false, secondsLeft: 0, leaveNow: false };
  const left = Math.max(0, Math.ceil((s.aloneSince + leaveAfterMs - s.now) / 1000));
  return { alone: true, secondsLeft: left, leaveNow: s.now - s.aloneSince >= leaveAfterMs };
}

/**
 * Track "others were here, now they're gone". Returns the next aloneSince:
 * null while nobody else has arrived yet or while others are present; the
 * moment they all left, once they had been here.
 */
export function nextAloneSince(s: { othersNow: number; hadOthers: boolean; aloneSince: number | null; now: number }): number | null {
  if (s.othersNow > 0) return null;
  if (!s.hadOthers) return null;
  return s.aloneSince ?? s.now;
}

export interface CallLogEntry { at: number; text: string }

/**
 * Once someone shares a screen the activity has changed from talking to
 * looking (owner, 2026-10-10: the shared screen came through as a thin strip
 * under two empty face tiles). Screens take the stage, full width; faces
 * become a strip. With nothing shared, it's the grid of faces.
 */
export function stageLayout<P extends { sharing: boolean }>(participants: P[]): { screens: P[]; faces: P[]; mode: "grid" | "stage" } {
  const screens = participants.filter((p) => p.sharing);
  return { screens, faces: participants, mode: screens.length ? "stage" : "grid" };
}

/** The rows for who came and went since the last look: "<name> joined the call" / "<name> left the call". */
export function callLogDiff(prev: string[], next: string[], nameOf: (identity: string) => string, now: number): CallLogEntry[] {
  const out: CallLogEntry[] = [];
  const was = new Set(prev); const is = new Set(next);
  for (const id of next) if (!was.has(id)) out.push({ at: now, text: `${nameOf(id)} joined the call` });
  for (const id of prev) if (!is.has(id)) out.push({ at: now, text: `${nameOf(id)} left the call` });
  return out;
}
