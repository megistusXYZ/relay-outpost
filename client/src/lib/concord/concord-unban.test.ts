/**
 * Lifting a ban (CORD-04 §4). The Banlist is one list, "replaced entire on
 * every edit", so an unban is simply the next version without that person.
 * What made it impossible here was our own fork-healing: every new ban
 * republished the union of every banlist ever seen, so anyone unbanned would
 * have been quietly banned again by the next ban anyone made.
 *
 * The rule now: a name dropped by a later edition on the winning edition's own
 * chain was lifted on purpose and stays off; a name only in a losing sibling of
 * a fork is a dropped ban, and is still healed back.
 */
import { describe, it, expect } from "vitest";
import { nextBanlistEdition, nextUnbanEdition, BANLIST_EID } from "./concord-banlist";
import { foldEditions, computeEditionId, VSK, type ControlEdition } from "./concord-events";

const hx = (b: string) => b.repeat(32);
const OWNER = hx("0a"), BOB = hx("33"), CAROL = hx("44"), DAVE = hx("55");

/** A banlist edition as the owner publishes it, chained onto `prev`. */
function banlist(ev: number, names: string[], rumorId: string, prev?: { hash: string }) {
  const content = JSON.stringify(names);
  const edition: ControlEdition = { vsk: VSK.BANLIST, eid: BANLIST_EID, ev, ...(prev ? { ep: prev.hash } : {}), rumorId, pubkey: OWNER, content };
  return { edition, hash: computeEditionId(BANLIST_EID, ev, prev?.hash, content) };
}

describe("lifting a ban", () => {
  it("publishes the list without them, one version past the head", () => {
    const next = nextUnbanEdition(BOB, [BOB, CAROL], { ev: 2, hash: hx("a2") }, undefined);
    expect(next).toMatchObject({ version: 3, prevHash: hx("a2"), banlist: [CAROL] });
  });

  it("stays lifted: the next ban anyone makes does not bring them back", () => {
    const v1 = banlist(1, [BOB], "r1");
    const v2 = banlist(2, [BOB, CAROL], "r2", v1);
    const v3 = banlist(3, [CAROL], "r3", v2); // Bob unbanned
    const state = foldEditions([v1.edition, v2.edition, v3.edition], OWNER);
    expect([...state.banlist]).toEqual([CAROL]);
    const next = nextBanlistEdition(DAVE, state.banlistSeen, state.heads.get(`${VSK.BANLIST}:${BANLIST_EID}`), undefined);
    expect(next.banlist).toEqual([CAROL, DAVE].sort());
  });

  it("a ban lost to a fork is still healed back by the next ban", () => {
    const v1 = banlist(1, [BOB], "r1");
    const left = banlist(2, [BOB, CAROL], "r2a", v1);
    const right = banlist(2, [BOB, DAVE], "r2b", v1);
    const state = foldEditions([v1.edition, left.edition, right.edition], OWNER);
    expect(state.banlistSeen).toEqual(new Set([BOB, CAROL, DAVE]));
  });
});
