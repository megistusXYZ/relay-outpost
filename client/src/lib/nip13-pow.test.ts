import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import { powDifficulty, committedPowDifficulty, effectivePow } from "./nip13-pow";

// Minimal event stub — only id/tags are read by this module.
const ev = (id: string, tags: string[][] = []): Pick<Event, "id" | "tags"> => ({ id, tags });

const HEX64 = (prefix: string) => prefix + "f".repeat(64 - prefix.length);

describe("powDifficulty — leading zero BITS of the id", () => {
  it("counts whole leading zero hex chars (4 bits each)", () => {
    expect(powDifficulty(HEX64(""))).toBe(0); // starts with 'f'
    expect(powDifficulty(HEX64("0"))).toBe(4); // one zero nibble, then 'f'
    expect(powDifficulty(HEX64("00"))).toBe(8);
    expect(powDifficulty(HEX64("000"))).toBe(12);
    expect(powDifficulty(HEX64("0000"))).toBe(16);
  });

  it("adds the leading zeros WITHIN the first set nibble", () => {
    // 0b0001 → 3 leading zeros inside the nibble.
    expect(powDifficulty(HEX64("1"))).toBe(3);
    // 0b0010 / 0b0011 → 2.
    expect(powDifficulty(HEX64("2"))).toBe(2);
    expect(powDifficulty(HEX64("3"))).toBe(2);
    // 0b0100..0b0111 → 1.
    expect(powDifficulty(HEX64("4"))).toBe(1);
    expect(powDifficulty(HEX64("7"))).toBe(1);
    // 0b1000..0b1111 → 0.
    expect(powDifficulty(HEX64("8"))).toBe(0);
    expect(powDifficulty(HEX64("f"))).toBe(0);
  });

  it("combines whole zero nibbles with the first set nibble (boundary)", () => {
    // '000' = 12, then '1' (0b0001) = +3 → 15.
    expect(powDifficulty(HEX64("0001"))).toBe(15);
    // '00' = 8, then '8' (0b1000) = +0 → 8.
    expect(powDifficulty(HEX64("008"))).toBe(8);
    // '0000' = 16, then '4' (0b0100) = +1 → 17.
    expect(powDifficulty("00004" + "f".repeat(59))).toBe(17);
  });

  it("uses the NIP-13 spec example id (36 leading zero bits)", () => {
    // From the NIP-13 spec: 000000000e9d97a1... → 9 zero nibbles (36) then 'e' → +0.
    const id = "000000000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d";
    expect(powDifficulty(id)).toBe(36);
  });

  it("stops counting at a non-hex character", () => {
    expect(powDifficulty("00z000")).toBe(8); // two zero nibbles, then 'z' stops
  });
});

describe("committedPowDifficulty — the nonce tag's target", () => {
  it("returns the target committed in the nonce tag (3rd element)", () => {
    expect(committedPowDifficulty(ev("", [["nonce", "776797", "21"]]))).toBe(21);
  });

  it("returns 0 when there is no nonce tag", () => {
    expect(committedPowDifficulty(ev("", [["e", "abc"]]))).toBe(0);
    expect(committedPowDifficulty(ev("", []))).toBe(0);
  });

  it("returns 0 when the nonce target is missing or unparseable", () => {
    expect(committedPowDifficulty(ev("", [["nonce", "776797"]]))).toBe(0);
    expect(committedPowDifficulty(ev("", [["nonce", "776797", "abc"]]))).toBe(0);
  });
});

describe("effectivePow — min(actual, committed) with/without a nonce tag", () => {
  it("without a nonce tag, uses the actual leading-zero bits", () => {
    // '00' → 8 actual bits, no nonce.
    expect(effectivePow(ev(HEX64("00")))).toBe(8);
  });

  it("with a nonce tag, credits min(actual, committed target)", () => {
    // actual '0000' = 16 bits, committed 20 → min = 16 (author over-claimed).
    expect(effectivePow(ev(HEX64("0000"), [["nonce", "1", "20"]]))).toBe(16);
    // actual '0000' = 16 bits, committed 8 → min = 8 (honor the lower claim).
    expect(effectivePow(ev(HEX64("0000"), [["nonce", "1", "8"]]))).toBe(8);
  });

  it("a nonce tag with no/zero target credits 0 even if the id happens to have zeros", () => {
    // Guards against crediting an accidentally-low id: committed target = 0.
    expect(effectivePow(ev(HEX64("0000"), [["nonce", "1"]]))).toBe(0);
  });

  it("no PoW at all → 0", () => {
    expect(effectivePow(ev(HEX64("")))).toBe(0);
  });
});
