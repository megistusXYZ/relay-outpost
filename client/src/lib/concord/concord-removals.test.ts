/**
 * "X was removed" lines in the room. Our own removals wrote only our audit
 * record (kind 3314), so a removal made in Armada or Vector (a 3309 Kick)
 * showed nothing. Now our removals send a Kick too, so one removal from this
 * app must still show once.
 */
import { describe, it, expect } from "vitest";
import { removalSystemEvents } from "./concord-activity";
import { foldEditions, buildKickRumor, serializePermissions, VSK, PERM, type ControlEdition, type AuditEntry } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const owner = hx("0a"), mod = hx("0b"), alice = hx("0d"), bob = hx("0e");
const ed = (vsk: number, eid: string, content: unknown, rumorId: string): ControlEdition =>
  ({ vsk, eid, ev: 1, rumorId, pubkey: owner, content: JSON.stringify(content) });
const state = foldEditions([
  ed(VSK.ROLE, hx("e1"), { role_id: "mod", name: "Moderator", position: 5, permissions: serializePermissions(PERM.KICK) }, "r1"),
  ed(VSK.GRANT, mod, { member: mod, role_ids: ["mod"] }, "r2"),
], owner);
const audit = (action: "kick" | "ban", target: string, t: number): AuditEntry => ({ id: `${action}-${t}`, actor: owner, action, target, t });

describe("who was removed, as the room shows it", () => {
  it("a kick from another app shows as a removal line for its target", () => {
    expect(removalSystemEvents([], [buildKickRumor(mod, alice, 200)], state, owner)).toEqual([{ pubkey: alice, action: "kick", t: 200_000 }]);
  });

  it("a kick nobody was allowed to make shows nothing", () => {
    expect(removalSystemEvents([], [buildKickRumor(bob, alice, 200)], state, owner)).toEqual([]);
  });

  it("one removal from this app, which records it and sends a kick, shows once", () => {
    expect(removalSystemEvents([audit("kick", alice, 200)], [buildKickRumor(owner, alice, 200)], state, owner)).toHaveLength(1);
  });

  it("a ban keeps its own line", () => {
    expect(removalSystemEvents([audit("ban", bob, 300)], [], state, owner)).toEqual([{ pubkey: bob, action: "ban", t: 300_000 }]);
  });
});
