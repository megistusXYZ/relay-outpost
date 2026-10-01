/**
 * Margin notes (owner, 2026-10-01): on a wide desktop profile, a reply's
 * context — the post it answers — is set in the margin beside the reply
 * instead of inside its card, like a sidenote in a well-set book. The reply
 * reads clean; the thing it answers sits level with it.
 *
 * The surface that has a margin (the profile stream) provides the slot; the
 * post portals its existing context there. Keyed by event id, so only the
 * row's own post uses the slot — never a quoted or threaded post inside it.
 * No slot (every other surface, and narrower screens) means context stays in
 * the card exactly as before.
 */
import { createContext } from "react";

export interface ReplyMarginSlot {
  /** The post this slot belongs to. */
  eventId: string;
  /** Where the context goes; null while there is no margin to put it in. */
  el: HTMLElement | null;
}

export const ReplyMarginContext = createContext<ReplyMarginSlot | null>(null);

/** The margin exists from this width: rail + reading column + notes fit. */
export const MARGIN_NOTES_MIN_WIDTH = 1440;

/** Does this post's context go to the margin? */
export function contextGoesToMargin(slot: ReplyMarginSlot | null, eventId: string, isReply: boolean, parentIsQuoted: boolean): boolean {
  return !!slot?.el && slot.eventId === eventId && isReply && !parentIsQuoted;
}
