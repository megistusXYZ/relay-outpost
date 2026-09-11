/**
 * Groups made before "Pin messages" joined the Admin role still have an Admin
 * role without it (and without any bit added since). The owner's device brings
 * that role up to date once — only while it's the untouched original, so an
 * owner who edited the role keeps their choices — and only ever adds bits.
 */
import { describe, it, expect } from "vitest";
import { adminRoleCatchUp } from "./concord-roles";
import { foldEditions, computeEditionId, VSK, PERM, ADMIN_ROLE_ID, type ControlEdition } from "./concord-events";

const OWNER = "0".repeat(64), OTHER = "a".repeat(64);
const WANTED = PERM.KICK | PERM.BAN | PERM.PIN_MESSAGES;
const OLD = PERM.KICK | PERM.BAN;

let rid = 0;
const roleEd = (permissions: bigint, ev = 1, ep?: string): ControlEdition => ({
  vsk: VSK.ROLE, eid: ADMIN_ROLE_ID, ev, ...(ep ? { ep } : {}), pubkey: OWNER, rumorId: String(++rid).padStart(64, "0"),
  content: JSON.stringify({ role_id: ADMIN_ROLE_ID, name: "Admin", position: 1, permissions: String(permissions), scope: { kind: "server" }, color: 7 }),
});
const hashOf = (e: ControlEdition) => computeEditionId(e.eid, e.ev, e.ep, e.content);

describe("bringing an old group's Admin role up to date", () => {
  it("the owner's untouched Admin role gains what's missing, as its next version", () => {
    const v1 = roleEd(OLD);
    const out = adminRoleCatchUp(foldEditions([v1], OWNER), OWNER, OWNER, WANTED);
    expect(out).not.toBeNull();
    expect(out!.version).toBe(2);
    expect(out!.prevHash).toBe(hashOf(v1));
    expect(BigInt(out!.content.permissions)).toBe(OLD | PERM.PIN_MESSAGES);
    expect(out!.content).toMatchObject({ role_id: ADMIN_ROLE_ID, name: "Admin", position: 1, color: 7 });
  });

  it("keeps bits the role already had beyond the current set", () => {
    const out = adminRoleCatchUp(foldEditions([roleEd(OLD | PERM.MANAGE_ROLES)], OWNER), OWNER, OWNER, WANTED);
    expect(BigInt(out!.content.permissions)).toBe(OLD | PERM.MANAGE_ROLES | PERM.PIN_MESSAGES);
  });

  it("only the owner's device does it", () => {
    expect(adminRoleCatchUp(foldEditions([roleEd(OLD)], OWNER), OWNER, OTHER, WANTED)).toBeNull();
  });

  it("nothing to do when the role already has everything", () => {
    expect(adminRoleCatchUp(foldEditions([roleEd(WANTED)], OWNER), OWNER, OWNER, WANTED)).toBeNull();
  });

  it("an Admin role the owner has edited keeps their choices", () => {
    const v1 = roleEd(OLD);
    const v2 = roleEd(PERM.KICK, 2, hashOf(v1));
    expect(adminRoleCatchUp(foldEditions([v1, v2], OWNER), OWNER, OWNER, WANTED)).toBeNull();
  });

  it("no Admin role, nothing to catch up", () => {
    expect(adminRoleCatchUp(foldEditions([], OWNER), OWNER, OWNER, WANTED)).toBeNull();
  });
});
