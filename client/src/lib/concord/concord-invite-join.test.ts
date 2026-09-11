/**
 * Accepting an invite, end to end but for the relays: what gets kept, what
 * gets published. Real crypto; the key store is an in-memory map and the
 * owner's record check (the genesis anchor) is passed in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, import("./concord-keys").StoredCommunity>();
vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  getCommunity: async (_me: string, id: string) => store.get(id) ?? null,
  putCommunity: async (_me: string, rec: import("./concord-keys").StoredCommunity) => { store.set(rec.community_id, rec); },
  publishCommunityList: async () => {},
}));

import { v2 as nip44v2 } from "nostr-tools/nip44";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { adoptInviteBundle, type InviteBundle } from "./concord-invites";
import { deriveCommunityId } from "./concord-crypto";
import type { StoredCommunity } from "./concord-keys";

const person = () => {
  const sk = generateSecretKey();
  const signer = {
    signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
    nip44: {
      encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
      decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
    },
  } as unknown as ISigner;
  return { pubkey: getPublicKey(sk), signer };
};
const me = person();
const owner = getPublicKey(generateSecretKey());
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const ROOT = bytesToHex(generateSecretKey());
const general = bytesToHex(generateSecretKey());

const bundle = (over: Partial<InviteBundle> = {}): InviteBundle => ({
  community_id: cid, owner, owner_salt: salt, community_root: ROOT, root_epoch: 3,
  channels: [{ id: general, epoch: 3, name: "general" }], relays: ["wss://r.example"], name: "Book Club", ...over,
});
const heldRecord = (): StoredCommunity => ({
  community_id: cid, owner, owner_salt: salt, community_root: ROOT, root_epoch: 3, control_root: "cc".repeat(32),
  channels: [{ id: general, epoch: 3, name: "general", isPrivate: false }, { id: "ab".repeat(32), key: "ee".repeat(32), epoch: 1, name: "secret", isPrivate: true }],
  relays: ["wss://r.example"], name: "Book Club", addedAt: 1,
});

let published: Event[] = [];
const publish = async (e: Event) => { published.push(e); };
const join = (b: InviteBundle, anchored: boolean) =>
  adoptInviteBundle(me.pubkey, me.signer, b, publish, async () => {}, [], async () => anchored);

beforeEach(() => { store.clear(); published = []; });

describe("accepting an invite", () => {
  it("for a group you're in: adds the room you were missing, keeps your keys, announces nothing", async () => {
    store.set(cid, heldRecord());
    const extra = bytesToHex(generateSecretKey());
    const out = await join(bundle({ channels: [{ id: general, epoch: 3, name: "general" }, { id: extra, epoch: 3, name: "photos" }] }), true);
    expect(out).toMatchObject({ status: "already", added: 1 });
    const kept = store.get(cid)!;
    expect(kept.control_root).toBe("cc".repeat(32));
    expect(kept.channels.map((c) => c.id)).toContain(extra);
    expect(kept.channels.find((c) => c.name === "secret")?.key).toBe("ee".repeat(32));
    expect(published).toEqual([]);
  });

  it("an old link for a group you're in changes nothing", async () => {
    store.set(cid, heldRecord());
    const out = await join(bundle({ community_root: bytesToHex(generateSecretKey()), root_epoch: 1 }), true);
    expect(out).toMatchObject({ status: "already", added: 0, kept: true });
    expect(store.get(cid)).toEqual(heldRecord());
    expect(published).toEqual([]);
  });

  it("a new group whose owner's record opens: kept, and you announce your Join", async () => {
    const out = await join(bundle(), true);
    expect(out).toMatchObject({ status: "joined", record: { community_id: cid } });
    expect(store.has(cid)).toBe(true);
    expect(published).toHaveLength(1);
  });

  it("a new group whose owner's record doesn't open (yet): nothing kept, nothing announced", async () => {
    expect(await join(bundle(), false)).toEqual({ status: "unverified" });
    expect(store.has(cid)).toBe(false);
    expect(published).toEqual([]);
  });

  it("a group id that doesn't match its owner is refused", async () => {
    expect(await join(bundle({ community_id: "dd".repeat(32) }), true)).toEqual({ status: "invalid" });
    expect(store.size).toBe(0);
  });
});
