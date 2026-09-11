/**
 * Custom roles (CORD-04 §2–§3): a named bundle of permissions at a position,
 * lower ranking higher. People choose permissions in plain words; a role only
 * ever lands below the person making it; handing one out takes Manage roles and
 * strictly outranking it. The first grant that makes someone staff carries the
 * admin plane's key.
 */
import { describe, it, expect } from "vitest";
import { roleContent, nextRoleEdition, newRolePosition, rolesAfter, becomesStaff, withChoices, grantableRoles, MODERATOR_PRESET, ROLE_PERMISSION_CHOICES } from "./concord-roles";
import { foldEditions, serializePermissions, VSK, PERM, type ControlEdition, type Role } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), mod = hx("0b"), member = hx("0c");
const r = (id: string, position: number, permissions: bigint): Role => ({ role_id: id, name: id.slice(0, 4), position, permissions, scope: { kind: "server" } });

describe("a role as written", () => {
  it("carries its permissions as a decimal string and a server scope", () => {
    const c = roleContent({ roleId: hx("e1"), name: "  Moderator ", position: 2, permissions: PERM.KICK | PERM.PIN_MESSAGES, color: 15158332 });
    expect(c).toEqual({ role_id: hx("e1"), name: "Moderator", position: 2, permissions: String(PERM.KICK | PERM.PIN_MESSAGES), scope: { kind: "server" }, color: 15158332 });
  });

  it("refuses an empty name, or one over 64 bytes", () => {
    expect(() => roleContent({ roleId: hx("e1"), name: "  ", position: 2, permissions: 0n })).toThrow();
    expect(() => roleContent({ roleId: hx("e1"), name: "é".repeat(33), position: 2, permissions: 0n })).toThrow();
  });

  it("an edit chains onto the role's current version", () => {
    const content = roleContent({ roleId: hx("e1"), name: "Mods", position: 2, permissions: PERM.KICK });
    expect(nextRoleEdition(hx("e1"), { ev: 2, hash: hx("a2") }, content)).toMatchObject({ version: 3, prevHash: hx("a2") });
    expect(nextRoleEdition(hx("e1"), undefined, content)).toMatchObject({ version: 1 });
  });
});

describe("where a new role goes", () => {
  it("below every role there is, and never at or above its maker", () => {
    const roles = [r(hx("e1"), 1, 0n), r(hx("e2"), 5, 0n)];
    expect(newRolePosition(roles, 0)).toBe(6);
    expect(newRolePosition(roles, 5)).toBe(6);
    expect(newRolePosition(roles, 7)).toBe(8);
    expect(newRolePosition([], 0)).toBe(1);
  });
});

describe("giving and taking roles", () => {
  it("adds and removes one role, keeping the rest; nobody holds more than 64", () => {
    expect(rolesAfter(["a"], { add: "b" })).toEqual(["a", "b"]);
    expect(rolesAfter(["a", "b"], { add: "b" })).toEqual(["a", "b"]);
    expect(rolesAfter(["a", "b"], { remove: "a" })).toEqual(["b"]);
    const many = Array.from({ length: 64 }, (_, i) => `r${i}`);
    expect(() => rolesAfter(many, { add: "one-more" })).toThrow();
  });

  it("the grant that first makes someone staff is the one that carries the admin key", () => {
    const roles = new Map([[hx("e1"), r(hx("e1"), 1, PERM.BAN)], [hx("e2"), r(hx("e2"), 3, PERM.PIN_MESSAGES)], [hx("e3"), r(hx("e3"), 4, PERM.KICK)]]);
    expect(becomesStaff([], [hx("e2")], roles)).toBe(true);
    expect(becomesStaff([hx("e1")], [hx("e1"), hx("e2")], roles)).toBe(false); // already staff
    expect(becomesStaff([], [hx("e3")], roles)).toBe(false); // KICK alone isn't staff
  });
});

describe("choosing permissions in plain words", () => {
  it("offers only what this app acts on, and keeps what another app set", () => {
    expect(ROLE_PERMISSION_CHOICES.some((c) => c.bit === PERM.MANAGE_MESSAGES)).toBe(false);
    const fromElsewhere = PERM.MANAGE_MESSAGES | PERM.KICK;
    expect(withChoices(fromElsewhere, [PERM.BAN])).toBe(PERM.MANAGE_MESSAGES | PERM.BAN);
  });

  it("the Moderator preset removes people, pins messages and sees the activity log", () => {
    expect(MODERATOR_PRESET).toEqual({ name: "Moderator", permissions: PERM.KICK | PERM.PIN_MESSAGES | PERM.VIEW_AUDIT_LOG });
  });
});

describe("which roles someone can hand out", () => {
  const byOwner = (vsk: number, eid: string, content: unknown, rumorId: string): ControlEdition =>
    ({ vsk, eid, ev: 1, rumorId, pubkey: owner, content: JSON.stringify(content) });
  const role = (id: string, position: number, perms: bigint) =>
    byOwner(VSK.ROLE, id, { role_id: id, name: "x", position, permissions: serializePermissions(perms), scope: { kind: "server" } }, `r${id.slice(0, 4)}`);
  const state = foldEditions([
    role(hx("e1"), 1, PERM.BAN),
    role(hx("e5"), 5, PERM.MANAGE_ROLES),
    role(hx("e7"), 7, PERM.KICK),
    byOwner(VSK.GRANT, mod, { member: mod, role_ids: [hx("e5")] }, "g1"),
  ], owner);

  it("the owner any; someone with Manage roles only those below them; others none", () => {
    expect(grantableRoles(state, owner, owner).map((x) => x.role_id).sort()).toEqual([hx("e1"), hx("e5"), hx("e7")].sort());
    expect(grantableRoles(state, owner, mod).map((x) => x.role_id)).toEqual([hx("e7")]);
    expect(grantableRoles(state, owner, member)).toEqual([]);
  });
});
