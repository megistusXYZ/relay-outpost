/**
 * Custom roles (CORD-04 §2–§3).
 *
 * A Role is a named bundle of permissions at a position, lower ranking higher;
 * the owner is position 0 and never a Role. Granting one hands a member rank,
 * never a secret, except that the grant which first makes someone staff also
 * carries the admin plane's key. Every change must be made by someone who
 * strictly outranks what it touches, and a role only ever lands below its maker.
 *
 * Pure: shaping roles, where a new one goes, what a member holds after a change,
 * the permission choices people see. Publishing lives in concord-governance.
 */
import {
  PERM, STAFF_PERMS, memberPermissions, hasPermissionBit, canActOn, serializePermissions, computeEditionId,
  type FoldedState, type Role,
} from "./concord-events";

/** CORD-04 §2 limits. */
export const ROLE_NAME_MAX_BYTES = 64;
export const MEMBER_ROLE_CAP = 64;

/** A Role edition's content, as the spec shapes it. */
export type RoleContent = {
  role_id: string; name: string; position: number; permissions: string;
  scope: { kind: "server" }; color?: number;
};

export function roleContent(r: { roleId: string; name: string; position: number; permissions: bigint; color?: number }): RoleContent {
  const name = r.name.trim();
  if (!name) throw new Error("A role needs a name.");
  if (new TextEncoder().encode(name).length > ROLE_NAME_MAX_BYTES) throw new Error("That name is too long.");
  if (!Number.isInteger(r.position) || r.position < 1) throw new Error("No role can sit at the owner's position.");
  return {
    role_id: r.roleId, name, position: r.position,
    // A decimal string: a JSON number corrupts past 2^53 (CORD-04 §3).
    permissions: serializePermissions(r.permissions),
    scope: { kind: "server" },
    ...(r.color !== undefined ? { color: r.color } : {}),
  };
}

/** A role's next edition: version 1 for a new role, else one past its head. */
export function nextRoleEdition(roleId: string, head: { ev: number; hash: string } | undefined, content: RoleContent) {
  const version = head ? head.ev + 1 : 1;
  const prevHash = head?.hash;
  return { version, prevHash, content, eid: computeEditionId(roleId, version, prevHash, JSON.stringify(content)) };
}

/**
 * Where a new role goes: below every role there is, and never at or above the
 * person making it ("no edition may claim a position at or above its own
 * signer").
 */
export function newRolePosition(roles: Pick<Role, "position">[], makerRank: number): number {
  return Math.max(makerRank + 1, 1, ...roles.map((r) => r.position + 1));
}

/** A member's roles after giving or taking one; the rest stay as they are. */
export function rolesAfter(current: string[], change: { add: string } | { remove: string }): string[] {
  if ("remove" in change) return current.filter((id) => id !== change.remove);
  if (current.includes(change.add)) return [...current];
  if (current.length >= MEMBER_ROLE_CAP) throw new Error("Someone can hold at most 64 roles.");
  return [...current, change.add];
}

/** Does this change make the member staff for the first time? That grant carries the admin plane's key. */
export function becomesStaff(before: string[], after: string[], roles: Map<string, Role>): boolean {
  const staff = (ids: string[]) => (memberPermissions(ids, roles) & STAFF_PERMS) !== 0n;
  return !staff(before) && staff(after);
}

/**
 * What people choose from, in plain words: only the permissions this app acts
 * on. Bits it doesn't offer (another app's "delete others' messages", say) are
 * never shown and never dropped.
 */
export const ROLE_PERMISSION_CHOICES: { bit: bigint; label: string; detail: string }[] = [
  { bit: PERM.KICK, label: "Remove people", detail: "They can be invited back." },
  { bit: PERM.BAN, label: "Ban people", detail: "Remove someone and keep them out." },
  { bit: PERM.PIN_MESSAGES, label: "Pin messages", detail: "Pin and unpin messages in rooms." },
  { bit: PERM.MANAGE_CHANNELS, label: "Create and edit rooms", detail: "Add, rename and delete rooms." },
  { bit: PERM.CREATE_INVITE, label: "Invite people", detail: "Even when only admins can invite." },
  { bit: PERM.MANAGE_METADATA, label: "Edit the group", detail: "Its name, picture, description and settings." },
  { bit: PERM.VIEW_AUDIT_LOG, label: "See the activity log", detail: "Who joined, left, was removed or banned." },
  { bit: PERM.MANAGE_ROLES, label: "Manage roles", detail: "Make roles and give people roles below their own." },
];

/** A role's permissions after choosing from the offered ones: the unoffered bits carried as they were. */
export function withChoices(existing: bigint, chosen: bigint[]): bigint {
  const offered = ROLE_PERMISSION_CHOICES.reduce((acc, c) => acc | c.bit, 0n);
  return (existing & ~offered) | chosen.reduce((acc, b) => acc | b, 0n);
}

/** A ready-made role: keeps the peace without running the place. */
export const MODERATOR_PRESET = { name: "Moderator", permissions: PERM.KICK | PERM.PIN_MESSAGES | PERM.VIEW_AUDIT_LOG };

/**
 * The roles someone may hand out: any, for the owner; for anyone else, only
 * with Manage roles and only roles they strictly outrank. In the spec's display
 * order: by position, then by id.
 */
export function grantableRoles(state: Pick<FoldedState, "roles" | "grants">, ownerPubkey: string, actor: string): Role[] {
  const all = [...state.roles.values()].sort((a, b) => a.position - b.position || (a.role_id < b.role_id ? -1 : 1));
  if (actor === ownerPubkey) return all;
  const held = state.grants.get(actor) ?? [];
  if (!hasPermissionBit(memberPermissions(held, state.roles), PERM.MANAGE_ROLES)) return [];
  const rank = held.reduce((min, id) => Math.min(min, state.roles.get(id)?.position ?? Infinity), Infinity);
  return all.filter((r) => canActOn(rank, r.position));
}
