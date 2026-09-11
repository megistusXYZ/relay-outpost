/**
 * What lifting a ban puts on the wire, with real crypto (only the local
 * IndexedDB writes are stubbed): the next banlist edition without them, on the
 * admin plane, and an "unban" line in the group's activity record.
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
import { unbanMember } from "./concord-governance";
import { decodeStreamEvent, controlPlaneKey } from "./concord-stream";
import { deriveCommunityId, groupKey, LABEL_GUESTBOOK } from "./concord-crypto";
import { parseControlEdition, parseAuditRumor, VSK } from "./concord-events";
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
const bob = getPublicKey(generateSecretKey());
const carol = getPublicKey(generateSecretKey());
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const root = generateSecretKey();
const group: StoredCommunity = {
  community_id: cid, owner, owner_salt: salt, community_root: bytesToHex(root), root_epoch: 0,
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0,
};

describe("lifting a ban", () => {
  it("publishes the banlist without them, one past the head, and records the unban", async () => {
    const published: Event[] = [];
    const updated = await unbanMember(signer(ownerSk), owner, group, bob,
      { currentBanlist: [bob, carol], banHead: { ev: 2, hash: "a2".repeat(32) } }, async (e) => { published.push(e); });

    const control = controlPlaneKey(group);
    const editions = published.filter((e) => e.pubkey === control.pk)
      .map((e) => decodeStreamEvent(control, e)).map((r) => (r ? parseControlEdition(r) : null))
      .filter((e) => e?.vsk === VSK.BANLIST);
    expect(editions).toHaveLength(1);
    expect(editions[0]!.ev).toBe(3);
    expect(JSON.parse(editions[0]!.content)).toEqual([carol]);
    expect(updated?.banSnapshot).toEqual([carol]);

    const guestbook = groupKey(LABEL_GUESTBOOK, root, cid, 0n);
    const audits = published.filter((e) => e.pubkey === guestbook.pk)
      .map((e) => decodeStreamEvent(guestbook, e)).map((r) => (r ? parseAuditRumor(r) : null)).filter(Boolean);
    expect(audits).toEqual([expect.objectContaining({ action: "unban", target: bob, actor: owner })]);
  });
});
