import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { sayHiDefault, encodeInviteConnect, decodeInviteConnect, inviterFromCreator } from "./invite-connect";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("sayHiDefault — the first message an invited friend sends", () => {
  it("thanks the inviter without naming the product", () => {
    // The invitee is writing to a friend, not filling in a marketing line.
    expect(sayHiDefault()).toBe("👋 Just joined — thanks for the invite!");
  });

  it("names the group when they arrived through a community invite", () => {
    expect(sayHiDefault("Chicago Bitcoin")).toBe("👋 Just joined Chicago Bitcoin — thanks for the invite!");
  });

  it("falls back to the plain line when the name is empty or blank", () => {
    const plain = "👋 Just joined — thanks for the invite!";
    expect(sayHiDefault("")).toBe(plain);
    expect(sayHiDefault("   ")).toBe(plain);
  });

  it("drops an absurdly long group name rather than shipping a mangled sentence", () => {
    expect(sayHiDefault("O".repeat(200))).toBe("👋 Just joined — thanks for the invite!");
  });
});

describe("decodeInviteConnect — a bad marker must never open the card", () => {
  it("round-trips a community arrival", () => {
    const rec = { inviter: HEX, step: "follow" as const, source: "link" as const, context: "Chicago Bitcoin" };
    expect(decodeInviteConnect(encodeInviteConnect(rec))).toEqual(rec);
  });

  it("round-trips a fresh signup with no group context", () => {
    const rec = { inviter: HEX, step: "sayhi" as const, source: "friend" as const };
    expect(decodeInviteConnect(encodeInviteConnect(rec))).toEqual(rec);
  });

  it("returns null for a missing or unparseable marker", () => {
    expect(decodeInviteConnect(null)).toBeNull();
    expect(decodeInviteConnect("")).toBeNull();
    expect(decodeInviteConnect("not json")).toBeNull();
    expect(decodeInviteConnect("[1,2,3]")).toBeNull();
  });

  it("rejects an inviter that isn't a hex pubkey", () => {
    // Anything else would hand an arbitrary string to the follow/DM path.
    for (const bad of ["npub1abc", HEX.toUpperCase(), "a".repeat(63), "z".repeat(64), ""]) {
      expect(decodeInviteConnect(JSON.stringify({ inviter: bad, step: "sayhi", source: "friend" }))).toBeNull();
    }
  });

  it("rejects an unknown step or source", () => {
    expect(decodeInviteConnect(JSON.stringify({ inviter: HEX, step: "wat", source: "friend" }))).toBeNull();
    expect(decodeInviteConnect(JSON.stringify({ inviter: HEX, step: "sayhi", source: "wat" }))).toBeNull();
  });

  it("ignores a non-string context instead of failing the whole record", () => {
    const out = decodeInviteConnect(JSON.stringify({ inviter: HEX, step: "sayhi", source: "friend", context: 42 }));
    expect(out).toEqual({ inviter: HEX, step: "sayhi", source: "friend" });
  });
});

describe("inviterFromCreator — who minted the community link", () => {
  it("decodes the bundle's creator npub to a hex pubkey", () => {
    expect(inviterFromCreator(nip19.npubEncode(HEX), OTHER)).toBe(HEX);
  });

  it("returns null when the bundle carries no creator (older links, direct invites)", () => {
    expect(inviterFromCreator(undefined, OTHER)).toBeNull();
    expect(inviterFromCreator("", OTHER)).toBeNull();
  });

  it("never connects you to yourself — your own link, forwarded back", () => {
    expect(inviterFromCreator(nip19.npubEncode(HEX), HEX)).toBeNull();
  });

  it("returns null for a malformed creator value rather than throwing", () => {
    expect(inviterFromCreator("npub1notreal", OTHER)).toBeNull();
    expect(inviterFromCreator("just a string", OTHER)).toBeNull();
  });

  it("accepts a raw hex creator too (tolerant of either encoding)", () => {
    expect(inviterFromCreator(HEX, OTHER)).toBe(HEX);
  });
});
