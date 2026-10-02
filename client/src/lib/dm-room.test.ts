/**
 * Private (NIP-17) conversations: who is in one, what it is called, and when a
 * message in it stops being shown.
 *
 * Until 2026-10-02 only the first `p` tag was read and every message was filed
 * under its sender: a message Alice sent to you AND Bob showed up in your
 * one-to-one chat with Alice, and your reply went to Alice alone.
 */
import { describe, it, expect } from "vitest";
import {
  participantsOf, roomKeyFor, isGroupRoom, roomMembers, roomKeyOfMembers, roomSlug, roomKeyFromSlug,
  subjectOf, expirationOf, isExpired, groupTitle, newerSubject, GROUP_ROOM_PREFIX,
} from "./dm-room";
import { nip19 } from "nostr-tools";

const ME = "a".repeat(64);
const ALICE = "b".repeat(64);
const BOB = "c".repeat(64);
const CAROL = "d".repeat(64);
const p = (...pks: string[]) => pks.map((pk) => ["p", pk]);

describe("which chat a message belongs to", () => {
  it("a message from Alice to me is my chat with Alice — keyed by her key, as it always was", () => {
    expect(roomKeyFor({ sender: ALICE, tags: p(ME) }, ME)).toBe(ALICE);
  });

  it("my own message to Alice (the copy I keep) is the same chat", () => {
    expect(roomKeyFor({ sender: ME, tags: p(ALICE) }, ME)).toBe(ALICE);
  });

  it("a message from Alice to me AND Bob is a different chat: the three of us", () => {
    const key = roomKeyFor({ sender: ALICE, tags: p(ME, BOB) }, ME);
    expect(key).not.toBe(ALICE);
    expect(isGroupRoom(key)).toBe(true);
    expect(roomMembers(key!)).toEqual([ALICE, BOB]);
  });

  it("everyone in that chat computes the same chat, whoever wrote and in whatever order the tags come", () => {
    const fromAlice = roomKeyFor({ sender: ALICE, tags: p(ME, BOB) }, ME);
    const fromBob = roomKeyFor({ sender: BOB, tags: p(ALICE, ME) }, ME);
    const fromMe = roomKeyFor({ sender: ME, tags: p(BOB, ALICE) }, ME);
    expect(fromBob).toBe(fromAlice);
    expect(fromMe).toBe(fromAlice);
  });

  it("adding someone is, by definition, a different chat", () => {
    const three = roomKeyFor({ sender: ALICE, tags: p(ME, BOB) }, ME);
    const four = roomKeyFor({ sender: ALICE, tags: p(ME, BOB, CAROL) }, ME);
    expect(four).not.toBe(three);
  });

  it("a message that doesn't name me is not said to me: it belongs to no chat of mine", () => {
    // Alice wraps to me something she wrote to Bob. It must not read as hers to me.
    expect(roomKeyFor({ sender: ALICE, tags: p(BOB) }, ME)).toBeNull();
    expect(roomKeyFor({ sender: ALICE, tags: [] }, ME)).toBeNull();
  });

  it("a note to myself is no chat (this app has none)", () => {
    expect(roomKeyFor({ sender: ME, tags: p(ME) }, ME)).toBeNull();
    expect(roomKeyFor({ sender: ME, tags: [] }, ME)).toBeNull();
  });

  it("a repeated name, a relay hint on the tag and a malformed tag change nothing", () => {
    const tags = [["p", ME, "wss://inbox.example"], ["p", BOB], ["p", BOB], ["p", "not-a-key"], ["p"], ["e", CAROL]];
    expect(participantsOf(ALICE, tags)).toEqual([ME, ALICE, BOB].sort());
    expect(roomMembers(roomKeyFor({ sender: ALICE, tags }, ME)!)).toEqual([ALICE, BOB]);
  });

  it("a group key can never be mistaken for a person's key", () => {
    const key = roomKeyOfMembers([ALICE, BOB])!;
    expect(key.startsWith(GROUP_ROOM_PREFIX)).toBe(true);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(false);
    expect(roomKeyOfMembers([ALICE])).toBe(ALICE);
    expect(roomMembers(ALICE)).toEqual([ALICE]);
    expect(roomKeyOfMembers([])).toBeNull();
  });
});

