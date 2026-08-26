import { PERM, OWNER_POSITION, hasPermission, type Member } from "@/lib/concord/concord-events";
import { isGroupModerator } from "@/lib/admission-queue";
import type { GroupAdmin } from "@/lib/nip29";

/**
 * What this account may do in THIS space — one answer shape over two genuinely
 * different governance models.
 *
 * The app runs two: encrypted Concord communities (the default) and relay-based
 * NIP-29 rooms (the Chat tab files these under "Legacy rooms"). Every moderation
 * action already exists for both — sendRemoveUser/sendPutUser/sendEditMetadata on
 * one side, the governance fold on the other — but they are reached through
 * different menus, and the complete set only exists in the Relay Ops console,
 * which is a different page on a different mental model.
 *
 * A single drawer needs a single question — "may I do X here?" — without
 * pretending the two systems are alike, because they are not:
 *
 *   Concord   nine permission bits plus a rank hierarchy. The owner is supreme,
 *             and CORD-04 says an actor may act on a target only if it strictly
 *             outranks it. A moderator can hold KICK but not MANAGE_METADATA.
 *   NIP-29    ONE bit. You are in the kind-39001 admins list or you are not.
 *             Relay-defined role names ride along on that tag, but they carry no
 *             portable meaning, so the app cannot honestly read authority from
 *             them.
 *
 * So this deliberately does NOT invent granularity NIP-29 lacks, and does not
 * flatten Concord's nine into NIP-29's one. It reports each capability
 * separately, and each backend answers however it actually knows.
 *
 * Pure. No relay, no React — the rules about who may do what are the part worth
 * testing, and testing them needed a live relay in every previous attempt.
 */
export interface SpaceCapabilities {
  /** Rename the space, change its description or picture. */
  editMetadata: boolean;
  /** Remove or ban a member. */
  manageMembers: boolean;
  /** Mint an invite. */
  invite: boolean;
  /** Delete somebody else's message. */
  removeMessages: boolean;
  /** Create/rename/delete channels WITHIN the space. Concord-only concept. */
  manageChannels: boolean;
  /** Read the moderation history. */
  viewAuditLog: boolean;
  /**
   * End the space entirely. The most destructive thing here, and the one where
   * the two models differ most — see concordCapabilities/nip29Capabilities.
   */
  dissolve: boolean;
}

export const NO_CAPABILITIES: SpaceCapabilities = {
  editMetadata: false,
  manageMembers: false,
  invite: false,
  removeMessages: false,
  manageChannels: false,
  viewAuditLog: false,
  dissolve: false,
};

/**
 * Concord: read the member's actual permission bits.
 *
 * `hasPermission` already short-circuits for the owner, so this needs no special
 * case except `dissolve` — ending the community is owner-only by design, and
 * there is no PERM bit for it precisely because it is not delegable.
 *
 * A member the fold has not resolved yet (null) gets nothing. Absence of
 * evidence is not authority, and a drawer that flashes admin controls while
 * state loads is worse than one that fills in a beat later.
 */
export function concordCapabilities(member: Member | null | undefined): SpaceCapabilities {
  if (!member) return NO_CAPABILITIES;
  return {
    editMetadata: hasPermission(member, PERM.MANAGE_METADATA),
    manageMembers: hasPermission(member, PERM.KICK) || hasPermission(member, PERM.BAN),
    invite: hasPermission(member, PERM.CREATE_INVITE),
    removeMessages: hasPermission(member, PERM.MANAGE_MESSAGES),
    manageChannels: hasPermission(member, PERM.MANAGE_CHANNELS),
    viewAuditLog: hasPermission(member, PERM.VIEW_AUDIT_LOG),
    dissolve: member.rank === OWNER_POSITION,
  };
}

/**
 * NIP-29: one bit, honestly reported as one bit.
 *
 * Being in the kind-39001 list is the whole of the model, so an admin gets
 * everything the protocol offers and a non-admin gets nothing. Two exceptions,
 * both because the capability does not exist rather than because it is withheld:
 *
 *  - `manageChannels` is always false. A NIP-29 group IS the room; there are no
 *    channels inside it to manage. Reporting `true` would put a control in the
 *    drawer with nothing behind it.
 *  - `dissolve` is true for any admin, which is worth stating out loud because
 *    it differs from Concord's owner-only rule. NIP-29 has no owner or rank, so
 *    the app CANNOT distinguish the founder from someone added as a moderator
 *    last week — and inventing that distinction would be a lie about who holds
 *    authority. What the drawer does instead is tell the truth on screen: it
 *    calls the deletion a REQUEST — "Asks the relay to delete this room for
 *    everyone. If the relay declines, it stays." That is the compensation. Not
 *    a fake hierarchy, and not a friction step.
 *
 *    (Twice now this paragraph has described a mechanism nobody built — first
 *    "typed confirmation", then "a two-step inline reveal before the confirm
 *    dialog". Neither ever existed; the section is one link. Both were deleted
 *    rather than implemented, because building a control to make a comment true
 *    is the tail wagging the dog. If you are tempted to add a third, add the
 *    friction first and describe it after.)
 */
export function nip29Capabilities(
  admins: GroupAdmin[] | null | undefined,
  myPubkey: string | null | undefined,
): SpaceCapabilities {
  if (!isGroupModerator(admins, myPubkey)) return NO_CAPABILITIES;
  return {
    editMetadata: true,
    manageMembers: true,
    invite: true,
    removeMessages: true,
    manageChannels: false,
    viewAuditLog: true,
    dissolve: true,
  };
}

/** Does this account have ANY reason to see the drawer at all? */
export function hasAnyCapability(caps: SpaceCapabilities): boolean {
  return Object.values(caps).some(Boolean);
}

/**
 * Whether the drawer should warn that an action cannot be undone by the app.
 *
 * Concord can rekey and re-admit; a NIP-29 delete asks a relay to forget
 * something and there is no counter-event that restores it. The wording a
 * destructive confirm uses should follow the truth, not a house style.
 */
export function isReversible(backend: SpaceBackend, action: "dissolve" | "removeMessage" | "removeMember"): boolean {
  if (backend === "concord") return action !== "dissolve";
  // NIP-29: a removed member can be re-added, but a deleted event is gone and a
  // deleted group is gone.
  return action === "removeMember";
}

export type SpaceBackend = "concord" | "nip29";
