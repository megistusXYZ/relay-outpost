/**
 * May this viewer mint an invite into this community?
 *
 * One expression, two hosts. An invite hands over `community_root` — read
 * access to every public channel at the current epoch — and NOTHING below the
 * UI re-checks it: `ConcordInviteDialog` asks no permission question, the
 * kind-33301 bundle is signed by a one-use ephemeral key so no relay can
 * attribute or refuse it, and the fold admits any non-banned joiner. This
 * function IS the enforcement, which is why it lives here with tests instead of
 * inline on whichever surface happens to draw the button.
 *
 * It must fail CLOSED while the governance fold is still loading. That is the
 * whole reason the owner check comes first: the owner is a string compare
 * against the local record and needs no fold, so the person who just created a
 * community can invite immediately, while everyone else waits for evidence.
 */
import { hasPermission, PERM, type Member, type FoldedState } from "./concord-events";
import { getRosterSnapshot } from "./concord-roster";
import type { StoredCommunity } from "./concord-keys";

export function canInviteToCommunity({ community, pubkey, myMember, govMetadata }: {
  community: StoredCommunity | null | undefined;
  pubkey: string | null | undefined;
  /** From `useConcordGovernance`. `undefined` until the fold seats this viewer. */
  myMember: Member | undefined;
  /** Live folded metadata, `undefined` before the fold arrives. */
  govMetadata: FoldedState["metadata"] | undefined;
}): boolean {
  if (!community || !pubkey) return false;
  // A — the owner, decided locally and synchronously. No fold, no I/O.
  if (pubkey === community.owner) return true;
  // B — an explicit grant.
  if (myMember && hasPermission(myMember, PERM.CREATE_INVITE)) return true;
  // C — the community opened invites to its members.
  // `&& !!myMember` — membership, not just policy. The fold drops a banned
  // pubkey from the roster, but that person's device keeps its record and its
  // community_root until a rekey reaches and applies there. Asking only "are
  // invites open?" is the shape of the authority bypass this project already
  // shipped once: validating a POLICY and treating it as if it validated
  // STANDING.
  return membersMayInvite(community, govMetadata) && !!myMember;
}

/**
 * Is this community's invite door open to ordinary members?
 *
 * POLICY ONLY — never standing. It answers "what does this community allow?",
 * not "may this person do it"; `canInviteToCommunity` above is the enforcement
 * and adds the membership check that keeps a banned device from acting on a
 * policy it can still read.
 *
 * Folded metadata wins the moment it exists, the same rule this codebase
 * already states for `name` and `about`. An owner CLOSING invites is the
 * direction that must propagate; letting a stale local `true` out-rank a live
 * `false` would make the one dangerous direction the one that fails open.
 *
 * Exported so the admin drawer can DISPLAY the policy the gate enforces. Two
 * copies of this precedence is how a screen and its enforcement drift apart —
 * and the screen is the one people would believe.
 */
export function membersMayInvite(
  community: StoredCommunity,
  govMetadata: FoldedState["metadata"] | undefined,
): boolean {
  return govMetadata
    ? govMetadata.allowMemberInvites === true
    : community.allowMemberInvites === true;
}

/**
 * Member pubkeys for an invite list / facepile.
 *
 * A fresh fold is just the owner, seated without a rumor, so `roster` reads as a
 * one-person community for the first moments of every mount. The persisted
 * snapshot covers that gap.
 */
export function rosterPubkeys(communityId: string, roster: Member[]): string[] {
  return roster.length >= 2 ? roster.map((m) => m.pubkey) : (getRosterSnapshot(communityId) ?? []);
}
