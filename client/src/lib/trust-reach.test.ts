/**
 * "No score" means unknown, not untrusted (owner decision, 2026-09-28).
 * When the global scores API died, every stranger lost their score and the
 * For You feed's Balanced/Open reach ("global") dropped them all. Unknown
 * people are shown there; the spam and stranger-quality floors still apply.
 * Only an explicit narrow reach (Strict's 2 hops, or a custom 1/3 hops) keeps
 * leaving them out.
 */
import { describe, it, expect } from "vitest";
import { reachAdmits } from "./trust-reach";

const stranger = (score: number | undefined) => ({ followed: false, followOfFollow: false, score });

describe("reachAdmits", () => {
  it("Balanced/Open (global) shows an author with no score", () => {
    expect(reachAdmits("global", stranger(undefined))).toBe(true);
  });

  it("Balanced/Open still leave out an author scored with no trust at all", () => {
    expect(reachAdmits("global", stranger(0))).toBe(false);
    expect(reachAdmits("global", stranger(0.3))).toBe(true);
  });

  it("people you follow are always in", () => {
    expect(reachAdmits("1hop", { followed: true, followOfFollow: false, score: undefined })).toBe(true);
  });

  it("the narrow reaches stay narrow", () => {
    expect(reachAdmits("1hop", { followed: false, followOfFollow: true, score: 0.9 })).toBe(false);
    expect(reachAdmits("2hops", { followed: false, followOfFollow: true, score: undefined })).toBe(true);
    expect(reachAdmits("2hops", stranger(0.9))).toBe(false);
    expect(reachAdmits("3hops", stranger(undefined))).toBe(false);
    expect(reachAdmits("3hops", stranger(0.05))).toBe(true);
  });

  it("off admits everyone", () => {
    expect(reachAdmits("off", stranger(undefined))).toBe(true);
  });
});
