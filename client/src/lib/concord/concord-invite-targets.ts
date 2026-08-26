/**
 * Which of my group chats can I bring a given person into?
 *
 * Every invite flow in the app runs one direction — you open a community, then
 * search for a person. This is the inverse, for when you're already looking at
 * someone and want to bring them somewhere.
 *
 * Deliberately cheap: it reads only what's already on the stored record.
 * Folding every community's governance plane just to draw a list is not worth
 * it, and that judgement stands. What did NOT stand is treating the cheap
 * answer as the final one — this list fed a send path with no permission check
 * of any kind behind it.
 *
 * TWO KINDS OF ENTRY, and only one is trustworthy on its own:
 *
 *   "owner"  — `c.owner === myPubkey`. Sound, local, un-stale: the owner is
 *              bound into the community id at creation and never changes.
 *   "policy" — `allowMemberInvites` off the stored record. PROVISIONAL. Nothing
 *              reconciles that record with the fold, so it keeps saying "open"
 *              for as long as the device has been away — after the owner closed
 *              invites, and for someone who has since been removed.
 *
 * A provisional entry is fine to LIST. It is not sufficient to MINT: an invite
 * hands over the community root. Callers must confirm a "policy" entry against
 * the live fold with `canInviteToCommunity` before sending — one fold, for one
 * community, at the moment a human picks it, instead of N folds to draw a list
 * nobody may act on.
 */
import type { StoredCommunity } from "./concord-keys";

/** Only the fields the decision needs — keeps this testable without a full record. */
export type InviteTarget = Pick<StoredCommunity, "community_id" | "name" | "owner" | "allowMemberInvites"> &
  Partial<StoredCommunity>;

/** Why an entry is on the list — and therefore how far it can be trusted. */
export type InviteTargetReason = "owner" | "policy";

export function invitableCommunities<T extends InviteTarget>(communities: T[], myPubkey: string | null | undefined): T[] {
  if (!myPubkey) return [];
  return communities
    .filter((c) => c.owner === myPubkey || c.allowMemberInvites === true)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
}

/**
 * Why this community is invitable, from the cheap local read alone.
 *
 * `"policy"` means only "the stored record claims members may invite" — a claim
 * the caller must confirm against the fold before acting on it. Ownership needs
 * no confirmation and cannot go stale.
 */
export function inviteTargetReason(c: InviteTarget, myPubkey: string | null | undefined): InviteTargetReason | null {
  if (!myPubkey) return null;
  if (c.owner === myPubkey) return "owner";
  if (c.allowMemberInvites === true) return "policy";
  return null;
}

/** True when this entry may be minted from with no live check. Owner only. */
export function isTrustedInviteTarget(c: InviteTarget, myPubkey: string | null | undefined): boolean {
  return inviteTargetReason(c, myPubkey) === "owner";
}
