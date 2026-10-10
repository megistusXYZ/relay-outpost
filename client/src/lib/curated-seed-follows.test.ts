/**
 * A new account's anchor follows (owner, 2026-10-10: "your space first").
 * An account made here starts with the people it actually knows: the friend
 * who invited it, or nobody. It used to also follow a curated seed (jack) so
 * no feed was ever empty — but that put a stranger's posts first, before the
 * person had made a single choice. The curated seeds remain suggestions
 * (the people strip), never silent follows.
 */
import { describe, it, expect } from "vitest";
import { buildAnchorFollows, CURATED_SEED_PUBKEYS } from "./curated-seed-follows";

const inviter = "inviter".padEnd(64, "0");

describe("buildAnchorFollows", () => {
  it("no inviter → nobody: the feed starts with your own choices", () => {
    expect(buildAnchorFollows(null)).toEqual([]);
    expect(buildAnchorFollows(undefined)).toEqual([]);
  });

  it("an inviter → the inviter, nobody else", () => {
    expect(buildAnchorFollows(inviter)).toEqual([inviter]);
  });

  it("the curated seeds are still there for suggestions, and never in the anchor", () => {
    expect(CURATED_SEED_PUBKEYS.length).toBeGreaterThan(0);
    expect(buildAnchorFollows(null)).not.toContain(CURATED_SEED_PUBKEYS[0]);
    expect(buildAnchorFollows(inviter)).not.toContain(CURATED_SEED_PUBKEYS[0]);
  });
});
