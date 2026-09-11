/**
 * Who may change a room's pins (CORD-04 §7): pinning is curation, gated by
 * PIN_MESSAGES like any edition. The fold used to refuse every edition kind it
 * didn't know from anyone but the owner, so an admin's pin would have vanished.
 */
import { describe, it, expect } from "vitest";
import { foldEditions, serializePermissions, hasPermissionBit, VSK, PERM, type ControlEdition } from "./concord-events";
import { ADMIN_PERMS } from "./concord-governance";
import { pinsLocator } from "./concord-pins";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), mod = hx("0b"), member = hx("0c"), cid = hx("c1"), room = hx("c3");
const eid = pinsLocator(cid, room);
const byOwner = (vsk: number, id: string, content: unknown, rumorId: string): ControlEdition =>
  ({ vsk, eid: id, ev: 1, rumorId, pubkey: owner, content: JSON.stringify(content) });
const roles = [
  byOwner(VSK.ROLE, hx("e1"), { role_id: "mod", name: "Moderator", position: 5, permissions: serializePermissions(PERM.PIN_MESSAGES) }, "r1"),
  byOwner(VSK.GRANT, mod, { member: mod, role_ids: ["mod"] }, "r2"),
];
const pinsBy = (pubkey: string): ControlEdition => ({ vsk: VSK.PINS, eid, ev: 1, rumorId: "p1", pubkey, content: '{"entries":[]}' });

describe("who may change a room's pins", () => {
  it("someone with Pin messages may; a member without it may not", () => {
    expect(foldEditions([...roles, pinsBy(mod)], owner).pinLists.get(eid)).toBe('{"entries":[]}');
    expect(foldEditions([...roles, pinsBy(member)], owner).pinLists.get(eid)).toBeUndefined();
  });

  it("the built-in Admin role can pin", () => {
    expect(hasPermissionBit(ADMIN_PERMS, PERM.PIN_MESSAGES)).toBe(true);
  });
});
