/**
 * Promotion delivers the admin-plane secret (CORD-04 §3): "A staff-making
 * edition MUST carry a wrap fresh for the current epoch." Before this, a new
 * admin in a split group could not write where current apps read until the
 * next removal handed them the secret. Only IndexedDB writes are stubbed.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  putCommunity: async () => {},
  publishCommunityList: async () => {},
}));

import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { createCommunity } from "./concord-community";
import { setAdmin } from "./concord-governance";
import { bundleFromCommunity, recordFromBundle } from "./concord-invites";
import { governancePlanes, decodeStreamEvent } from "./concord-stream";
import { parseControlEdition, VSK } from "./concord-events";
import { openControlWrap } from "./concord-control-wrap";
import { deriveCommunityId } from "./concord-crypto";
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
const adminSk = generateSecretKey();
const admin = getPublicKey(adminSk);

/** The grant contents a member reads off the wire for this group. */
function grantsSeenBy(record: StoredCommunity, published: Event[]): Record<string, unknown>[] {
  const member = recordFromBundle(bundleFromCommunity(record), []);
  const planes = new Map(governancePlanes(member).map((p) => [p.pk, p]));
  return published.flatMap((e) => {
    const plane = planes.get(e.pubkey);
    const rumor = plane ? decodeStreamEvent(plane, e) : null;
    const edition = rumor ? parseControlEdition(rumor) : null;
    return edition && edition.vsk === VSK.GRANT ? [JSON.parse(edition.content) as Record<string, unknown>] : [];
  });
}

describe("promoting someone to admin hands them the admin-plane secret", () => {
  it("the grant carries a control_wrap the new admin opens to the group's current control_root", async () => {
    const published: Event[] = [];
    const publish = async (e: Event) => { published.push(e); return true; };
    const group = await createCommunity(signer(ownerSk), owner, { name: "Book Club", relays: ["wss://r"] }, publish, async () => true);
    await setAdmin(signer(ownerSk), owner, group, admin, true, undefined, true, publish, async () => true);

    const [grant] = grantsSeenBy(group, published);
    expect(grant?.role_ids).toHaveLength(1);
    const opened = await openControlWrap(signer(adminSk), owner, grant?.control_wrap,
      { communityId: group.community_id, epoch: group.root_epoch, controlPk: group.control_pk! });
    expect(opened).toBe(group.control_root);
  });

  it("taking admin away carries no secret", async () => {
    const published: Event[] = [];
    const publish = async (e: Event) => { published.push(e); return true; };
    const group = await createCommunity(signer(ownerSk), owner, { name: "Book Club", relays: ["wss://r"] }, publish, async () => true);
    const promoted = await setAdmin(signer(ownerSk), owner, group, admin, true, undefined, true, publish, async () => true);
    published.length = 0;
    await setAdmin(signer(ownerSk), owner, promoted, admin, false, undefined, true, publish, async () => true);
    const [revoke] = grantsSeenBy(group, published);
    expect(revoke?.role_ids).toEqual([]);
    expect(revoke && "control_wrap" in revoke).toBe(false);
  });

  it("in a group that isn't split yet there is no secret to hand over, and the promotion still goes through", async () => {
    const salt = bytesToHex(generateSecretKey());
    const legacy: StoredCommunity = {
      community_id: deriveCommunityId(owner, salt), owner, owner_salt: salt, community_root: bytesToHex(generateSecretKey()),
      root_epoch: 0, channels: [], relays: ["wss://r"], name: "Old Group", addedAt: 0,
    };
    const published: Event[] = [];
    await setAdmin(signer(ownerSk), owner, legacy, admin, true, undefined, true, async (e) => { published.push(e); return true; }, async () => true);
    const [grant] = grantsSeenBy(legacy, published);
    expect(grant?.role_ids).toHaveLength(1);
    expect("control_wrap" in (grant ?? {})).toBe(false);
  });
});
