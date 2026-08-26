/**
 * Yield-aware page sizing for filtered feeds (owner report, 2026-08-14):
 * with the trust filter hiding ~29 of 30, the refill chain worked but the
 * runway grew ~1-2 visible posts per relay round-trip — the loader was always
 * a couple of posts away. The page size must grow when the filter eats the
 * page, and settle back when it stops.
 */
import { describe, it, expect } from "vitest";
import { nextPageLimit, BASE_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./adaptive-page";

describe("nextPageLimit", () => {
  it("keeps the base size while yield is healthy", () => {
    expect(nextPageLimit({ prevLimit: BASE_PAGE_LIMIT, rawCount: 30, visibleAdded: 24 })).toBe(BASE_PAGE_LIMIT);
  });

  it("grows when the filter eats most of the page", () => {
    const next = nextPageLimit({ prevLimit: BASE_PAGE_LIMIT, rawCount: 30, visibleAdded: 1 });
    expect(next).toBeGreaterThan(BASE_PAGE_LIMIT);
  });

  it("keeps growing across starved rounds, but never past the cap", () => {
    let limit = BASE_PAGE_LIMIT;
    for (let i = 0; i < 10; i++) {
      limit = nextPageLimit({ prevLimit: limit, rawCount: limit, visibleAdded: 0 });
    }
    expect(limit).toBe(MAX_PAGE_LIMIT);
  });

  it("settles back toward base when the feed recovers", () => {
    const grown = nextPageLimit({ prevLimit: BASE_PAGE_LIMIT, rawCount: 30, visibleAdded: 0 });
    const recovered = nextPageLimit({ prevLimit: grown, rawCount: grown, visibleAdded: grown * 0.8 });
    expect(recovered).toBeLessThan(grown);
    expect(recovered).toBeGreaterThanOrEqual(BASE_PAGE_LIMIT);
  });

  it("never returns below base, whatever the inputs", () => {
    expect(nextPageLimit({ prevLimit: BASE_PAGE_LIMIT, rawCount: 0, visibleAdded: 0 })).toBeGreaterThanOrEqual(BASE_PAGE_LIMIT);
    expect(nextPageLimit({ prevLimit: MAX_PAGE_LIMIT, rawCount: MAX_PAGE_LIMIT, visibleAdded: MAX_PAGE_LIMIT })).toBeGreaterThanOrEqual(BASE_PAGE_LIMIT);
  });
});
