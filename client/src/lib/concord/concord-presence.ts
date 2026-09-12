/**
 * Who's in a call (Concord CORD-07 §4). Presence rides the room itself, in the
 * ephemeral 21059 wrap at the room's address with the encrypted 20013 seal, so
 * relays and the media server never learn who is calling. While in a call a
 * member announces "joined" every 30 seconds, carrying the identity the media
 * server gave them and which media server they're on; leaving announces
 * "left" (best effort; a missed one heals when the last "joined" goes stale).
 * The verbs are past tense on purpose: they describe a call, not membership.
 */
import { effectiveTime, msTag, type RumorTemplate } from "./concord-events";

/** A call presence rumor (ephemeral range, never stored). */
export const KIND_CALL_PRESENCE = 23313;

/** A "joined" not refreshed for this long (three missed 30s heartbeats) counts as gone. */
export const PRESENCE_STALE_MS = 90_000;

export type CallPresence =
  | { state: "joined"; identity: string; broker: string }
  | { state: "left" };

/** A presence rumor, bound to the room and epoch like any room message. */
export function buildPresenceRumor(
  author: string, channelId: string, epoch: bigint, presence: CallPresence, ms: number, createdAt: number,
): RumorTemplate {
  const tags: string[][] = [["channel", channelId], ["epoch", epoch.toString()]];
  if (presence.state === "joined") tags.push(["identity", presence.identity], ["broker", presence.broker]);
  tags.push(msTag(ms));
  return { kind: KIND_CALL_PRESENCE, pubkey: author, created_at: createdAt, content: presence.state, tags };
}

/** Where a member sits in a call: their media-server identity, that server, and when they last said so. */
export interface CallSeat { identity: string; broker: string; at: number }

/**
 * Who is in a call right now, from the presence heard on the room: each
 * member's latest word wins (on the CORD-03 millisecond clock), a "left" takes
 * them out, and a "joined" older than 90 seconds counts as gone. Returns
 * member pubkey → their seat.
 */
export function callRoster(
  rumors: Array<{ kind: number; pubkey: string; content: string; created_at: number; tags: string[][] }>,
  nowMs: number,
): Map<string, CallSeat> {
  const latest = new Map<string, { at: number; content: string; tags: string[][] }>();
  for (const r of rumors) {
    if (r.kind !== KIND_CALL_PRESENCE || (r.content !== "joined" && r.content !== "left")) continue;
    const at = effectiveTime(r);
    const seen = latest.get(r.pubkey);
    if (!seen || at > seen.at) latest.set(r.pubkey, { at, content: r.content, tags: r.tags });
  }
  const roster = new Map<string, CallSeat>();
  for (const [member, word] of latest) {
    if (word.content !== "joined" || nowMs - word.at > PRESENCE_STALE_MS) continue;
    const tag = (name: string) => word.tags.find((t) => t[0] === name)?.[1];
    const identity = tag("identity"), broker = tag("broker");
    if (identity && broker) roster.set(member, { identity, broker, at: word.at });
  }
  return roster;
}

/** One caller the media server reports, matched (or not) to a member. */
export interface CallerMatch {
  identity: string;
  /** The member whose fresh presence alone claims this seat; null when nobody does, or several do. */
  member: string | null;
  /** Two or more members claim it: identities are member-visible, so a copied claim proves nothing. */
  contested: boolean;
}

/**
 * Match the callers the media server reports to members (CORD-07 §4). A caller
 * is shown as a member only when exactly one member's fresh presence claims
 * their seat. A copied claim makes every claimant unverified until the stale
 * one ages out, and an unclaimed seat stays unverified.
 */
export function matchCallers(roster: Map<string, CallSeat>, identities: string[]): CallerMatch[] {
  const claimants = new Map<string, string[]>();
  for (const [member, seat] of roster) {
    const list = claimants.get(seat.identity);
    if (list) list.push(member);
    else claimants.set(seat.identity, [member]);
  }
  return identities.map((identity) => {
    const who = claimants.get(identity) ?? [];
    return who.length === 1
      ? { identity, member: who[0], contested: false }
      : { identity, member: null, contested: who.length > 1 };
  });
}
