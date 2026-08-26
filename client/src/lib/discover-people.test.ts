/**
 * "People to follow" — the ranking half, kept pure because every rule in it is
 * a safety or trust rule (DISCOVER_BENTO_PLAN.md round 2, #15/#16):
 *
 *  - friends-of-follows FIRST: people followed by several of YOUR follows are
 *    the un-gameable signal; trending only fills what's left
 *  - the flagged floor runs BEFORE render — a trending list is exactly where a
 *    shield-hidden account would otherwise get recommended to a newcomer
 *  - never the viewer, never someone already followed
 */
import { describe, it, expect } from "vitest";
import { rankPeopleToFollow } from "./discover-people";

const ME = "me".padEnd(64, "0");
const pk = (n: string) => n.padEnd(64, "f");

function base() {
  return {
    viewer: ME,
    followSet: new Set<string>([pk("friend1"), pk("friend2")]),
    networkCounts: new Map<string, number>(),
    trending: [] as string[],
    flagged: new Set<string>(),
  };
}

describe("rankPeopleToFollow", () => {
  it("puts friends-of-follows above trending, ordered by how many of your follows follow them", () => {
    const out = rankPeopleToFollow({
      ...base(),
      networkCounts: new Map([[pk("a"), 3], [pk("b"), 5]]),
      trending: [pk("t1"), pk("t2")],
    });
    expect(out.map((c) => c.pubkey)).toEqual([pk("b"), pk("a"), pk("t1"), pk("t2")]);
    expect(out[0].source).toBe("network");
    expect(out[2].source).toBe("trending");
  });

  it("requires at least two of your follows behind a network candidate", () => {
    // One follower-in-common is noise (everyone follows somebody); two is a
    // pattern. A count of 1 must not outrank the trending pool's curation.
    const out = rankPeopleToFollow({
      ...base(),
      networkCounts: new Map([[pk("weak"), 1], [pk("strong"), 2]]),
      trending: [pk("t1")],
    });
    expect(out.map((c) => c.pubkey)).toEqual([pk("strong"), pk("t1")]);
  });

  it("drops flagged accounts from BOTH pools — the floor runs before render", () => {
    const out = rankPeopleToFollow({
      ...base(),
      networkCounts: new Map([[pk("flaggednet"), 9]]),
      trending: [pk("flaggedtrend"), pk("clean")],
      flagged: new Set([pk("flaggednet"), pk("flaggedtrend")]),
    });
    expect(out.map((c) => c.pubkey)).toEqual([pk("clean")]);
  });

  it("never recommends the viewer or someone already followed", () => {
    const out = rankPeopleToFollow({
      ...base(),
      followSet: new Set([pk("friend1")]),
      networkCounts: new Map([[ME, 4], [pk("friend1"), 4], [pk("new"), 4]]),
      trending: [ME, pk("friend1")],
    });
    expect(out.map((c) => c.pubkey)).toEqual([pk("new")]);
  });

  it("falls back to trending alone for a sparse account", () => {
    const out = rankPeopleToFollow({ ...base(), trending: [pk("t1"), pk("t2")] });
    expect(out.map((c) => c.pubkey)).toEqual([pk("t1"), pk("t2")]);
    expect(out.every((c) => c.source === "trending")).toBe(true);
  });

  it("dedupes a candidate that appears in both pools, keeping the stronger claim", () => {
    const out = rankPeopleToFollow({
      ...base(),
      networkCounts: new Map([[pk("both"), 3]]),
      trending: [pk("both"), pk("t2")],
    });
    expect(out.map((c) => c.pubkey)).toEqual([pk("both"), pk("t2")]);
    expect(out[0].source).toBe("network");
  });

  it("respects the limit", () => {
    const out = rankPeopleToFollow({
      ...base(),
      trending: Array.from({ length: 20 }, (_, i) => pk(`t${i}`)),
      limit: 6,
    });
    expect(out).toHaveLength(6);
  });

  it("carries the followed-by count so the card can say WHY", () => {
    const out = rankPeopleToFollow({ ...base(), networkCounts: new Map([[pk("a"), 4]]) });
    expect(out[0].followedByCount).toBe(4);
  });
});
