/**
 * A removal is a Refounding, and a Refounding mints the split (CORD-06 §3,
 * CORD-02 §2): "the community_root is rolled, and a fresh control_root is
 * minted alongside it … the pair travels in the same base blobs." It is also
 * how a legacy group upgrades. Only the local IndexedDB writes are stubbed;
 * the rotation that reaches the wire is real.
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
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { removeMember } from "./concord-governance";
import { receiveRekey, type RekeyAuthority } from "./concord-rekey";
import { baseRekeyAddress, deriveCommunityId, groupKey, rekeyScopeId, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { decodeStreamEvent } from "./concord-stream";
import { PERM, type Member } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";
import { publishControlEdition, controlPlaneKey, governancePlanes, decodeStreamEventWithSeal } from "./concord-stream";
import { buildControlEdition, parseControlEdition, foldEditions, compactionOf, VSK } from "./concord-events";
import { bundleFromCommunity, recordFromBundle } from "./concord-invites";

const signer = (sk: Uint8Array) => ({
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const evictee = getPublicKey(generateSecretKey());
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const root = generateSecretKey();

const m = (pubkey: string, rank: number, permissions = 0n): Member => ({ pubkey, joinedAt: 0, roleIds: [], permissions, rank });
const roster: Member[] = [
  m(memberPk, 3),
  m(adminPk, 1, PERM.MANAGE_CHANNELS | PERM.MANAGE_METADATA | PERM.KICK | PERM.BAN | PERM.CREATE_INVITE),
  m(evictee, 3),
];
const auth: RekeyAuthority = { ownerPubkey: owner, roster };

/** A group from before the split: members hold no admin address at all. */
const legacyGroup: StoredCommunity = {
  community_id: cid, owner, owner_salt: salt, community_root: bytesToHex(root), root_epoch: 0,
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0,
};

async function removeEvictee() {
  const published: Event[] = [];
  const updated = await removeMember(signer(ownerSk), owner, legacyGroup, evictee,
    { ban: false, currentBanlist: [], roster }, async (e) => { published.push(e); });
  const plane = baseRekeyAddress(root, cid, 1n);
  const rumors = published.filter((e) => e.pubkey === plane.pk).map((e) => decodeStreamEvent(plane, e)!);
  return { updated: updated!, rumors };
}
const held = { scopeId: rekeyScopeId(), myCurrentKey: root, myCurrentEpoch: 0, communityId: cid };

describe("removing someone moves the group onto the split", () => {
  it("the new epoch has an admin address, and the remover holds the secret it derives from", async () => {
    const { updated } = await removeEvictee();
    expect(updated.root_epoch).toBe(1);
    expect(updated.control_pk).toMatch(/^[0-9a-f]{64}$/);
    expect(groupKey(LABEL_CONTROL_SIGNER, hexToBytes(updated.control_root!), cid, 1n).pk).toBe(updated.control_pk);
  });

  it("a member learns the new admin address from the rotation, without the staff secret", async () => {
    const { updated, rumors } = await removeEvictee();
    const res = await receiveRekey(signer(memberSk), memberPk, owner, held, rumors, auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      // A real key, not two undefineds agreeing (a legacy rotation names none).
      expect(res.controlPk).toMatch(/^[0-9a-f]{64}$/);
      expect(res.controlPk).toBe(updated.control_pk);
      expect(res.controlRoot).toBeUndefined();
    }
  });

  it("an admin is staff: their copy carries the new control_root, so they can keep writing", async () => {
    const { updated, rumors } = await removeEvictee();
    const res = await receiveRekey(signer(adminSk), adminPk, owner, held, rumors, auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      expect(res.controlRoot).toMatch(/^[0-9a-f]{64}$/);
      expect(res.controlRoot).toBe(updated.control_root);
    }
  });
});

/**
 * CORD-06 §3 step 3: "Republish the compaction at the new epoch." Someone who
 * joins after a removal holds only the new epoch's keys. Without the
 * republish, the new admin plane is empty and they see no name, no rooms and
 * no roles. Each edition goes out with its ORIGINAL signed seal, re-wrapped:
 * re-sealing it under the remover would change its author and fail the
 * rumor-author check for every admin's edit.
 */
describe("people who join after a removal still see the group's rooms and roles", () => {
  it("the remover republishes the group's current settings at the new epoch, seals intact", async () => {
    const now = 1_789_000_000;
    const roomId = bytesToHex(generateSecretKey());
    const written: Event[] = [];
    await publishControlEdition(signer(ownerSk), owner, legacyGroup,
      buildControlEdition(owner, VSK.METADATA, cid, 1, { name: "Book Club", relays: [] }, now), async (e) => { written.push(e); });
    await publishControlEdition(signer(ownerSk), owner, legacyGroup,
      buildControlEdition(owner, VSK.CHANNEL, roomId, 1, { channel_id: roomId, name: "general" }, now), async (e) => { written.push(e); });

    // What the governance hook holds: the editions, each with its signed seal.
    const legacyPlane = controlPlaneKey(legacyGroup);
    const editions = written
      .map((e) => decodeStreamEventWithSeal(legacyPlane, e))
      .map((d) => (d ? parseControlEdition(d) : null))
      .filter((ed): ed is NonNullable<typeof ed> => ed !== null);
    const compaction = compactionOf(editions, owner);
    expect(compaction).toHaveLength(2);

    const published: Event[] = [];
    const updated = (await removeMember(signer(ownerSk), owner, legacyGroup, evictee,
      { ban: false, currentBanlist: [], roster, compaction }, async (e) => { published.push(e); }))!;

    // Someone joins with an invite minted after the removal: only the new epoch.
    const joiner = recordFromBundle(bundleFromCommunity(updated), []);
    const planes = new Map(governancePlanes(joiner).map((p) => [p.pk, p]));
    const seen = published.flatMap((e) => {
      const plane = planes.get(e.pubkey);
      const rumor = plane ? decodeStreamEvent(plane, e) : null;
      const edition = rumor ? parseControlEdition(rumor) : null;
      return edition ? [edition] : [];
    });
    const state = foldEditions(seen, owner);
    expect(state.metadata?.name).toBe("Book Club");
    expect(state.channels.get(roomId)?.name).toBe("general");
  });
});
