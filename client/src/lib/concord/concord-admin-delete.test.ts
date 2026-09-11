/**
 * Who may delete a message (CORD-04 §5: the actor holds the action's bit and
 * strictly outranks its target, here the message's author; MANAGE_MESSAGES
 * writes to Chat planes, §3). Before this, only a message's own author could.
 */
import { describe, it, expect } from "vitest";
import { mayDelete, foldEditions, VSK, PERM, type ControlEdition } from "./concord-events";

const hex = (c: string) => c.repeat(64);
const OWNER = hex("0"), MOD = hex("1"), PEER_MOD = hex("2"), HELPER = hex("3"), ANN = hex("a"), BEN = hex("b");
const MOD_ROLE = hex("d"), HELPER_ROLE = hex("e");

let rid = 0;
const ed = (vsk: number, eid: string, content: unknown): ControlEdition =>
  ({ vsk, eid, ev: 1, content: JSON.stringify(content), rumorId: String(++rid).padStart(64, "0"), pubkey: OWNER });
const state = foldEditions([
  ed(VSK.ROLE, MOD_ROLE, { role_id: MOD_ROLE, name: "Moderator", position: 2, permissions: String(PERM.MANAGE_MESSAGES), scope: { kind: "server" } }),
  ed(VSK.ROLE, HELPER_ROLE, { role_id: HELPER_ROLE, name: "Helper", position: 3, permissions: String(PERM.KICK), scope: { kind: "server" } }),
  ed(VSK.GRANT, MOD, { member: MOD, role_ids: [MOD_ROLE] }),
  ed(VSK.GRANT, PEER_MOD, { member: PEER_MOD, role_ids: [MOD_ROLE] }),
  ed(VSK.GRANT, HELPER, { member: HELPER, role_ids: [HELPER_ROLE] }),
], OWNER);

describe("who may delete a message (CORD-04 §5)", () => {
  it("anyone may delete their own", () => {
    expect(mayDelete(ANN, ANN, state, OWNER)).toBe(true);
  });

  it("the owner may delete anyone's, and nobody may delete the owner's", () => {
    expect(mayDelete(OWNER, ANN, state, OWNER)).toBe(true);
    expect(mayDelete(OWNER, MOD, state, OWNER)).toBe(true);
    expect(mayDelete(MOD, OWNER, state, OWNER)).toBe(false);
  });

  it("a moderator with Delete messages may delete a member's", () => {
    expect(mayDelete(MOD, ANN, state, OWNER)).toBe(true);
    expect(mayDelete(MOD, HELPER, state, OWNER)).toBe(true);
  });

  it("but not the message of someone at their own rank", () => {
    expect(mayDelete(MOD, PEER_MOD, state, OWNER)).toBe(false);
  });

  it("a moderator without Delete messages may not", () => {
    expect(mayDelete(HELPER, ANN, state, OWNER)).toBe(false);
  });

  it("a member may not delete someone else's", () => {
    expect(mayDelete(ANN, BEN, state, OWNER)).toBe(false);
  });
});
