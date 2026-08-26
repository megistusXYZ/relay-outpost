import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { toHexPubkey, isNip11Operator, type Nip11Document } from "./nip11";

const HEX = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const NPUB = nip19.npubEncode(HEX);

describe("toHexPubkey", () => {
  it("passes through lowercase hex", () => {
    expect(toHexPubkey(HEX)).toBe(HEX);
  });

  it("lowercases uppercase hex", () => {
    expect(toHexPubkey(HEX.toUpperCase())).toBe(HEX);
  });

  it("trims surrounding whitespace", () => {
    expect(toHexPubkey(`  ${HEX}\n`)).toBe(HEX);
  });

  it("decodes an npub to hex", () => {
    expect(toHexPubkey(NPUB)).toBe(HEX);
  });

  it("returns undefined for a malformed npub", () => {
    expect(toHexPubkey("npub1notreal")).toBeUndefined();
  });

  it("returns undefined for non-string / empty / short input", () => {
    expect(toHexPubkey(undefined)).toBeUndefined();
    expect(toHexPubkey(null)).toBeUndefined();
    expect(toHexPubkey(123)).toBeUndefined();
    expect(toHexPubkey("")).toBeUndefined();
    expect(toHexPubkey("deadbeef")).toBeUndefined();
  });
});

describe("isNip11Operator", () => {
  const doc = (over: Partial<Nip11Document>): Nip11Document => ({ ...over });

  it("matches the published operator pubkey", () => {
    expect(isNip11Operator(doc({ pubkey: HEX }), HEX)).toBe(true);
  });

  it("matches a listed moderator", () => {
    const other = "1".repeat(64);
    expect(isNip11Operator(doc({ pubkey: other, moderators: [HEX] }), HEX)).toBe(true);
  });

  it("rejects a stranger", () => {
    expect(isNip11Operator(doc({ pubkey: "1".repeat(64) }), HEX)).toBe(false);
  });

  it("rejects when there is no operator info", () => {
    expect(isNip11Operator(doc({}), HEX)).toBe(false);
  });

  it("is false for null doc or missing pubkey", () => {
    expect(isNip11Operator(null, HEX)).toBe(false);
    expect(isNip11Operator(undefined, HEX)).toBe(false);
    expect(isNip11Operator(doc({ pubkey: HEX }), null)).toBe(false);
    expect(isNip11Operator(doc({ pubkey: HEX }), undefined)).toBe(false);
  });
});
