/**
 * The outer wrap of a timed message carries the same expiry as the message
 * inside (CORD-08 §2), so relays that honor NIP-40 delete the ciphertext
 * itself: after expiry the message isn't merely unreadable, it's gone.
 */
import { describe, it, expect } from "vitest";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { publishChannelMessage } from "./concord-stream";
import { buildMessageRumor } from "./concord-events";
import { stampExpiration } from "./concord-disappearing";
import type { StoredCommunity, StoredChannel } from "./concord-keys";

const sk = generateSecretKey();
const me = getPublicKey(sk);
const signer = {
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
} as unknown as ISigner;
const room: StoredChannel = { id: bytesToHex(generateSecretKey()), epoch: 0, name: "general", isPrivate: false };
const group: StoredCommunity = {
  community_id: bytesToHex(generateSecretKey()), owner: me, owner_salt: bytesToHex(generateSecretKey()),
  community_root: bytesToHex(generateSecretKey()), root_epoch: 0, channels: [room], relays: ["wss://r"], name: "G", addedAt: 0,
};
const send = async (rumor: ReturnType<typeof buildMessageRumor>) => {
  let wrap: Event | undefined;
  await publishChannelMessage(signer, me, group, room, rumor, async (e) => { wrap = e; });
  return wrap!;
};

describe("a timed message's wrap", () => {
  it("carries the same expiry as the message inside, for relays to delete it", async () => {
    const wrap = await send(stampExpiration(buildMessageRumor(me, room.id, 0n, "hi", 1, 1_789_000_000), 86400));
    expect(wrap.tags).toContainEqual(["expiration", String(1_789_000_000 + 86400)]);
  });

  it("an untimed message's wrap carries none, as before", async () => {
    const wrap = await send(buildMessageRumor(me, room.id, 0n, "hi", 1, 1_789_000_000));
    expect(wrap.tags.some((t) => t[0] === "expiration")).toBe(false);
  });
});
