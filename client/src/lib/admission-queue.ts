import type { GroupAdmin, GroupMetadata, JoinRequest } from "@/lib/nip29";
import { mayHaveWaitingMembers } from "./nip29-door";
import { toHexPubkey } from "@/lib/nip11";

/**
 * The admission queue: everyone waiting to be let into a space you run, from
 * every space you run, in one list.
 *
 * The pieces already existed — JoinRequestRow in CommsTab, fetchJoinRequests,
 * and the kind-9000 approve path. What did not exist was the AGGREGATE. A
 * request was only visible from inside the one group it belonged to, so an
 * operator with three spaces had to open all three to discover that nobody was
 * waiting. This module is the pure half of fixing that: which requests are
 * genuinely pending, for which spaces, in what order.
 *
 * Everything here is a pure function over data the caller has already fetched,
 * so the ordering and filtering rules can be tested without a relay.
 */

/** One person waiting at one door. */
export interface PendingAdmission {
  relayUrl: string;
  groupId: string;
  /** Group name when metadata resolved; the caller falls back to the id. */
  groupName?: string;
  pubkey: string;
  createdAt: number;
  eventId: string;
  /**
   * The invite code the request carried, if any. Its PRESENCE is the single
   * strongest cheap signal on the card: a code means an existing member handed
   * this person a link. Somebody already vouched, by action rather than by
   * assertion.
   */
  code?: string;
}

/** Is this account an admin of the group, per the group's own admin list? */
export function isGroupModerator(
  admins: GroupAdmin[] | null | undefined,
  myPubkey: string | null | undefined,
): boolean {
  // Normalize BOTH sides. These pubkeys arrive from a relay's kind-39001 tags
  // and from session state, so either can be an npub, uppercase hex, or carry
  // whitespace — and a raw `===` then silently reports "not a moderator" for
  // someone who plainly is. That exact defect locked a real operator out of the
  // ops dashboard (#461), and the rule written down then was: normalize both
  // sides of any external-pubkey compare.
  //
  // It matters more here than it did there: nip29Capabilities() is built
  // entirely on this predicate, so this single comparison gates EVERY NIP-29
  // admin surface. A false negative hides the whole admin drawer.
  const me = toHexPubkey(myPubkey);
  if (!me) return false;
  return (admins ?? []).some((a) => toHexPubkey(a.pubkey) === me);
}

/**
 * Spaces worth polling for join requests: ones this account moderates, minus
 * the ones the relay has positively told us are open (nobody knocks on an open
 * door, so asking would spend a round-trip on a guaranteed empty).
 *
 * The gate skips only a room we KNOW is open, and the difference from
 * `isClosed` is load-bearing. Gating on `isClosed` demands positive proof of
 * closedness before an operator is allowed to see who is waiting — so a relay
 * that serves no metadata silently produces "nobody is waiting" for a room with
 * people at the door. Absence of evidence about the door is not evidence about
 * the queue.
 *
 * `mayHaveWaitingMembers` now makes that call, because "we know it is open" got
 * subtler than a flag: newlay expresses an open room by REMOVING `closed` and
 * emits no positive `open` tag, so a room somebody opened has neither. That is
 * open, and we can say so — but only because we hold its metadata. See
 * lib/nip29-door.ts. Unknown still gets asked.
 */
export function admittableGroups(
  groups: GroupMetadata[],
  adminsByGroupId: Map<string, GroupAdmin[]>,
  myPubkey: string | null | undefined,
): GroupMetadata[] {
  if (!myPubkey) return [];
  return groups.filter(
    (g) => mayHaveWaitingMembers(g) && isGroupModerator(adminsByGroupId.get(g.id), myPubkey),
  );
}

/**
 * Requests that are still actually pending.
 *
 * Anyone already in the member list has been let in — their 9021 stays on the
 * relay forever, so without this the queue would keep asking you to approve
 * people who are already inside. The same person asking twice collapses to
 * their most recent request.
 */
export function pendingFor(
  requests: JoinRequest[],
  members: string[],
  ctx: { relayUrl: string; group: Pick<GroupMetadata, "id" | "name"> },
): PendingAdmission[] {
  const memberSet = new Set(members);
  const newest = new Map<string, JoinRequest>();
  for (const r of requests) {
    if (memberSet.has(r.pubkey)) continue;
    const prev = newest.get(r.pubkey);
    if (!prev || r.createdAt > prev.createdAt) newest.set(r.pubkey, r);
  }
  return [...newest.values()].map((r) => ({
    relayUrl: ctx.relayUrl,
    groupId: ctx.group.id,
    groupName: ctx.group.name,
    pubkey: r.pubkey,
    createdAt: r.createdAt,
    eventId: r.eventId,
    code: r.code,
  }));
}

/**
 * The queue as an operator reads it: oldest FIRST.
 *
 * The opposite of a feed, deliberately. A notification stream is newest-first
 * because the new thing is the interesting one; a queue of people waiting is
 * oldest-first because the person who has waited longest is the one being let
 * down. Sorting this like a feed would bury exactly the request that most needs
 * answering.
 */
export function orderQueue(items: PendingAdmission[]): PendingAdmission[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt);
}

/** One person may knock on several of your doors; each is its own decision. */
export function mergeQueues(queues: PendingAdmission[][]): PendingAdmission[] {
  const seen = new Set<string>();
  const out: PendingAdmission[] = [];
  for (const q of queues) {
    for (const item of q) {
      const key = `${item.relayUrl}|${item.groupId}|${item.pubkey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return orderQueue(out);
}
