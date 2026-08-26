/**
 * A dimmed chip is a CLAIM: "we asked, and there is nothing here." These pin
 * the two ways that claim goes wrong — dimming before the answer arrived
 * (hides delayed-loading content), and staying dim after content arrives.
 */
import { describe, it, expect } from "vitest";
import { chipDimmed } from "./profile-chips";

describe("chipDimmed", () => {
  it("never dims while the fetch is still out — unknown is not empty", () => {
    expect(chipDimmed("articles", { answered: false, count: 0 })).toBe(false);
  });

  it("dims only on a confirmed empty", () => {
    expect(chipDimmed("articles", { answered: true, count: 0 })).toBe(true);
  });

  it("un-dims the moment data arrives", () => {
    expect(chipDimmed("articles", { answered: true, count: 3 })).toBe(false);
  });

  it("missing evidence renders normal, not dim", () => {
    expect(chipDimmed("media", undefined)).toBe(false);
  });

  it("'all' never dims, even confirmed-empty", () => {
    expect(chipDimmed("all", { answered: true, count: 0 })).toBe(false);
  });
});
