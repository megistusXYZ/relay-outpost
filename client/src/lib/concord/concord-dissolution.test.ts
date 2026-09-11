/**
 * A group its owner deleted, as every member sees it (CORD-02 §9). The owner
 * signs one tombstone at an address derived from the group's id alone, so any
 * member past or present finds it. Because that address needs no secret,
 * anyone can publish there: only the owner's tombstone naming THIS group counts,
 * or one lifted from another group the same owner runs would kill this one.
 */
import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { dissolvedPlaneKey, buildDissolutionRumor, isDissolution } from "./concord-dissolution";
import { deriveCommunityId, groupKey } from "./concord-crypto";

const owner = getPublicKey(generateSecretKey());
const stranger = getPublicKey(generateSecretKey());
const group = { community_id: deriveCommunityId(owner, bytesToHex(generateSecretKey())), owner };
const otherGroup = deriveCommunityId(owner, bytesToHex(generateSecretKey()));

describe("a group its owner deleted", () => {
  it("the tombstone's address comes from the group's id alone, so every member finds it", () => {
    // Appendix A.6: concord/dissolved, secret = community_id, id = 0…0, no epoch.
    expect(dissolvedPlaneKey(group.community_id).pk)
      .toBe(groupKey("concord/dissolved", hexToBytes(group.community_id), new Uint8Array(32)).pk);
    expect(dissolvedPlaneKey(otherGroup).pk).not.toBe(dissolvedPlaneKey(group.community_id).pk);
  });

  it("the owner's tombstone names the group it deletes, and carries nothing else", () => {
    expect(buildDissolutionRumor(owner, group.community_id, 1_789_000_000)).toEqual({
      kind: 3308, pubkey: owner, created_at: 1_789_000_000, content: "",
      tags: [["vsk", "10"], ["eid", group.community_id]],
    });
  });

  it("only the owner's tombstone for this group counts", () => {
    expect(isDissolution(buildDissolutionRumor(owner, group.community_id, 1), group)).toBe(true);
    expect(isDissolution(buildDissolutionRumor(stranger, group.community_id, 1), group)).toBe(false);
    // Lifted off another group the same owner runs and re-wrapped here.
    expect(isDissolution(buildDissolutionRumor(owner, otherGroup, 1), group)).toBe(false);
    // The all-zero placeholder of earlier spec revisions: refusing it is the fix.
    expect(isDissolution(buildDissolutionRumor(owner, "00".repeat(32), 1), group)).toBe(false);
  });
});

describe("a deletion from before this change", () => {
  it("an owner's dissolution on the admin plane counts only when it names this group", async () => {
    const { foldEditions, VSK } = await import("./concord-events");
    const { isDeleted } = await import("./concord-dissolution");
    const legacy = (eid: string) => foldEditions([{ vsk: VSK.DISSOLVED, eid, ev: 1, rumorId: "d", pubkey: owner, content: JSON.stringify({ dissolved: true }) }], owner);
    expect(isDeleted(group, legacy(group.community_id), [])).toBe(true);
    expect(isDeleted(group, legacy(otherGroup), [])).toBe(false);
    expect(isDeleted(group, foldEditions([], owner), [buildDissolutionRumor(owner, group.community_id, 1)])).toBe(true);
    expect(isDeleted(group, foldEditions([], owner), [])).toBe(false);
  });
});
