import { describe, it, expect } from "vitest";
import { planBulkResults, decideScoreRequest } from "./wot-hydration";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

const results = (entries: [string, number][]) => new Map(entries);
const resolved = (...pks: string[]) => new Set(pks);

// Regression (July 2026): global Meili misses (-1) were written into the shared
// score map as terminal values → every feed/thread author rendered a sticky
// "No data" verdict until a profile visit injected the per-observer score.
describe("planBulkResults — miss handling", () => {
  it("writes global hits as provisional values", () => {
    const plan = planBulkResults([A, B], results([[A, 0.4], [B, 0.02]]), resolved());
    expect(plan.writes.get(A)).toBe(0.4);
    expect(plan.writes.get(B)).toBe(0.02);
  });

  it("never writes a negative miss marker into the map", () => {
    const plan = planBulkResults([A, B], results([[A, -1], [B, 0.4]]), resolved());
    expect(plan.writes.has(A)).toBe(false);
    expect(plan.writes.size).toBe(1);
  });

  it("treats an absent result (chunk failure / cooldown) like a miss — no write", () => {
    const plan = planBulkResults([A], results([]), resolved());
    expect(plan.writes.size).toBe(0);
  });

  it("a zero score is a real value, not a miss", () => {
    const plan = planBulkResults([A], results([[A, 0]]), resolved());
    expect(plan.writes.get(A)).toBe(0);
  });
});

describe("planBulkResults — per-observer refinement queue", () => {
  it("queues every non-resolved author: misses AND provisional hits", () => {
    const plan = planBulkResults([A, B, C], results([[A, 0.4], [B, -1]]), resolved());
    expect(new Set(plan.refine)).toEqual(new Set([A, B, C]));
  });

  it("puts misses ahead of provisional hits (a miss has no dot at all)", () => {
    const plan = planBulkResults([A, B, C], results([[A, 0.4], [B, -1]]), resolved());
    expect(plan.refine.indexOf(B)).toBeLessThan(plan.refine.indexOf(A));
    expect(plan.refine.indexOf(C)).toBeLessThan(plan.refine.indexOf(A));
  });

  it("caps the queue by room, preferring misses over hit refinements", () => {
    const plan = planBulkResults([A, B, C, D], results([[A, 0.4], [B, 0.5], [C, -1]]), resolved(), 2);
    expect(plan.refine).toHaveLength(2);
    // C and D are misses — they win the limited room over A/B refinements.
    expect(new Set(plan.refine)).toEqual(new Set([C, D]));
  });

  it("room of zero (or negative) queues nothing but still writes hits", () => {
    const plan = planBulkResults([A, B], results([[A, 0.4]]), resolved(), 0);
    expect(plan.refine).toHaveLength(0);
    expect(plan.writes.get(A)).toBe(0.4);
    const planNeg = planBulkResults([A], results([]), resolved(), -3);
    expect(planNeg.refine).toHaveLength(0);
  });
});

describe("planBulkResults — per-observer precedence", () => {
  it("skips already-resolved pubkeys entirely: no write, no re-queue", () => {
    // A late global batch response must never clobber a per-observer score
    // that landed while the batch was in flight.
    const plan = planBulkResults([A, B], results([[A, 0.03], [B, 0.4]]), resolved(A));
    expect(plan.writes.has(A)).toBe(false);
    expect(plan.refine).not.toContain(A);
    expect(plan.writes.get(B)).toBe(0.4);
    expect(plan.refine).toContain(B);
  });

  it("de-duplicates repeated request entries", () => {
    const plan = planBulkResults([A, A, B, B], results([[A, 0.4]]), resolved());
    expect(plan.refine).toHaveLength(2);
    expect(plan.writes.size).toBe(1);
  });
});

const NOW = 1_000_000_000;
const COOLDOWN = 10 * 60 * 1000;

const decide = (over: Partial<Parameters<typeof decideScoreRequest>[0]>) =>
  decideScoreRequest({
    existing: undefined,
    resolved: false,
    missAt: undefined,
    now: NOW,
    cooldownMs: COOLDOWN,
    ...over,
  });

describe("decideScoreRequest", () => {
  it("enqueues an unknown pubkey even when the shared map is null/empty", () => {
    // Regression: requestScore early-returned on a null map, leaving
    // single-badge hydration inert until something else created the store.
    expect(decide({})).toBe("enqueue");
  });

  it("skips when a non-negative score is already present (provisional or authoritative)", () => {
    expect(decide({ existing: 0.4 })).toBe("skip");
    expect(decide({ existing: 0 })).toBe("skip");
  });

  it("skips a resolved pubkey that has a score", () => {
    expect(decide({ existing: 0.4, resolved: true })).toBe("skip");
    expect(decide({ resolved: true })).toBe("skip");
  });

  it("skips a terminal miss during its cooldown", () => {
    expect(decide({ resolved: true, missAt: NOW - COOLDOWN + 1 })).toBe("skip");
  });

  it("retries a terminal miss after the cooldown — misses are never permanent", () => {
    expect(decide({ resolved: true, missAt: NOW - COOLDOWN })).toBe("retry");
    expect(decide({ resolved: true, missAt: NOW - COOLDOWN - 1 })).toBe("retry");
  });

  it("treats a legacy negative marker in the map as a retryable miss", () => {
    expect(decide({ existing: -1 })).toBe("retry");
    expect(decide({ existing: -1, missAt: NOW - 1 })).toBe("skip");
    expect(decide({ existing: -1, missAt: NOW - COOLDOWN })).toBe("retry");
  });
});
