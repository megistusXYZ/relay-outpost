/**
 * Your mute list, the same in every app (2026-09-11).
 *
 * From a thread the owner shared: a power user (Daniel) asked Damus for
 * private mute lists; jb55 (Damus) asked Vitor (Amethyst) how Amethyst stores
 * them; Vitor: "Regular Nip44-encrypted nip51 lists." Daniel: "I just want my
 * mute list to work in Damus and Wisp at the same time. Also, I think public
 * mute lists are a bad idea in general." jb55: "Yeah will make it compatible."
 *
 * The shared format is NIP-51's mute list (kind 10000): public entries in the
 * tags; private entries as the same tag list, JSON, encrypted to yourself in
 * the content (NIP-44; older clients used NIP-04). Relay Outpost used to read
 * only the tags and write `content: ""`, so it ignored private mutes, erased
 * them on every save, and published everyone's mutes in the open.
 *
 * These tests use real encryption with a throwaway key, encrypting to itself
 * exactly as a signer does for these lists.
 */
import { describe, expect, it } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { v2 as nip44 } from "nostr-tools/nip44";
import * as nip04 from "nostr-tools/nip04";
import { changesBetween, mutedFrom, planMuteSave, readMuteList } from "./mute-list";

const me = generateSecretKey();
const myPubkey = getPublicKey(me);
const selfKey = nip44.utils.getConversationKey(me, myPubkey);

/** What a NIP-44 signer does when you encrypt to yourself. */
const selfCrypto = {
  nip44: {
    encrypt: async (plaintext: string) => nip44.encrypt(plaintext, selfKey),
    decrypt: async (ciphertext: string) => nip44.decrypt(ciphertext, selfKey),
  },
  nip04: {
    encrypt: async (plaintext: string) => nip04.encrypt(me, myPubkey, plaintext),
    decrypt: async (ciphertext: string) => nip04.decrypt(me, myPubkey, ciphertext),
  },
};

const ALICE = "a".repeat(64);

describe("readMuteList — your mutes, wherever you made them", () => {
  it("applies the mutes Amethyst keeps in the encrypted part of your mute list", async () => {
    const privateTags = [["p", ALICE], ["word", "gossip"]];
    const event = { kind: 10000, tags: [], content: nip44.encrypt(JSON.stringify(privateTags), selfKey) };
    const muted = mutedFrom(await readMuteList(event, selfCrypto));
    expect(muted.pubkeys.has(ALICE)).toBe(true);
    expect(muted.words.has("gossip")).toBe(true);
  });

  /**
   * Lists saved by older clients hold their private part in NIP-04, which
   * reads differently (its ciphertext ends in "?iv="). Those mutes must keep
   * working too, not just the NIP-44 ones.
   */
  it("also reads a private part an older app saved with NIP-04", async () => {
    const event = { kind: 10000, tags: [], content: nip04.encrypt(me, myPubkey, JSON.stringify([["p", ALICE]])) };
    const muted = mutedFrom(await readMuteList(event, selfCrypto));
    expect(muted.pubkeys.has(ALICE)).toBe(true);
  });
});

/**
 * A mute list is one replaceable event: whatever is saved replaces the whole
 * thing in every app. Relay Outpost used to save only the people and words it
 * knew about, with an empty private part, so one mute here wiped the private
 * mutes, muted threads and hashtags made in Amethyst or Damus.
 */
