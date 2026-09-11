import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { mergeInviteLists, readInviteList, planInviteSync, type InviteList, type InviteListEntry } from "./concord-invite-list";
import type { StoredInviteSigner } from "./concord-keys";

const GROUP = "ab".repeat(32);
const url = (s: { token: string }) => `https://example.app/invite/x#${s.token}`;

/** A link as this device stores it, with real keys. */
const minted = (over: Partial<StoredInviteSigner> = {}): StoredInviteSigner => {
  const sk = generateSecretKey();
  return {
    communityId: GROUP, linkSignerPubkey: getPublicKey(sk), linkSignerSecret: bytesToHex(sk),
    token: bytesToHex(generateSecretKey().slice(0, 16)), createdAt: 1_719_800_000_000, ...over,
  };
};
const entryOf = (s: StoredInviteSigner, extra: Record<string, unknown> = {}): InviteListEntry => ({
  token: s.token, signer_sk: s.linkSignerSecret, community_id: s.communityId, url: url(s), created_at: Math.floor(s.createdAt / 1000),
  ...(s.label ? { label: s.label } : {}), ...(s.expiresAt ? { expires_at: Math.floor(s.expiresAt / 1000) } : {}), ...extra,
});
const tombOf = (s: StoredInviteSigner) => ({ token: s.token, community_id: s.communityId });

describe("Invite List merge (CORD-05 §4)", () => {
  it("merges two copies by token, and a tombstone beats the entry it names", () => {
    const one = minted(), two = minted();
    const a: InviteList = { entries: [entryOf(one)], tombstones: [tombOf(two)] };
    const b: InviteList = { entries: [entryOf(one), entryOf(two)], tombstones: [] };
    for (const merged of [mergeInviteLists(a, b), mergeInviteLists(b, a)]) {
      expect(merged.entries.map((e) => e.token)).toEqual([one.token]);
      expect(merged.tombstones.map((t) => t.token)).toEqual([two.token]);
    }
  });

  it("keeps what it doesn't understand, in the list and in each entry", () => {
    const one = minted();
    const merged = mergeInviteLists({ entries: [entryOf(one, { uses_cap: 5 })], tombstones: [], vendor: { x: 1 } } as InviteList, { entries: [], tombstones: [] });
    expect(merged.entries[0].uses_cap).toBe(5);
    expect((merged as Record<string, unknown>).vendor).toEqual({ x: 1 });
  });

  it("reads only entries that can become a working link", () => {
    const good = entryOf(minted());
    const read = readInviteList(JSON.stringify({
      entries: [good, { ...good, token: "zz" }, { ...good, token: bytesToHex(generateSecretKey().slice(0, 16)), signer_sk: "short" }, "nonsense"],
      tombstones: [{ token: good.token }, { token: good.token, community_id: GROUP }],
    }));
    expect(read?.entries).toEqual([good]);
    expect(read?.tombstones).toEqual([{ token: good.token, community_id: GROUP }]);
    expect(readInviteList("not json")).toBeNull();
  });
});

describe("keeping this device and the Invite List in step", () => {
  it("takes up a link made on another device, keys and all", () => {
    const elsewhere = minted({ label: "Bio link", expiresAt: 1_722_400_000_000 });
    const plan = planInviteSync([], { entries: [entryOf(elsewhere)], tombstones: [] }, url);
    expect(plan.adopt).toEqual([elsewhere]);
  });

  it("turns off here a link turned off elsewhere, and never brings it back", () => {
    const link = minted();
    const plan = planInviteSync([link], { entries: [], tombstones: [tombOf(link)] }, url);
    expect(plan.revoke).toEqual([link.linkSignerPubkey]);
    expect(plan.adopt).toEqual([]);
    expect(plan.next).toBeNull(); // the list already says so
  });

  it("writes this device's new links and revocations, and nothing when the list has them", () => {
    const fresh = minted({ label: "Flyer" }), dead = minted({ revoked: true });
    const plan = planInviteSync([fresh, dead], { entries: [], tombstones: [] }, url);
    expect(plan.next?.entries.map((e) => e.token)).toEqual([fresh.token]);
    expect(plan.next?.entries[0]).toMatchObject({ label: "Flyer", url: url(fresh), created_at: 1_719_800_000 });
    expect(plan.next?.tombstones).toEqual([tombOf(dead)]);
    expect(planInviteSync([fresh, dead], plan.next!, url).next).toBeNull();
  });

  it("reads a time another app wrote in milliseconds as milliseconds", () => {
    const link = minted();
    const plan = planInviteSync([], { entries: [entryOf(link, { created_at: link.createdAt, expires_at: 1_722_400_000_000 })], tombstones: [] }, url);
    expect(plan.adopt[0]).toMatchObject({ createdAt: link.createdAt, expiresAt: 1_722_400_000_000 });
  });
});
