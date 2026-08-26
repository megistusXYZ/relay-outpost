/**
 * The banlist is the one control entity published at a FIXED coordinate.
 *
 * Every other chained entity derives its eid from content or from a unique id —
 * a channel id, a member pubkey, the community id. The banlist is a singleton at
 * a hardcoded eid, republished in full on every ban. That makes it the only
 * entity where two different payloads can land on the SAME fold coordinate, and
 * it is why the version chain has to be computed rather than assumed.
 *
 * These pin the three things that decide the next edition:
 *   version   — one past the highest head we can prove, never a fixed literal
 *   prevHash  — must accompany any version > 1, or every folder drops the edition
 *   banlist   — must never shrink just because the local fold is cold
 */
import { describe, it, expect } from "vitest";
import { nextBanlistEdition, BANLIST_EID, BANLIST_CAP } from "./concord-banlist";

const hx = (b: string) => b.repeat(32);
const BOB = hx("33");
const CAROL = hx("44");
const DAVE = hx("55");
const HASH_V1 = hx("a1");
const HASH_V2 = hx("a2");

describe("nextBanlistEdition", () => {
  it("starts a fresh chain at version 1 with no parent", () => {
    // chainIntact requires ev===1 to carry NO ep at all.
    const next = nextBanlistEdition(BOB, [], undefined, undefined);
    expect(next.version).toBe(1);
    expect(next.prevHash).toBeUndefined();
    expect(next.banlist).toEqual([BOB]);
    expect(next.eid).toBe(BANLIST_EID);
  });

  it("chains off the folded head rather than republishing version 1", () => {
    // The defect: a second ban reused version 1, colliding at the same
    // coordinate, and the fold keeps exactly one edition per coordinate.
    const next = nextBanlistEdition(CAROL, [BOB], { ev: 1, hash: HASH_V1 }, undefined);
    expect(next.version).toBe(2);
    expect(next.prevHash).toBe(HASH_V1);
    expect(next.banlist).toEqual([BOB, CAROL].sort());
  });

  it("never emits a version above 1 without a parent hash", () => {
    // A version > 1 with no ep fails chainIntact and is dropped by EVERY folder —
    // silently, on the relay side, with the UI still reporting success. Better to
    // restart the chain at 1 and risk a tie than to publish something unfoldable.
    const next = nextBanlistEdition(CAROL, [BOB], { ev: 7, hash: "" }, { version: 7 });
    expect(next.version).toBe(1);
    expect(next.prevHash).toBeUndefined();
  });

  it("caps the payload so a long banlist cannot break the encrypted key backup", () => {
    // banSnapshot rides on StoredCommunity, which publishCommunityList serializes
    // (twice per record) into ONE nip44 plaintext with a hard 65535-byte limit.
    // Past it, encrypt throws, every caller swallows it, and the multi-device key
    // backup silently stops updating — the failure the keys module calls its #1
    // risk. An unbounded list is the one thing this store never allows.
    const many = Array.from({ length: BANLIST_CAP + 40 }, (_, i) => i.toString(16).padStart(64, "0"));
    const next = nextBanlistEdition(DAVE, many, undefined, undefined);
    expect(next.banlist.length).toBe(BANLIST_CAP);
    expect(next.banlist).toContain(DAVE); // the ban being made now always survives
  });

  it("keeps bans this device already published when the fold is cold", () => {
    // The window that makes this worse than a coin flip: banning calls
    // onCommunityChange, which re-runs useConcordGovernance's effect and clears
    // the edition map. A second ban moments later sees an EMPTY banlist. Without
    // the local snapshot it would publish [CAROL] alone at version 2 — and
    // because version 2 wins outright, that DELETES Bob's ban deterministically.
    // A cleared fold has no head AND no banlist — both come from the same fold,
    // so they are consistent by construction. Only the cursor remembers.
    const next = nextBanlistEdition(CAROL, [], undefined, {
      version: 1, eid: HASH_V1, snapshot: [BOB],
    });
    expect(next.banlist).toEqual([BOB, CAROL].sort());
    expect(next.version).toBe(2);
    expect(next.prevHash).toBe(HASH_V1); // chains off what we last published
  });

  it("takes the higher head when the local cursor is ahead of the fold", () => {
    const next = nextBanlistEdition(DAVE, [BOB], { ev: 1, hash: HASH_V1 }, {
      version: 2, eid: HASH_V2, snapshot: [BOB, CAROL],
    });
    expect(next.version).toBe(3);
    expect(next.prevHash).toBe(HASH_V2);
    expect(next.banlist).toEqual([BOB, CAROL, DAVE].sort());
  });

  it("does NOT re-add its own snapshot once the fold has caught up", () => {
    // The fold is authoritative when it is current. Unioning regardless would
    // make one REFUSED edition permanent: authorizeEdition requires the signer to
    // outrank EVERY entry in the payload (targets.every(...)), so a payload the
    // fold rejected, re-sent forever from the local snapshot, would refuse every
    // future ban from that moderator.
    const next = nextBanlistEdition(DAVE, [BOB], { ev: 3, hash: HASH_V2 }, {
      version: 2, eid: HASH_V1, snapshot: [BOB, CAROL],
    });
    expect(next.banlist).toEqual([BOB, DAVE].sort()); // CAROL not resurrected
  });

  it("takes the higher head when the fold is ahead of the local cursor", () => {
    // Another admin banned someone from another device; their edition is the one
    // other clients hold, so its hash is the parent we must cite.
    const next = nextBanlistEdition(DAVE, [BOB, CAROL], { ev: 5, hash: HASH_V2 }, {
      version: 2, eid: HASH_V1, snapshot: [BOB],
    });
    expect(next.version).toBe(6);
    expect(next.prevHash).toBe(HASH_V2);
  });

  it("is idempotent: re-banning someone already listed changes nothing but the version", () => {
    const next = nextBanlistEdition(BOB, [BOB], { ev: 2, hash: HASH_V2 }, undefined);
    expect(next.banlist).toEqual([BOB]);
  });

  it("orders the payload deterministically so two devices agree byte-for-byte", () => {
    // The edition id is a hash over the serialized content, so ordering is not
    // cosmetic. Two admins banning the same person from the same head now produce
    // an IDENTICAL edition — a harmless duplicate instead of a fork.
    const a = nextBanlistEdition(DAVE, [CAROL, BOB], { ev: 1, hash: HASH_V1 }, undefined);
    const b = nextBanlistEdition(DAVE, [BOB, CAROL], { ev: 1, hash: HASH_V1 }, undefined);
    expect(a.banlist).toEqual(b.banlist);
    expect(JSON.stringify(a.banlist)).toBe(JSON.stringify(b.banlist));
  });
});
