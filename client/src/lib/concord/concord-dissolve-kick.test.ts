/**
 * What deleting a group and removing someone put on the wire, with real crypto
 * (only the local IndexedDB writes are stubbed). Deleting used to publish an
 * edition on the admin plane in a shape other apps don't read; the spec's
 * tombstone lives at an address derived from the group's id (CORD-02 §9).
 * Removing someone wrote only our own audit record; other apps read a Kick.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  putCommunity: async () => {},
  deleteCommunity: async () => {},
  publishCommunityList: async () => {},
}));

import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { dissolveCommunity, removeMember } from "./concord-governance";
import { dissolvedPlaneKey, isDissolution } from "./concord-dissolution";
import { decodeStreamEvent, subscribeGovernance, type DecodedRumor } from "./concord-stream";
import { deriveCommunityId, groupKey, LABEL_GUESTBOOK } from "./concord-crypto";
import type { Member } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";

const signer = (sk: Uint8Array) => ({
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const evictee = getPublicKey(generateSecretKey());
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const root = generateSecretKey();
const group: StoredCommunity = {
  community_id: cid, owner, owner_salt: salt, community_root: bytesToHex(root), root_epoch: 0,
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0,
};
const roster: Member[] = [{ pubkey: evictee, joinedAt: 0, roleIds: [], permissions: 0n, rank: Infinity }];
const guestbook = groupKey(LABEL_GUESTBOOK, root, cid, 0n);

describe("deleting a group", () => {
  it("puts the owner's tombstone, naming this group, at the address every member derives from its id", async () => {
    const published: Event[] = [];
    await dissolveCommunity(signer(ownerSk), owner, group, async (e) => { published.push(e); }, async () => {});
    const plane = dissolvedPlaneKey(cid);
    const tombstones = published.filter((e) => e.pubkey === plane.pk).map((e) => decodeStreamEvent(plane, e)!);
    expect(tombstones).toHaveLength(1);
    expect(isDissolution(tombstones[0], group)).toBe(true);
  });
});

describe("removing someone", () => {
  const kicksIn = (published: Event[]) => published
    .filter((e) => e.pubkey === guestbook.pk)
    .map((e) => decodeStreamEvent(guestbook, e))
    .filter((r) => r?.kind === 3309);

  it("also sends a Kick naming them, so other apps show them gone", async () => {
    const published: Event[] = [];
    await removeMember(signer(ownerSk), owner, group, evictee, { ban: false, currentBanlist: [], roster }, async (e) => { published.push(e); });
    const kicks = kicksIn(published);
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!.tags).toContainEqual(["p", evictee]);
  });

  it("a ban sends no Kick: other apps read the banlist (CORD-04 §6)", async () => {
    const published: Event[] = [];
    await removeMember(signer(ownerSk), owner, group, evictee, { ban: true, currentBanlist: [], roster }, async (e) => { published.push(e); });
    expect(kicksIn(published)).toHaveLength(0);
  });
});

describe("a member finds out", () => {
  it("their governance subscription watches the tombstone address and hands over the owner's tombstone", async () => {
    const published: Event[] = [];
    await dissolveCommunity(signer(ownerSk), owner, group, async (e) => { published.push(e); }, async () => {});
    let authors: string[] = [];
    let deliver: (e: Event) => void = () => {};
    const seen: DecodedRumor[] = [];
    subscribeGovernance(evictee, group, (r) => { seen.push(r); }, (_relays, filter, onevent) => {
      authors = filter.authors; deliver = onevent; return { close() {} };
    });
    expect(authors).toContain(dissolvedPlaneKey(cid).pk);
    for (const e of published) deliver(e);
    expect(seen.some((r) => isDissolution(r, group))).toBe(true);
  });
});