describe("the chat in the address bar", () => {
  it("a one-to-one chat is the person's npub, as before", () => {
    expect(roomSlug(ALICE)).toBe(nip19.npubEncode(ALICE));
    expect(roomKeyFromSlug(nip19.npubEncode(ALICE), ME)).toBe(ALICE);
  });

  it("a group is its people's npubs joined by +, and comes back as the same chat", () => {
    const key = roomKeyOfMembers([BOB, ALICE])!;
    const slug = roomSlug(key);
    expect(slug).toBe(`${nip19.npubEncode(ALICE)}+${nip19.npubEncode(BOB)}`);
    expect(roomKeyFromSlug(slug, ME)).toBe(key);
    expect(roomKeyFromSlug(encodeURIComponent(slug), ME)).toBe(key);
  });

  it("a hex key still opens a chat (old links), and my own key in the list is ignored", () => {
    expect(roomKeyFromSlug(ALICE, ME)).toBe(ALICE);
    expect(roomKeyFromSlug(`${nip19.npubEncode(ME)}+${nip19.npubEncode(ALICE)}`, ME)).toBe(ALICE);
  });

  it("anything else is no chat, not a crash", () => {
    for (const bad of ["", "hello", "npub1nope", "%zz", nip19.noteEncode(ALICE)]) expect(roomKeyFromSlug(bad, ME)).toBeNull();
  });
});

describe("chat names (the subject tag)", () => {
  it("a message can name the chat", () => {
    expect(subjectOf([["p", ME], ["subject", "  Lisbon trip  "]])).toBe("Lisbon trip");
  });

  it("no subject, or an empty one, names nothing", () => {
    expect(subjectOf([["p", ME]])).toBeUndefined();
    expect(subjectOf([["subject", "   "]])).toBeUndefined();
    expect(subjectOf(undefined)).toBeUndefined();
  });

  it("a name is one short line, whatever was sent", () => {
    expect(subjectOf([["subject", "two\nlines"]])).toBe("two lines");
    expect(subjectOf([["subject", "x".repeat(500)]])).toHaveLength(80);
  });

  it("the newest name wins, even when an older rename arrives later", () => {
    const afterNew = newerSubject(undefined, { subject: "Second", at: 200 });
    expect(newerSubject(afterNew, { subject: "First", at: 100 })).toEqual({ subject: "Second", subjectAt: 200 });
    expect(newerSubject(afterNew, { subject: "Third", at: 300 })).toEqual({ subject: "Third", subjectAt: 300 });
  });

  it("an ordinary message leaves the name alone", () => {
    expect(newerSubject({ subject: "Lisbon trip", subjectAt: 100 }, { at: 999 })).toEqual({ subject: "Lisbon trip", subjectAt: 100 });
  });

  it("a group nobody named is called by its people", () => {
    expect(groupTitle(["Alice", "Bob"])).toBe("Alice, Bob");
    expect(groupTitle(["Alice", "Bob", "Carol", "Dan", "Eve"])).toBe("Alice, Bob, Carol +2");
  });
});

describe("disappearing messages (the expiration tag)", () => {
  it("reads when a message stops being shown", () => {
    expect(expirationOf([["p", ME], ["expiration", "1790000000"]])).toBe(1790000000);
  });

  it("no tag, or a tag that isn't a time, is no expiry — the message stays", () => {
    for (const tags of [[["p", ME]], [["expiration", "soon"]], [["expiration", ""]], [["expiration", "-5"]], [["expiration", "0"]]]) {
      expect(expirationOf(tags)).toBeUndefined();
    }
  });

  it("a message is gone from the moment its time is reached", () => {
    expect(isExpired(1000, 999)).toBe(false);
    expect(isExpired(1000, 1000)).toBe(true);
    expect(isExpired(1000, 5000)).toBe(true);
    expect(isExpired(undefined, 5000)).toBe(false);
  });
});
