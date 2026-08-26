// A new account's anchor follows — deliberately minimal + deterministic
// (frictionless onboarding): everyone follows exactly the first curated seed
// (jack); invite-link arrivals additionally lead with their inviter.
import { describe, it, expect } from "vitest";
import { buildAnchorFollows } from "./curated-seed-follows";

const SEEDS = Array.from({ length: 10 }, (_, i) => `seed${i}`.padEnd(64, "0"));

describe("buildAnchorFollows", () => {
  it("no inviter → exactly the first curated seed (jack)", () => {
    expect(buildAnchorFollows(null, SEEDS)).toEqual([SEEDS[0]]);
  });

  it("inviter leads, then jack — nothing else", () => {
    const inviter = "inviter".padEnd(64, "0");
    expect(buildAnchorFollows(inviter, SEEDS)).toEqual([inviter, SEEDS[0]]);
  });

  it("never duplicates the inviter when they ARE the first seed", () => {
    expect(buildAnchorFollows(SEEDS[0], SEEDS)).toEqual([SEEDS[0]]);
  });

  it("empty seed list → inviter only / empty", () => {
    const inviter = "inviter".padEnd(64, "0");
    expect(buildAnchorFollows(inviter, [])).toEqual([inviter]);
    expect(buildAnchorFollows(null, [])).toEqual([]);
  });
});
