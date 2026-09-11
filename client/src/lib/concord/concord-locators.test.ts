/**
 * Grants and the Banlist live at the spec's derived coordinates (CORD-02 A.6,
 * CORD-04 §1): `grant_locator(community_id, member)` and
 * `banlist_locator(community_id)`. Ours used the member's pubkey and a fixed
 * `"ba"×32`, so other apps never saw our roles or bans. Reads take both; where
 * both exist, the spec's address wins, whatever order they arrived in.
 */
import { describe, it, expect } from "vitest";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { grantLocator, banlistLocator, inviteLinksLocator } from "./concord-locators";
import { concatBytes } from "./concord-crypto";
import { foldEditions, computeEditionId, VSK, type ControlEdition } from "./concord-events";
import { BANLIST_EID } from "./concord-banlist";

const hex = (c: string) => c.repeat(64);
const CID = hex("c"), OWNER = hex("0"), ALICE = hex("a"), BOB = hex("b");
const MOD = hex("e"), ADMIN = "ad".repeat(32);

let rid = 0;
const edition = (vsk: number, eid: string, content: unknown, ev = 1, ep?: string): ControlEdition =>
  ({ vsk, eid, ev, ...(ep ? { ep } : {}), content: JSON.stringify(content), rumorId: String(++rid).padStart(64, "0"), pubkey: OWNER });
const hashOf = (e: ControlEdition) => computeEditionId(e.eid, e.ev, e.ep, e.content);
const roleEd = (id: string, position: number) =>
  edition(VSK.ROLE, id, { role_id: id, name: id.slice(0, 3), position, permissions: "8", scope: { kind: "server" } });

describe("the derived coordinates (CORD-02 A.6)", () => {
  const derive = (label: string, id: string) =>
    bytesToHex(hkdf(sha256, hexToBytes(CID), undefined, concatBytes(utf8ToBytes(label), new Uint8Array([0]), hexToBytes(id)), 32));

  it("a Grant's coordinate is derived from the group and the member", () => {
    expect(grantLocator(CID, ALICE)).toBe(derive("concord/grant", ALICE));
    expect(grantLocator(CID, ALICE)).not.toBe(grantLocator(CID, BOB));
    expect(grantLocator(CID, ALICE)).not.toBe(ALICE);
  });

  it("a creator's invite Registry lives at a coordinate bound to them (CORD-05 §5)", () => {
    expect(inviteLinksLocator(CID, ALICE)).toBe(derive("concord/invite-links", ALICE));
    expect(inviteLinksLocator(CID, ALICE)).not.toBe(inviteLinksLocator(CID, BOB));
    expect(inviteLinksLocator(CID, ALICE)).not.toBe(grantLocator(CID, ALICE));
  });

  it("the Banlist's coordinate is derived from the group alone", () => {
    expect(banlistLocator(CID)).toBe(derive("concord/banlist", hex("0")));
    expect(banlistLocator(CID)).not.toBe(banlistLocator(hex("d")));
    expect(banlistLocator(CID)).not.toBe(BANLIST_EID);
  });
});

describe("reading grants at either address", () => {
  const roles = [roleEd(ADMIN, 1), roleEd(MOD, 2)];

  it("a grant at the spec's address is read", () => {
    const state = foldEditions([...roles, edition(VSK.GRANT, grantLocator(CID, ALICE), { member: ALICE, role_ids: [MOD] })], OWNER, CID);
    expect(state.grants.get(ALICE)).toEqual([MOD]);
  });

  it("where a member has both, the spec's address wins, in either order", () => {
    const legacy = edition(VSK.GRANT, ALICE, { member: ALICE, role_ids: [ADMIN] }, 1);
    const spec = edition(VSK.GRANT, grantLocator(CID, ALICE), { member: ALICE, role_ids: [MOD] });
    expect(foldEditions([...roles, legacy, spec], OWNER, CID).grants.get(ALICE)).toEqual([MOD]);
    expect(foldEditions([...roles, spec, legacy], OWNER, CID).grants.get(ALICE)).toEqual([MOD]);
  });

  it("a revoke at the spec's address takes the member's roles away even if an old grant remains", () => {
    const legacy = edition(VSK.GRANT, ALICE, { member: ALICE, role_ids: [ADMIN] });
    const revoke = edition(VSK.GRANT, grantLocator(CID, ALICE), { member: ALICE, role_ids: [] });
    expect(foldEditions([...roles, legacy, revoke], OWNER, CID).grants.has(ALICE)).toBe(false);
  });

  it("a grant at an address that belongs to nobody is ignored once the group is known", () => {
    const stray = edition(VSK.GRANT, hex("9"), { member: ALICE, role_ids: [MOD] });
    expect(foldEditions([...roles, stray], OWNER, CID).grants.has(ALICE)).toBe(false);
  });

  it("an old grant alone is still read", () => {
    expect(foldEditions([...roles, edition(VSK.GRANT, ALICE, { member: ALICE, role_ids: [ADMIN] })], OWNER, CID).grants.get(ALICE)).toEqual([ADMIN]);
  });
});

describe("reading the Banlist at either address", () => {
  it("where both exist, the spec's address wins, in either order", () => {
    const legacy = edition(VSK.BANLIST, BANLIST_EID, [ALICE]);
    const spec = edition(VSK.BANLIST, banlistLocator(CID), [BOB]);
    expect([...foldEditions([legacy, spec], OWNER, CID).banlist]).toEqual([BOB]);
    expect([...foldEditions([spec, legacy], OWNER, CID).banlist]).toEqual([BOB]);
  });

  it("an old list alone is still read, and a list at a stray address isn't", () => {
    expect([...foldEditions([edition(VSK.BANLIST, BANLIST_EID, [ALICE])], OWNER, CID).banlist]).toEqual([ALICE]);
    expect(foldEditions([edition(VSK.BANLIST, hex("9"), [ALICE])], OWNER, CID).banlist.size).toBe(0);
  });

  it("an unban that moves the list lifts the name for good: the old list no longer feeds the heal set", () => {
    // Found on the wire: the first edition at the spec's address is composed
    // from every ban known, so its own chain has no ancestor that named the
    // lifted person — while the old list still does. Feeding the old list into
    // the heal set would put them back with the next ban anyone makes.
    const legacy = edition(VSK.BANLIST, BANLIST_EID, [ALICE, BOB]);
    const moved = edition(VSK.BANLIST, banlistLocator(CID), [BOB]);
    const state = foldEditions([legacy, moved], OWNER, CID);
    expect([...state.banlist]).toEqual([BOB]);
    expect([...state.banlistSeen]).toEqual([BOB]);
  });

  it("an unban on the new list lifts a name the old one still carries", () => {
    const legacy = edition(VSK.BANLIST, BANLIST_EID, [ALICE, BOB]);
    const v1 = edition(VSK.BANLIST, banlistLocator(CID), [ALICE, BOB]);
    const v2 = edition(VSK.BANLIST, banlistLocator(CID), [BOB], 2, hashOf(v1));
    const state = foldEditions([legacy, v1, v2], OWNER, CID);
    expect([...state.banlist]).toEqual([BOB]);
    expect(state.banlistSeen.has(ALICE)).toBe(false);
  });
});
