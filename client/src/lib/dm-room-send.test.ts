/**
 * Sending to a several-person chat: what we build is opened with nostr-tools'
 * NIP-59 (an independent reader — what other apps use), by every member.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/nostr", () => ({ publishEvent: vi.fn(async () => true) }));
vi.mock("@/lib/outbox", () => ({
  fetchDMRelayList: vi.fn(async () => []),
  hasDMRelayList: () => true,
  getDMRelaysForContact: () => [],
  getDMRelayListCached: (pk: string) => (pk.startsWith("0") ? [] : ["wss://inbox.example"]),
  getLocalDMRelays: () => [],
  getMyDMReceiveRelays: () => [],
  DM_FALLBACK_RELAYS: [],
}));

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { v2 as nip44 } from "nostr-tools/nip44";
import * as nip59 from "nostr-tools/nip59";
import { createRoomGiftWraps, createGiftWrap } from "./dm";
import { roomKeyFor, roomMembers } from "./dm-room";

const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const signerOf = (sk: Uint8Array) => ({
  nip44: {
    decrypt: async (peer: string, cipher: string) => nip44.decrypt(cipher, nip44.utils.getConversationKey(sk, peer)),
    encrypt: async (peer: string, plain: string) => nip44.encrypt(plain, nip44.utils.getConversationKey(sk, peer)),
  },
  signEvent: async (t: any) => finalizeEvent(t, sk),
});

describe("createRoomGiftWraps — one message for everyone in the chat", () => {
  const me = person(), alice = person(), bob = person();

  it("each member opens the SAME message, naming everyone, with a standard reader", async () => {
    const built = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "see you at eight", { rumorCreatedAt: 1_790_000_000 });
    expect(built).not.toBeNull();
    expect(built!.wraps.map((w) => w.to)).toEqual([alice.pk, bob.pk]);

    const forAlice = nip59.unwrapEvent(built!.wraps[0].wrap as any, alice.sk);
    const forBob = nip59.unwrapEvent(built!.wraps[1].wrap as any, bob.sk);
    expect(forAlice.content).toBe("see you at eight");
    expect(forAlice.kind).toBe(14);
    expect(forAlice.pubkey).toBe(me.pk);
    expect(forAlice.id).toBe(built!.rumorId);
    expect(forBob.id).toBe(built!.rumorId);
    expect(forAlice.tags.filter((t) => t[0] === "p").map((t) => t[1])).toEqual([alice.pk, bob.pk]);
    // …and each files it in the same three-person chat.
    expect(roomMembers(roomKeyFor({ sender: forAlice.pubkey, tags: forAlice.tags }, alice.pk)!)).toEqual([bob.pk, me.pk].sort());
    expect(roomMembers(roomKeyFor({ sender: forBob.pubkey, tags: forBob.tags }, bob.pk)!)).toEqual([alice.pk, me.pk].sort());
  });

  it("each wrap is addressed to its member only: nobody is handed another member's copy", async () => {
    const built = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "hi");
    for (const { to, wrap } of built!.wraps) {
      expect(wrap.tags.filter((t) => t[0] === "p").map((t) => t[1])).toEqual([to]);
      expect(wrap.pubkey).not.toBe(me.pk); // a one-time key: the wrap doesn't say who sent it
    }
    expect(() => nip59.unwrapEvent(built!.wraps[0].wrap as any, bob.sk)).toThrow();
  });

  it("the copy the sender keeps is the same message, addressed to the sender", async () => {
    const built = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "note", { rumorCreatedAt: 1_790_000_000 });
    expect(built!.selfWrap!.tags.find((t) => t[0] === "p")?.[1]).toBe(me.pk);
    expect(nip59.unwrapEvent(built!.selfWrap as any, me.sk).id).toBe(built!.rumorId);
  });

  it("a retry builds the same message id, so nobody sees it twice", async () => {
    const a = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "again", { rumorCreatedAt: 1_790_000_123 });
    const b = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "again", { rumorCreatedAt: 1_790_000_123 });
    expect(b!.rumorId).toBe(a!.rumorId);
  });

  it("extra tags (a file's key, an emoji) ride on the one message for everyone", async () => {
    const built = await createRoomGiftWraps(signerOf(me.sk), me.pk, [alice.pk, bob.pk], "https://files.example/x", { rumorKind: 15, extraTags: [["decryption-key", "ab"]] });
    const opened = nip59.unwrapEvent(built!.wraps[1].wrap as any, bob.sk);
    expect(opened.kind).toBe(15);
    expect(opened.tags).toContainEqual(["decryption-key", "ab"]);
  });

  it("nobody to send to builds nothing", async () => {
    expect(await createRoomGiftWraps(signerOf(me.sk), me.pk, [], "hi")).toBeNull();
  });

  it("a one-to-one message is unchanged: one p tag, the recipient", async () => {
    const built = await createGiftWrap(signerOf(me.sk), me.pk, alice.pk, "just us");
    const opened = nip59.unwrapEvent(built!.wrap as any, alice.sk);
    expect(opened.tags.filter((t) => t[0] === "p").map((t) => t[1])).toEqual([alice.pk]);
  });
});
