import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyScoreFields } from "./fuzzy-match";

describe("fuzzyScore", () => {
  it("returns 0 for empty query or text", () => {
    expect(fuzzyScore("", "bitcoin")).toBe(0);
    expect(fuzzyScore("bitcoin", "")).toBe(0);
  });

  it("ranks exact match highest, then prefix, then substring", () => {
    const exact = fuzzyScore("bitcoin", "bitcoin");
    const prefix = fuzzyScore("bit", "bitcoin");
    const substr = fuzzyScore("coin", "bitcoin");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substr);
    expect(substr).toBeGreaterThan(0);
  });

  it("tolerates typos (the exact-spelling-only complaint)", () => {
    // "bitcon" (missing 'i') should still match a bitcoin relay...
    const hit = fuzzyScore("bitcon", "Bitcoin Dev Relay");
    expect(hit).toBeGreaterThan(0);
    // ...and rank it above an unrelated relay.
    const miss = fuzzyScore("bitcon", "General Chat Relay");
    expect(hit).toBeGreaterThan(miss);
  });

  it("matches a misspelled multi-token query against hyphenated names", () => {
    expect(fuzzyScore("notsr band", "nostr-band")).toBeGreaterThan(0);
  });

  it("does not match clearly unrelated text", () => {
    expect(fuzzyScore("bitcoin", "cooking recipes")).toBe(0);
  });

  it("fuzzyScoreFields takes the best of several fields", () => {
    const score = fuzzyScoreFields("bitcon", [
      "Some Relay",
      "A place to talk about bitcoin and lightning",
      undefined,
    ]);
    expect(score).toBeGreaterThan(0);
  });
});