describe("planMuteSave — muting here never erases what you muted elsewhere", () => {
  const BOB = "b".repeat(64);
  const THREAD = "e".repeat(64);

  it("adds the new mute and keeps every entry from other apps, in both halves", async () => {
    const loaded = {
      status: "loaded" as const,
      list: { publicTags: [["t", "nsfw"]], privateTags: [["p", BOB], ["e", THREAD]], privateReadable: true },
    };
    const plan = await planMuteSave(loaded, { action: "add", tag: ["p", ALICE] }, selfCrypto);
    if (!plan.ok) throw new Error(`expected a list to save, got ${plan.reason}`);
    const muted = mutedFrom(await readMuteList(plan.template, selfCrypto));
    expect([...muted.pubkeys].sort()).toEqual([ALICE, BOB].sort());
    expect(muted.threads.has(THREAD)).toBe(true);
    expect(muted.hashtags.has("nsfw")).toBe(true);
  });

  /**
   * Relay Outpost used to save everyone's mutes in the open. The owner's call
   * (after Daniel: "public mute lists are a bad idea in general"): on the next
   * save, those public entries move into the encrypted half. They keep working
   * in every app; others just can't see them any more.
   */
  it("moves mutes that were public into the private half when it saves", async () => {
    const BOB_PUBLIC = { status: "loaded" as const, list: { publicTags: [["p", BOB], ["t", "nsfw"], ["word", "spoiler"]], privateTags: [], privateReadable: true } };
    const plan = await planMuteSave(BOB_PUBLIC, { action: "add", tag: ["p", ALICE] }, selfCrypto);
    if (!plan.ok) throw new Error(`expected a list to save, got ${plan.reason}`);
    expect(plan.template.tags.filter((t) => ["p", "t", "word", "e"].includes(t[0]))).toEqual([]);
    const privateOnly = mutedFrom({ publicTags: [], privateTags: JSON.parse(await selfCrypto.nip44.decrypt(plan.template.content)), privateReadable: true });
    expect([...privateOnly.pubkeys].sort()).toEqual([ALICE, BOB].sort());
    expect(privateOnly.hashtags.has("nsfw")).toBe(true);
    expect(privateOnly.words.has("spoiler")).toBe(true);
  });

  it("unmutes an entry wherever it was kept, public or private, and leaves the rest", async () => {
    const loaded = { status: "loaded" as const, list: { publicTags: [["p", BOB]], privateTags: [["p", ALICE], ["e", THREAD]], privateReadable: true } };
    const readBack = async (plan: Awaited<ReturnType<typeof planMuteSave>>) => {
      if (!plan.ok) throw new Error(`expected a list to save, got ${plan.reason}`);
      return mutedFrom(await readMuteList(plan.template, selfCrypto));
    };

    const withoutAlice = await readBack(await planMuteSave(loaded, { action: "remove", tag: ["p", ALICE] }, selfCrypto));
    expect([...withoutAlice.pubkeys]).toEqual([BOB]);
    expect(withoutAlice.threads.has(THREAD)).toBe(true);

    const withoutBob = await readBack(await planMuteSave(loaded, { action: "remove", tag: ["p", BOB] }, selfCrypto));
    expect([...withoutBob.pubkeys]).toEqual([ALICE]);
  });

  /**
   * If the private half can't be read (the signer declines, or it was written
   * in a way this signer can't open), we don't know what's in it, and saving
   * would replace it with nothing. So the list reads as unreadable, not empty,
   * and nothing is saved over it.
   */
  it("refuses to save over a private half it couldn't read", async () => {
    const stranger = generateSecretKey();
    const strangerKey = nip44.utils.getConversationKey(stranger, getPublicKey(stranger));
    const event = { kind: 10000, tags: [["p", BOB]], content: nip44.encrypt(JSON.stringify([["p", ALICE]]), strangerKey) };

    const list = await readMuteList(event, selfCrypto);
    expect(list.privateReadable).toBe(false);
    expect(mutedFrom(list).pubkeys.has(BOB)).toBe(true);

    const plan = await planMuteSave({ status: "loaded", list }, { action: "add", tag: ["p", THREAD] }, selfCrypto);
    expect(plan).toEqual({ ok: false, reason: "unreadable" });
  });

  /**
   * If the relays never answered, the list we'd save is only what this device
   * knows, and it would replace your real list everywhere (the old code did
   * exactly that after a timeout). So nothing is saved until the list has
   * loaded. A genuinely new account (the relays answered; there's simply no
   * list yet) saves its first one.
   */
  it("won't save when your list never loaded, but saves a brand-new account's first list", async () => {
    const neverLoaded = await planMuteSave({ status: "unknown" }, { action: "add", tag: ["p", ALICE] }, selfCrypto);
    expect(neverLoaded).toEqual({ ok: false, reason: "not-loaded" });

    const first = await planMuteSave({ status: "none" }, { action: "add", tag: ["p", ALICE] }, selfCrypto);
    if (!first.ok) throw new Error(`expected a first list, got ${first.reason}`);
    expect(first.template.tags).toEqual([]);
    expect([...mutedFrom(await readMuteList(first.template, selfCrypto)).pubkeys]).toEqual([ALICE]);
  });

  /**
   * Some signers can't encrypt with NIP-44 (older browser extensions, or a
   * remote signer that declines). The owner's call: the mute still works on
   * this device and says so; it's never saved publicly instead. So the plan
   * names the reason, and the app shows the right note.
   */
  it("says it can't encrypt, rather than saving your mutes in public, when the signer has no NIP-44", async () => {
    const loaded = { status: "loaded" as const, list: { publicTags: [], privateTags: [["p", BOB]], privateReadable: true } };
    const olderSigner = { nip04: selfCrypto.nip04 };
    const plan = await planMuteSave(loaded, { action: "add", tag: ["p", ALICE] }, olderSigner);
    expect(plan).toEqual({ ok: false, reason: "cannot-encrypt" });
  });

  /**
   * After saving, the app needs the list as it now stands. Reading it back
   * would ask your signer to decrypt it again: a prompt, or a slow round trip,
   * on a remote signer, for every single mute.
   */
  it("hands back the list as it stands after saving, without asking your signer to read it again", async () => {
    const loaded = { status: "loaded" as const, list: { publicTags: [["p", BOB]], privateTags: [], privateReadable: true } };
    const plan = await planMuteSave(loaded, { action: "add", tag: ["p", ALICE] }, selfCrypto);
    if (!plan.ok) throw new Error(`expected a list to save, got ${plan.reason}`);
    expect(plan.next).toEqual(await readMuteList(plan.template, selfCrypto));
  });

  /**
   * Muting from a feed can queue several changes within the moment before the
   * list is saved. Saving them together means one encryption, one signer
   * prompt, one event, rather than one per mute.
   */
  it("saves several changes at once, in order", async () => {
    const loaded = { status: "loaded" as const, list: { publicTags: [], privateTags: [["p", BOB]], privateReadable: true } };
    const plan = await planMuteSave(
      loaded,
      [
        { action: "add", tag: ["p", ALICE] },
        { action: "remove", tag: ["p", BOB] },
        { action: "add", tag: ["word", "spoiler"] },
      ],
      selfCrypto,
    );
    if (!plan.ok) throw new Error(`expected a list to save, got ${plan.reason}`);
    expect(plan.next.privateTags).toEqual([["p", ALICE], ["word", "spoiler"]]);
  });
});

/**
 * Mute buttons all over the app change what this device hides; the list is
 * saved a moment later. What gets saved is exactly the difference: who and
 * what you muted or unmuted here since the last save. Nothing else is touched,
 * so entries from other apps are never replaced by this device's view.
 */
describe("changesBetween — what you changed here since the last save", () => {
  it("turns people and words muted or unmuted on this device into list changes", () => {
    const BOB = "b".repeat(64);
    const changes = changesBetween(
      { pubkeys: [BOB], words: ["spoiler"] },
      { pubkeys: [ALICE], words: ["spoiler", "Gossip"] },
    );
    expect(changes).toEqual([
      { action: "add", tag: ["p", ALICE] },
      { action: "remove", tag: ["p", BOB] },
      { action: "add", tag: ["word", "gossip"] },
    ]);
  });
});
