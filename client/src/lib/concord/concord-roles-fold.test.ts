/**
 * Roles and their authority (CORD-04 §2–§3). Position orders authority, lower
 * is higher; the owner is position 0 and never a Role. Every role edit must be
 * signed by someone who strictly outranks both the position it claims and the
 * role as it stands. A group carries at most 100 Roles: the 100 lowest ids.
 */
import { describe, it, expect } from "vitest";
import { foldEditions, computeEditionId, serializePermissions, VSK, PERM, ADMIN_ROLE_ID, type ControlEdition } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), mod = hx("0b");
const roleContent = (id: string, position: number, perms: bigint) =>
  JSON.stringify({ role_id: id, name: "Role", position, permissions: serializePermissions(perms), scope: { kind: "server" } });
const role = (id: string, position: number, perms: bigint, by = owner, ev = 1, ep?: string): ControlEdition =>
  ({ vsk: VSK.ROLE, eid: id, ev, ...(ep ? { ep } : {}), rumorId: `r-${id.slice(0, 6)}-${ev}-${by.slice(0, 4)}`, pubkey: by, content: roleContent(id, position, perms) });

describe("roles and who may change them", () => {
  it("no role may sit at position 0, not even one the owner signs", () => {
    expect(foldEditions([role(hx("e1"), 0, PERM.KICK)], owner).roles.has(hx("e1"))).toBe(false);
  });

  it("a moderator can't move the Admin role below themselves", () => {
    const modRole = hx("e2");
    const adminV1 = role(ADMIN_ROLE_ID, 1, PERM.BAN);
    const adminV1Hash = computeEditionId(ADMIN_ROLE_ID, 1, undefined, adminV1.content);
    const state = foldEditions([
      adminV1,
      role(modRole, 5, PERM.MANAGE_ROLES),
      { vsk: VSK.GRANT, eid: mod, ev: 1, rumorId: "g1", pubkey: owner, content: JSON.stringify({ member: mod, role_ids: [modRole] }) },
      role(ADMIN_ROLE_ID, 10, PERM.BAN, mod, 2, adminV1Hash),
    ], owner);
    expect(state.roles.get(ADMIN_ROLE_ID)?.position).toBe(1);
  });

  it("a group carries at most 100 roles: the 100 lowest ids", () => {
    const ids = Array.from({ length: 101 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
    const state = foldEditions(ids.map((id) => role(id, 2, PERM.KICK)), owner);
    expect(state.roles.size).toBe(100);
    expect(state.roles.has(ids[100])).toBe(false);
    expect(state.roles.has(ids[0])).toBe(true);
  });
});
