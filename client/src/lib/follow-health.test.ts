import { describe, it, expect } from "vitest";
import { computeFollowHealth, countNeedingReview } from "./follow-health";

const DAY = 86_400;
const NOW = 1_700_000_000;
const pk = (n: number) => n.toString(16).padStart(64, "0");

function base(overrides: Partial<Parameters<typeof computeFollowHealth>[0]> = {}) {
  return computeFollowHealth({
    follows: [pk(1), pk(2), pk(3), pk(4)],
    self: pk(99),
    flagReporterCounts: new Map(),
    lastPostAt: new Map(),
    reviewed: new Set(),
    now: NOW,
    ...overrides,
  });
}

describe("computeFollowHealth — flagged", () => {
  it("lists follows at/above the threshold, sorted by reporters desc", () => {
    const r = base({
      flagReporterCounts: new Map([[pk(1), 2], [pk(2), 5], [pk(3), 1]]),
    });
    expect(r.flagged.map((f) => f.pubkey)).toEqual([pk(2), pk(1)]);
    expect(r.flagged[0].reporters).toBe(5);
  });

  it("respects a custom threshold", () => {
    const r = base({
      flagReporterCounts: new Map([[pk(1), 2], [pk(2), 3]]),
      flagThreshold: 3,
    });
    expect(r.flagged.map((f) => f.pubkey)).toEqual([pk(2)]);
  });

  it("excludes reviewed pubkeys", () => {
    const r = base({
      flagReporterCounts: new Map([[pk(1), 4], [pk(2), 4]]),
      reviewed: new Set([pk(1)]),
    });
    expect(r.flagged.map((f) => f.pubkey)).toEqual([pk(2)]);
  });

  it("never lists self even if flagged", () => {
    const r = base({
      follows: [pk(99), pk(1)],
      flagReporterCounts: new Map([[pk(99), 9], [pk(1), 3]]),
    });
    expect(r.flagged.map((f) => f.pubkey)).toEqual([pk(1)]);
  });
});

describe("computeFollowHealth — gone quiet", () => {
  it("lists follows whose last post is older than the cutoff, oldest first", () => {
    const r = base({
      lastPostAt: new Map([
        [pk(1), NOW - 100 * DAY],
        [pk(2), NOW - 200 * DAY],
        [pk(3), NOW - 10 * DAY], // recent → not stagnant
      ]),
    });
    expect(r.stagnant.map((s) => s.pubkey)).toEqual([pk(2), pk(1)]);
    expect(r.stagnant[0].daysSince).toBe(200);
  });

  it("treats unknown last-post as not stagnant", () => {
    const r = base({ lastPostAt: new Map() });
    expect(r.stagnant).toHaveLength(0);
  });

  it("a flagged follow is not also listed as gone quiet", () => {
    const r = base({
      flagReporterCounts: new Map([[pk(1), 3]]),
      lastPostAt: new Map([[pk(1), NOW - 300 * DAY]]),
    });
    expect(r.flagged.map((f) => f.pubkey)).toEqual([pk(1)]);
    expect(r.stagnant).toHaveLength(0);
  });

  it("honours a custom stagnantDays window", () => {
    const r = base({
      lastPostAt: new Map([[pk(1), NOW - 40 * DAY]]),
      stagnantDays: 30,
    });
    expect(r.stagnant.map((s) => s.pubkey)).toEqual([pk(1)]);
  });
});

describe("computeFollowHealth — dedup & counts", () => {
  it("collapses duplicate follows", () => {
    const r = base({
      follows: [pk(1), pk(1), pk(1)],
      flagReporterCounts: new Map([[pk(1), 4]]),
    });
    expect(r.flagged).toHaveLength(1);
  });

  it("countNeedingReview sums both lists", () => {
    const r = base({
      flagReporterCounts: new Map([[pk(1), 3]]),
      lastPostAt: new Map([[pk(2), NOW - 120 * DAY]]),
    });
    expect(countNeedingReview(r)).toBe(2);
  });
});
