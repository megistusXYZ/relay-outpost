/**
 * A grant edition replaces a member's roles wholesale, and an empty array is a
 * REVOKE — so a lost edition does not just fail to promote, it fails to demote.
 * These tests are weighted toward the revoke case.
 */
import { describe, it, expect } from "vitest";
import { computeEditionId, ADMIN_ROLE_ID } from "./concord-events";
import { nextGrantEdition, type GrantHead } from "./concord-grant-edition";

const TARGET = "d".repeat(64);
const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

describe("nextGrantEdition — the chain", () => {
  it("publishes a bare v1 when nothing is known — a first grant has no parent", () => {
    // Unlike metadata and channel editions, refusing here would break the
    // COMMON case: chainIntact accepts ev===1 exactly when it carries no `ep`.
    const out = nextGrantEdition(TARGET, undefined, undefined, [ADMIN_ROLE_ID], true);
    expect(out.version).toBe(1);
    expect(out.prevHash).toBeUndefined();
  });

  it("chains onto the fold head when this device has no cursor", () => {
    // The second-device case: without this it republished v1 onto an occupied
    // coordinate and the loser's payload was discarded.
    const out = nextGrantEdition(TARGET, undefined, { ev: 3, hash: H(3) }, [], true);
    expect(out.version).toBe(4);
    expect(out.prevHash).toBe(H(3));
  });

  it("prefers the fold head over a behind local cursor", () => {
    const out = nextGrantEdition(TARGET, { version: 2, eid: H(2) }, { ev: 6, hash: H(6) }, [ADMIN_ROLE_ID], true);
    expect(out.version).toBe(7);
    expect(out.prevHash).toBe(H(6));
  });

  it("uses the local cursor as a floor when the fold is cold", () => {
    const out = nextGrantEdition(TARGET, { version: 4, eid: H(4) }, undefined, [], true);
    expect(out.version).toBe(5);
    expect(out.prevHash).toBe(H(4));
  });

  it("prefers the fold's hash on an equal-version tie", () => {
    const out = nextGrantEdition(TARGET, { version: 5, eid: H(0xaa) }, { ev: 5, hash: H(0xbb) }, [], true);
    expect(out.prevHash).toBe(H(0xbb));
  });
});

describe("nextGrantEdition — the arrival proof", () => {
  it("REFUSES a bare v1 when the fold has not arrived", () => {
    // The second-device case. An absent head here means "cold subscription",
    // not "never granted" — publishing v1 on it lands a second edition on an
    // occupied coordinate where the loser is discarded outright.
    expect(() => nextGrantEdition(TARGET, undefined, undefined, [], false))
      .toThrow(/chain head unknown/);
  });

  it("still chains off a known head even without arrival proof", () => {
    // A head IS arrival proof — it could not exist otherwise.
    const out = nextGrantEdition(TARGET, undefined, { ev: 2, hash: H(2) }, [], false);
    expect(out.version).toBe(3);
  });

  it("still chains off a local cursor even without arrival proof", () => {
    const out = nextGrantEdition(TARGET, { version: 3, eid: H(3) }, undefined, [], false);
    expect(out.version).toBe(4);
  });
});

describe("nextGrantEdition — the revoke", () => {
  it("carries an EMPTY role list, which is how a revoke is expressed", () => {
    const out = nextGrantEdition(TARGET, undefined, { ev: 2, hash: H(2) }, [], true);
    expect(out.content.role_ids).toEqual([]);
    expect(out.content.member).toBe(TARGET);
  });

  it("chains a revoke onto the grant it is undoing, never colliding with it", () => {
    // The authority bug: a v1 revoke on the same coordinate as the v1 grant is
    // decided by a rumor-id coin flip, and half the time the admin keeps
    // MANAGE_CHANNELS, MANAGE_METADATA, KICK and BAN.
    const grant = nextGrantEdition(TARGET, undefined, undefined, [ADMIN_ROLE_ID], true);
    const revoke = nextGrantEdition(TARGET, undefined, { ev: grant.version, hash: grant.eid }, [], true);
    expect(revoke.version).toBe(2);
    expect(revoke.prevHash).toBe(grant.eid);
  });
});

describe("nextGrantEdition — the id", () => {
  it("computes eid over the same content object the caller serializes", () => {
    const out = nextGrantEdition(TARGET, undefined, { ev: 1, hash: H(1) }, [ADMIN_ROLE_ID], true);
    expect(out.eid).toBe(computeEditionId(TARGET, out.version, out.prevHash, JSON.stringify(out.content)));
  });

  it("keys the edition on the TARGET, not the community", () => {
    const a = nextGrantEdition(TARGET, undefined, undefined, [], true);
    const b = nextGrantEdition("e".repeat(64), undefined, undefined, [], true);
    expect(a.eid).not.toBe(b.eid);
  });

  it("never returns a version above 1 without a prevHash", () => {
    const heads: (GrantHead | undefined)[] = [undefined, { ev: 1, hash: H(1) }, { ev: 8, hash: H(8) }];
    for (const h of heads) {
      const out = nextGrantEdition(TARGET, undefined, h, [], true);
      if (out.version > 1) expect(typeof out.prevHash).toBe("string");
      else expect(out.prevHash).toBeUndefined();
    }
  });
});
