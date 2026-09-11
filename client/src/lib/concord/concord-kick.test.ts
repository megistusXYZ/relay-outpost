/**
 * A Kick (kind 3309, Guestbook) is how Armada and Vector remove someone: an
 * admin-signed directive naming its target, honored only if the signer holds
 * KICK and strictly outranks the target (CORD-02 §5, CORD-04 §6). We never read
 * it, so someone removed from another app stayed in our member list.
 */
import { describe, it, expect } from "vitest";
import { computeRoster, foldEditions, buildJoinLeaveRumor, buildKickRumor, serializePermissions, VSK, PERM, type ControlEdition } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), mod = hx("0b"), otherMod = hx("0c"), alice = hx("0d"), bob = hx("0e");
const ed = (vsk: number, eid: string, content: unknown, rumorId: string): ControlEdition =>
  ({ vsk, eid, ev: 1, rumorId, pubkey: owner, content: JSON.stringify(content) });
const state = foldEditions([
  ed(VSK.ROLE, hx("e1"), { role_id: "mod", name: "Moderator", position: 5, permissions: serializePermissions(PERM.KICK) }, "r1"),
  ed(VSK.GRANT, mod, { member: mod, role_ids: ["mod"] }, "r2"),
  ed(VSK.GRANT, otherMod, { member: otherMod, role_ids: ["mod"] }, "r3"),
], owner);
const joined = (pk: string, t: number) => buildJoinLeaveRumor(pk, true, t);
const kicked = (by: string, target: string, t: number) => buildKickRumor(by, target, t);
const ids = (roster: { pubkey: string }[]) => roster.map((m) => m.pubkey);
const everyone = [joined(mod, 100), joined(otherMod, 100), joined(alice, 100), joined(bob, 100)];

describe("a kick from another app", () => {
  it("is shaped as the spec's: admin-signed, naming its target", () => {
    const k = buildKickRumor(mod, alice, 200, 301);
    expect(k).toMatchObject({ kind: 3309, pubkey: mod, created_at: 200, content: "" });
    expect(k.tags).toEqual(expect.arrayContaining([["p", alice], ["ms", "301"]]));
  });

  it("a moderator's kick removes the member here too", () => {
    const roster = computeRoster(everyone, state, owner, [], [kicked(mod, alice, 200)]);
    expect(ids(roster)).not.toContain(alice);
    expect(ids(roster)).toContain(bob);
  });

  it("is ignored from someone without the permission, against the owner, or against an equal", () => {
    expect(ids(computeRoster(everyone, state, owner, [], [kicked(bob, alice, 200)]))).toContain(alice);
    expect(ids(computeRoster(everyone, state, owner, [], [kicked(mod, owner, 200)]))).toContain(owner);
    expect(ids(computeRoster(everyone, state, owner, [], [kicked(mod, otherMod, 200)]))).toContain(otherMod);
  });

  it("someone kicked who joins again is back", () => {
    const roster = computeRoster([...everyone, joined(alice, 300)], state, owner, [], [kicked(mod, alice, 200)]);
    expect(ids(roster)).toContain(alice);
  });
});
