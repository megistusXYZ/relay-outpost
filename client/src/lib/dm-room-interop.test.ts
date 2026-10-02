/**
 * Round trip against the standard library: messages built by nostr-tools'
 * NIP-17 (what other apps send) are opened by OUR opener and filed in the
 * right chat. An independent source of truth — not our own builder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/dm-cache", () => ({
  getProcessedWrapIds: vi.fn(async () => []),
  markProcessed: vi.fn(async () => {}),
}));

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { v2 as nip44 } from "nostr-tools/nip44";
import * as nip17 from "nostr-tools/nip17";
import * as nip59 from "nostr-tools/nip59";
import { unwrapGiftWrap, roomKeyOfUnwrapped, clearProcessedWraps } from "./gift-wrap";
import { isGroupRoom, roomMembers } from "./dm-room";

const person = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
/** The signer shape the app hands the opener: nip44 by the reader's own key. */
const signerOf = (sk: Uint8Array) => ({
  nip44: {
    decrypt: async (peer: string, cipher: string) => nip44.decrypt(cipher, nip44.utils.getConversationKey(sk, peer)),
    encrypt: async (peer: string, plain: string) => nip44.encrypt(plain, nip44.utils.getConversationKey(sk, peer)),
  },
  signEvent: async (t: any) => finalizeEvent(t, sk),
});
const wrapFor = (wraps: { tags: string[][] }[], pk: string) => wraps.find((w) => w.tags.some((t) => t[0] === "p" && t[1] === pk))! as any;

/**
 * A several-person message the way the spec (and Amethyst, Brainstorm) builds
 * it: ONE message naming every recipient, sealed and wrapped once per person,
 * the sender included. Built with nostr-tools' NIP-59, not our own builder.
 */
function groupMessage(from: { sk: Uint8Array; pk: string }, to: string[], content: string, extraTags: string[][] = []) {
  const event = { kind: 14, content, created_at: 1_790_000_000, tags: [...to.map((pk) => ["p", pk]), ...extraTags] };
  return [from.pk, ...to].map((pk) => nip59.wrapEvent(event, from.sk, pk));
}

describe("messages other apps send, opened here", () => {
  const me = person(), alice = person(), bob = person();
  beforeEach(() => clearProcessedWraps());

  it("a one-to-one message from Alice is filed under Alice", async () => {
    const wrap = nip17.wrapEvent(alice.sk, { publicKey: me.pk }, "hello");
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrap as any);
    expect(opened?.content).toBe("hello");
    expect(roomKeyOfUnwrapped(opened!, me.pk)).toBe(alice.pk);
  });

  it("a message Alice sent to me and Bob is filed in the three-person chat, not under Alice", async () => {
    const wraps = groupMessage(alice, [me.pk, bob.pk], "dinner at eight?");
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrapFor(wraps, me.pk));
    expect(opened?.content).toBe("dinner at eight?");
    const key = roomKeyOfUnwrapped(opened!, me.pk)!;
    expect(isGroupRoom(key)).toBe(true);
    expect(roomMembers(key)).toEqual([alice.pk, bob.pk].sort());
  });

  it("Bob opens the same message into the same chat (seen from his side)", async () => {
    const wraps = groupMessage(alice, [me.pk, bob.pk], "dinner at eight?");
    const mine = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrapFor(wraps, me.pk));
    const bobs = await unwrapGiftWrap(signerOf(bob.sk), bob.pk, wrapFor(wraps, bob.pk));
    // One message, one id, for everyone in the chat.
    expect(bobs?.rumorId).toBe(mine?.rumorId);
    expect(roomMembers(roomKeyOfUnwrapped(bobs!, bob.pk)!)).toEqual([alice.pk, me.pk].sort());
  });

  it("the copy of a group message its sender keeps opens into that same chat", async () => {
    const wraps = groupMessage(me, [alice.pk, bob.pk], "on my way");
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrapFor(wraps, me.pk));
    expect(opened?.senderPubkey).toBe(me.pk);
    expect(roomMembers(roomKeyOfUnwrapped(opened!, me.pk)!)).toEqual([alice.pk, bob.pk].sort());
  });

  // nostr-tools' own nip17.wrapManyEvents does NOT build a group: it writes a
  // separate one-recipient message per person (and a note-to-self for the
  // sender). An app built on it fans out one-to-one messages, and that is how
  // they must be filed here — not guessed into a group.
  it("a fan-out of one-to-one messages (nostr-tools' wrapManyEvents) stays one-to-one", async () => {
    const wraps = nip17.wrapManyEvents(alice.sk, [{ publicKey: me.pk }, { publicKey: bob.pk }], "happy new year");
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrapFor(wraps, me.pk));
    expect(roomKeyOfUnwrapped(opened!, me.pk)).toBe(alice.pk);
  });

  it("a chat name set by the sender arrives as the chat's name", async () => {
    const wraps = groupMessage(alice, [me.pk, bob.pk], "Renamed the chat", [["subject", "Lisbon trip"]]);
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrapFor(wraps, me.pk));
    expect(opened?.subject).toBe("Lisbon trip");
  });

  it("a disappearing message says when it goes — from the message, or from its wrap", async () => {
    const at = 1_900_000_000;
    const onMessage = nip59.wrapEvent({ kind: 14, content: "burn after reading", tags: [["p", me.pk], ["expiration", String(at)]] }, alice.sk, me.pk);
    expect((await unwrapGiftWrap(signerOf(me.sk), me.pk, onMessage as any))?.expiresAt).toBe(at);
    const plain = await unwrapGiftWrap(signerOf(me.sk), me.pk, nip17.wrapEvent(alice.sk, { publicKey: me.pk }, "stays") as any);
    expect(plain?.expiresAt).toBeUndefined();
  });

  it("something Alice wrote to Bob, wrapped to me, belongs to no chat of mine", async () => {
    const wrap = nip59.wrapEvent({ kind: 14, content: "for Bob's eyes", tags: [["p", bob.pk]] }, alice.sk, me.pk);
    const opened = await unwrapGiftWrap(signerOf(me.sk), me.pk, wrap as any);
    expect(opened).not.toBeNull();
    expect(roomKeyOfUnwrapped(opened!, me.pk)).toBeNull();
  });
});
