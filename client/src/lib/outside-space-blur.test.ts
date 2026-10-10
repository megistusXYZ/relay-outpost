/**
 * Media from people outside your space stays blurred until tapped (owner,
 * 2026-10-10). The blur used to fire only on a NIP-36 content-warning tag,
 * so a stranger's unlabelled picture loaded in full. For a new account the
 * rule is wider: a picture from someone you don't follow and your network
 * doesn't vouch for is blurred, and a picture labelled sensitive by its own
 * hashtags or caption is blurred even from someone you follow. Off for
 * everyone who already has an account (absence = off); on for new ones.
 */
import { describe, it, expect } from "vitest";
import { blurOutsideEnabled, outsideSpaceBlurReason } from "./outside-space-blur";

const ME = "me".padEnd(64, "0");
const FRIEND = "f".repeat(64);
const STRANGER = "s".repeat(64);
const base = { enabled: true, viewer: ME, follows: new Set([FRIEND]), tierOf: () => "none" as string, event: { tags: [] as string[][], content: "a picture" } };

describe("blurOutsideEnabled", () => {
  it("is off when nothing is stored — an existing account sees no change", () => {
    expect(blurOutsideEnabled(null)).toBe(false);
    expect(blurOutsideEnabled(undefined)).toBe(false);
  });
  it("is on only for the stored opt-in", () => {
    expect(blurOutsideEnabled("1")).toBe(true);
    expect(blurOutsideEnabled("0")).toBe(false);
    expect(blurOutsideEnabled("yes")).toBe(false);
  });
});

describe("outsideSpaceBlurReason", () => {
  it("a stranger's picture is blurred, with the reason in plain words", () => {
    expect(outsideSpaceBlurReason({ ...base, author: STRANGER })).toBe("From outside your space");
  });
  it("a friend's picture is not", () => {
    expect(outsideSpaceBlurReason({ ...base, author: FRIEND })).toBeNull();
  });
  it("your own picture is not", () => {
    expect(outsideSpaceBlurReason({ ...base, author: ME })).toBeNull();
  });
  it("someone your network vouches for is not a stranger", () => {
    expect(outsideSpaceBlurReason({ ...base, author: STRANGER, tierOf: () => "strong" })).toBeNull();
    expect(outsideSpaceBlurReason({ ...base, author: STRANGER, tierOf: () => "moderate" })).toBeNull();
    expect(outsideSpaceBlurReason({ ...base, author: STRANGER, tierOf: () => "weak" })).toBe("From outside your space");
  });
  it("a picture its author labelled sensitive is blurred even from a friend", () => {
    expect(outsideSpaceBlurReason({ ...base, author: FRIEND, event: { tags: [["t", "nsfw"]], content: "" } })).toBe("Sensitive");
    expect(outsideSpaceBlurReason({ ...base, author: FRIEND, event: { tags: [], content: "late night, nsfw" } })).toBe("Sensitive");
  });
  it("off: nothing is blurred by this rule", () => {
    expect(outsideSpaceBlurReason({ ...base, enabled: false, author: STRANGER })).toBeNull();
    expect(outsideSpaceBlurReason({ ...base, enabled: false, author: FRIEND, event: { tags: [["t", "nsfw"]], content: "" } })).toBeNull();
  });
});
