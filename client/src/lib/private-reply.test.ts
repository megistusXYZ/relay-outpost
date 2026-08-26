import { describe, it, expect } from "vitest";
import {
  PRIVATE_REPLY_RUMOR_KIND,
  buildPrivateReplyQuoteTag,
  buildPrivateReplyExtraTags,
  buildPrivateReplyRumor,
  extractPrivateReplyRef,
  isPrivateReply,
} from "./private-reply";

const NOTE_ID = "a".repeat(64);
const AUTHOR = "b".repeat(64);
const SENDER = "c".repeat(64);
const RELAY = "wss://relay.example";

describe("private-reply builder — pinned Nostur/NIP-17 convention", () => {
  it("uses kind 14 so every NIP-17 DM client threads it", () => {
    expect(PRIVATE_REPLY_RUMOR_KIND).toBe(14);
  });

  it("builds a q quote tag in Nostur's public-quote form [q, id, relay, author]", () => {
    expect(buildPrivateReplyQuoteTag(NOTE_ID, AUTHOR, RELAY)).toEqual([
      "q",
      NOTE_ID,
      RELAY,
      AUTHOR,
    ]);
  });

  it("keeps positional placeholders so author stays at index 3 without a relay hint", () => {
    expect(buildPrivateReplyQuoteTag(NOTE_ID, AUTHOR)).toEqual(["q", NOTE_ID, "", AUTHOR]);
  });

  it("extraTags contribute only the quote tag (recipient p-tag is added by the gift-wrap builder)", () => {
    const tags = buildPrivateReplyExtraTags(NOTE_ID, AUTHOR, RELAY);
    expect(tags).toHaveLength(1);
    expect(tags[0][0]).toBe("q");
    expect(tags.some((t) => t[0] === "p")).toBe(false);
  });

  it("builds a full rumor template: kind 14 + p(author) + q(note) + content", () => {
    const rumor = buildPrivateReplyRumor({
      senderPubkey: SENDER,
      authorPubkey: AUTHOR,
      noteId: NOTE_ID,
      content: "nice post",
      relayHint: RELAY,
      createdAt: 1700000000,
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe(SENDER);
    expect(rumor.created_at).toBe(1700000000);
    expect(rumor.content).toBe("nice post");
    expect(rumor.tags).toContainEqual(["p", AUTHOR, RELAY]);
    expect(rumor.tags).toContainEqual(["q", NOTE_ID, RELAY, AUTHOR]);
  });

  it("omits the relay hint from the p-tag when none is given", () => {
    const rumor = buildPrivateReplyRumor({
      senderPubkey: SENDER,
      authorPubkey: AUTHOR,
      noteId: NOTE_ID,
      content: "hi",
    });
    expect(rumor.tags).toContainEqual(["p", AUTHOR]);
  });
});

describe("private-reply classifier — receive side", () => {
  it("extracts the quoted note ref (id + author + relay) from a q tag", () => {
    const ref = extractPrivateReplyRef([
      ["p", AUTHOR],
      ["q", NOTE_ID, RELAY, AUTHOR],
    ]);
    expect(ref).toEqual({ noteId: NOTE_ID, authorPubkey: AUTHOR, relayHint: RELAY });
  });

  it("classifies a bare [q, id] (Nostur's minimal form) as a private reply", () => {
    const ref = extractPrivateReplyRef([["q", NOTE_ID]]);
    expect(ref).toEqual({ noteId: NOTE_ID, authorPubkey: undefined, relayHint: undefined });
    expect(isPrivateReply([["q", NOTE_ID]])).toBe(true);
  });

  it("returns null for a normal DM with no q tag (renders as today)", () => {
    expect(extractPrivateReplyRef([["p", AUTHOR]])).toBeNull();
    expect(isPrivateReply([["p", AUTHOR]])).toBe(false);
  });

  it("ignores an addressable q coordinate (kind:pubkey:d) — not a plain-post reply", () => {
    expect(extractPrivateReplyRef([["q", `30023:${AUTHOR}:my-article`]])).toBeNull();
  });

  it("ignores a malformed / non-hex q value", () => {
    expect(extractPrivateReplyRef([["q", "not-a-real-id"]])).toBeNull();
  });

  it("tolerates missing / non-array tags", () => {
    expect(extractPrivateReplyRef(undefined)).toBeNull();
    expect(extractPrivateReplyRef([])).toBeNull();
  });

  it("round-trips: a rumor built by the builder classifies back to the same note", () => {
    const rumor = buildPrivateReplyRumor({
      senderPubkey: SENDER,
      authorPubkey: AUTHOR,
      noteId: NOTE_ID,
      content: "reply",
      relayHint: RELAY,
    });
    const ref = extractPrivateReplyRef(rumor.tags);
    expect(ref?.noteId).toBe(NOTE_ID);
    expect(ref?.authorPubkey).toBe(AUTHOR);
  });
});
