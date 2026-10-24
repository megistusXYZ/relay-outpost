/**
 * Discover leads with your own network (owner, 2026-10-23): once you follow
 * 10 or more people, the people your follows follow come first on Discover's
 * Feed, ranked by how many of your follows follow them (at least two), and
 * the default lens's trusted list fills the rest. Below 10 follows, and under
 * your own lens, nothing changes. Computed on your device
 * (use-follows-of-follows); the server never learns your follows.
 */
import { describe, it, expect } from "vitest";
import { loadDiscoverTrust, discoverLensKey, FOF_MIN_FOLLOWS, DISCOVER_MIN_SCORE } from "./discover-trust";

const pk = (c: string) => c.repeat(64);
const follows = new Set(Array.from({ length: 10 }, (_, i) => pk(String(i))));
const LENS_TOP = [pk("x"), pk("y")];
const deps = { fetchTop: async () => LENS_TOP, fetchScores: async () => new Map<string, number>() };
const fof = new Map([[pk("a"), 2], [pk("b"), 5], [pk("c"), 1], [pk("0"), 9]]); // c: one follow only; "0" is followed already

describe("the friends-of-friends blend", () => {
  it("10 follows: Discover leads with your follows' follows, most shared first, then the lens", async () => {
    expect(FOF_MIN_FOLLOWS).toBe(10);
    const t = await loadDiscoverTrust([], { follows, wotEnabled: false, ownScores: null, fof }, deps);
    expect(t.top).toEqual([pk("b"), pk("a"), ...LENS_TOP]);
  });

  it("they pass the trust gate, trusted like the people you follow", async () => {
    const t = await loadDiscoverTrust([], { follows, wotEnabled: false, ownScores: null, fof }, deps);
    expect(t.scores.get(pk("b"))).toBe(1);
    expect(t.scores.get(pk("b"))!).toBeGreaterThan(DISCOVER_MIN_SCORE);
    expect(t.scores.has(pk("c"))).toBe(false); // followed by one of yours only: not enough
  });

  it("fewer than 10 follows: the lens alone, as before", async () => {
    const few = new Set([...follows].slice(0, 9));
    const t = await loadDiscoverTrust([], { follows: few, wotEnabled: false, ownScores: null, fof }, deps);
    expect(t.top).toEqual(LENS_TOP);
  });

  it("your own lens (100+ scored) is unchanged", async () => {
    const own = new Map(Array.from({ length: 100 }, (_, i) => [pk(i.toString(16).padStart(2, "0").slice(-1)) + i, 0.9] as [string, number]));
    const t = await loadDiscoverTrust([], { follows, wotEnabled: true, ownScores: own, fof }, deps);
    expect(t.lens).toBe("own");
    expect(t.top).not.toContain(pk("b"));
  });

  it("blended answers are remembered apart from lens-only ones", () => {
    expect(discoverLensKey({ follows, wotEnabled: false, ownScores: null, fof })).not.toBe(discoverLensKey({ follows, wotEnabled: false, ownScores: null }));
    expect(discoverLensKey({ follows: new Set(), wotEnabled: false, ownScores: null, fof })).toBe(discoverLensKey({ follows: new Set(), wotEnabled: false, ownScores: null }));
  });
});
