import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { readableLine, mentionedPubkeys, splitMessage } from "./dm-text";

const ALICE = "a1".repeat(32);
const BOB = "b2".repeat(32);
const NOTE = "c3".repeat(32);
const npub = (pk: string) => nip19.npubEncode(pk);
const names: Record<string, string> = { [ALICE]: "Alice", [BOB]: "Bob" };
const nameOf = (pk: string) => names[pk] ?? null;

describe("a private message shown on one line (list preview, reply quote, search result)", () => {
  it("shows a mention as the person's name, not their address", () => {
    expect(readableLine(`hey nostr:${npub(ALICE)} are you in?`, nameOf)).toBe("hey @Alice are you in?");
  });

  it("handles several mentions, and the same person twice", () => {
    expect(readableLine(`nostr:${npub(ALICE)} and nostr:${npub(BOB)}, then nostr:${npub(ALICE)} again`, nameOf))
      .toBe("@Alice and @Bob, then @Alice again");
  });

  it("reads the longer address form too", () => {
    const nprofile = nip19.nprofileEncode({ pubkey: BOB, relays: ["wss://relay.example"] });
    expect(readableLine(`ask nostr:${nprofile}`, nameOf)).toBe("ask @Bob");
  });

  it("reads an address pasted without the nostr: prefix", () => {
    expect(readableLine(`this is ${npub(ALICE)}`, nameOf)).toBe("this is @Alice");
  });

  it("someone this device doesn't know yet is still not shown as code", () => {
    const stranger = "d4".repeat(32);
    const line = readableLine(`cc nostr:${npub(stranger)}`, nameOf);
    expect(line).toBe("cc @someone");
    expect(line).not.toContain("npub1");
  });

  it("a shared post or article is named for what it is", () => {
    const nevent = nip19.neventEncode({ id: NOTE, relays: [] });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: ALICE, identifier: "my-essay", relays: [] });
    expect(readableLine(`look nostr:${nip19.noteEncode(NOTE)}`, nameOf)).toBe("look a post");
    expect(readableLine(`look nostr:${nevent}`, nameOf)).toBe("look a post");
    expect(readableLine(`read nostr:${naddr}`, nameOf)).toBe("read an article");
  });

  it("a code that doesn't decode is not shown either", () => {
    const line = readableLine("see nostr:npub1notarealaddressatall", nameOf);
    expect(line).toBe("see a link");
  });

  it("leaves ordinary text, links and an email address alone", () => {
    const text = "mail me at npub@example.com or see https://example.com/npub1";
    expect(readableLine(text, nameOf)).toBe(text);
    expect(readableLine("no mentions here", nameOf)).toBe("no mentions here");
  });
});

describe("who a message mentions", () => {
  it("lists each person once, in order", () => {
    expect(mentionedPubkeys(`nostr:${npub(BOB)} nostr:${npub(ALICE)} nostr:${npub(BOB)}`)).toEqual([BOB, ALICE]);
  });

  it("is empty for a message that mentions nobody", () => {
    expect(mentionedPubkeys("hello")).toEqual([]);
    expect(mentionedPubkeys(`nostr:${nip19.noteEncode(NOTE)}`)).toEqual([]);
  });
});

describe("a message body, split into its text and what it shares", () => {
  const note = nip19.noteEncode(NOTE);
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey: ALICE, identifier: "my-essay", relays: [] });

  it("keeps mentions in the text, where they are drawn as names", () => {
    const out = splitMessage(`hey nostr:${npub(ALICE)} look`);
    expect(out.text).toBe(`hey nostr:${npub(ALICE)} look`);
    expect(out.shared).toEqual([]);
  });

  it("takes a shared post or article out of the text, to be drawn as a card under it", () => {
    const out = splitMessage(`have you seen this? nostr:${note}`);
    expect(out.text).toBe("have you seen this?");
    expect(out.shared).toEqual([`nostr:${note}`]);
  });

  it("a message that is only a shared post has no text left", () => {
    expect(splitMessage(`nostr:${naddr}`)).toEqual({ text: "", shared: [`nostr:${naddr}`] });
  });

  it("lists each shared thing once, in order", () => {
    const out = splitMessage(`nostr:${note} then nostr:${naddr} and nostr:${note} again`);
    expect(out.shared).toEqual([`nostr:${note}`, `nostr:${naddr}`]);
    expect(out.text).toBe("then and again");
  });

  it("treats an address pasted without the nostr: prefix the same way", () => {
    expect(splitMessage(`ping ${npub(BOB)}`).text).toBe(`ping nostr:${npub(BOB)}`);
    expect(splitMessage(`see ${note}`)).toEqual({ text: "see", shared: [`nostr:${note}`] });
  });

  it("drops a code that decodes to nothing, and keeps line breaks", () => {
    expect(splitMessage("broken nostr:nevent1zzzz here").text).toBe("broken here");
    expect(splitMessage("line one\nline two").text).toBe("line one\nline two");
  });

  it("leaves a message with nothing in it to change exactly as it was", () => {
    const text = "  plain text,   with its own spacing  ";
    expect(splitMessage(text)).toEqual({ text, shared: [] });
  });
});
