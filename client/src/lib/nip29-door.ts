/**
 * A NIP-29 room's two doors, derived once.
 *
 * Two axes, never collapsed: **public/private** is who may READ, **open/closed**
 * is who may JOIN. And three states each, because "we never got the metadata"
 * is not a door setting.
 *
 * WHY THIS EXISTS RATHER THAN READING THE FLAGS DIRECTLY.
 *
 * The app reads a door from positive tags — `isOpen`, not `!isClosed` — because
 * a room whose kind-39000 the relay declined to serve has neither tag, and
 * treating that as "open" is how a stranger got told they were already inside
 * (#594). That rule is right and stays.
 *
 * But it is not the whole rule, and a measurement forced the rest of it out
 * (2026-08-05, `wss://bunk-test.feeds.relay.tools`, newlay 0.3.6):
 *
 *     9007 create [closed]  ->  39000 tags: d, name, closed
 *     9002 [open]           ->  39000 tags: d, name          <- `closed` REMOVED
 *     9002 [closed]         ->  39000 tags: d, name, closed  <- restored
 *
 * The door flip works. The relay expresses "open" by REMOVING `closed`, and
 * never emits a positive `open` tag at all — public and open are NIP-29's
 * defaults, and this relay omits defaults. So on the very common case of a room
 * someone opened, both tags are absent.
 *
 * Read through the positive-tag rule alone, that room is "unknown" forever, and
 * an admin who just opened their room is told we cannot tell how people join
 * it. The toggle would look broken while the relay reported success.
 *
 * THE DISTINCTION THAT ACTUALLY MATTERS is not which tags are present. It is
 * **whether we hold the metadata event at all**:
 *
 *   - no 39000            -> `unknown`. We were never told anything.
 *   - 39000 with `closed` -> `closed`.
 *   - 39000 with `open`   -> `open`.
 *   - 39000 with neither  -> `open`, by NIP-29's stated default.
 *
 * That last line is not a guess from missing data — it is reading a default out
 * of a document we actually received. The difference between "the paper says
 * nothing here, and we have the paper" and "we never got the paper" is exactly
 * the difference this codebase keeps failing to draw, and `resolved` is what
 * draws it.
 *
 * A relay that emits BOTH tags is contradicting itself; that stays `unknown`
 * rather than picking a winner.
 */
import type { GroupMetadata } from "./nip29";

export type DoorState = "open" | "closed" | "unknown";
export type ReadState = "public" | "private" | "unknown";

/** Can anyone walk in, or does a moderator have to let them? */
export function joinDoor(meta: Pick<GroupMetadata, "isOpen" | "isClosed" | "resolved"> | null | undefined): DoorState {
  if (!meta || !meta.resolved) return "unknown";
  if (meta.isOpen && meta.isClosed) return "unknown"; // the relay contradicted itself
  if (meta.isClosed) return "closed";
  return "open"; // stated `open`, or NIP-29's default in metadata we hold
}

/** Can non-members read what is posted? */
export function readDoor(meta: Pick<GroupMetadata, "isPublic" | "isPrivate" | "resolved"> | null | undefined): ReadState {
  if (!meta || !meta.resolved) return "unknown";
  if (meta.isPublic && meta.isPrivate) return "unknown";
  if (meta.isPrivate) return "private";
  return "public";
}

/**
 * Is it worth asking this room who is waiting?
 *
 * DELIBERATELY STRICTER THAN `joinDoor`, and the difference is the point.
 *
 * `joinDoor` reads NIP-29's default out of metadata we hold and answers "open"
 * for a room carrying neither tag. That is right for a SENTENCE ON SCREEN: an
 * admin who just opened their room should be told it is open, not that we
 * cannot tell.
 *
 * It is wrong for deciding whether to ASK, because the two mistakes do not cost
 * the same thing:
 *
 *   ask a room that turns out to be open    -> one round-trip, returns empty
 *   skip a room that turns out to be closed -> people wait at a door nobody
 *                                              can see, indefinitely
 *
 * So this skips only on a POSITIVELY STATED `open` tag and never on the default.
 * A relay that omits `closed` for any reason other than the room being open —
 * a partial serve, a non-conformant implementation, a field we have not met yet
 * — costs us a wasted fetch instead of a hidden queue. That is #582's rule,
 * unchanged, and it is worth keeping even now that the default is legible.
 */
export function mayHaveWaitingMembers(
  meta: Pick<GroupMetadata, "isOpen" | "isClosed"> | null | undefined,
): boolean {
  // `isOpen && !isClosed` — an UNAMBIGUOUS open statement. A room claiming both
  // might be the closed one, and by the asymmetry above a maybe-closed room
  // gets asked. Reading `!isOpen` alone would skip it.
  return !(meta?.isOpen && !meta?.isClosed);
}
