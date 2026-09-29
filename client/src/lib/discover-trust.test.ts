/**
 * Discover shows only highly trusted people (owner call, 2026-09-29): rank
 * 50+ (score 0.50+), through the viewer's own trust when they have enough of
 * it, else the default lens; plus people the viewer follows. Discover is the
 * front door, so this is strict on purpose: no score means not shown here.
 */
import { describe, it, expect, vi } from "vitest";
import { admitToDiscover, gateByTrust, chooseDiscoverLens, loadDiscoverTrust } from "./discover-trust";

const pk = (c: string) => c.repeat(64);

describe("admitToDiscover (the tile author gate)", () => {
  const ctx = { follows: new Set([pk("f")]), scores: new Map([[pk("a"), 0.97], [pk("b"), 0.5], [pk("c"), 0.49], [pk("d"), -1]]) };

  it("shows people the lens trusts at 0.50 and up", () => {
    expect(admitToDiscover(pk("a"), ctx)).toBe(true);
    expect(admitToDiscover(pk("b"), ctx)).toBe(true);
  });

  it("leaves out anyone below, unranked, or unscored", () => {
    expect(admitToDiscover(pk("c"), ctx)).toBe(false);
    expect(admitToDiscover(pk("d"), ctx)).toBe(false);
    expect(admitToDiscover(pk("e"), ctx)).toBe(false);
  });

  it("people you follow are always shown", () => {
    expect(admitToDiscover(pk("f"), ctx)).toBe(true);
  });

  it("filters a tile's items by their author", () => {
    const items = [{ id: 1, by: pk("a") }, { id: 2, by: pk("c") }, { id: 3, by: pk("f") }];
    expect(gateByTrust(items, (i) => i.by, ctx).map((i) => i.id)).toEqual([1, 3]);
  });
});

describe("chooseDiscoverLens", () => {
  const many = new Map(Array.from({ length: 120 }, (_, i) => [i.toString(16).padStart(64, "0"), 0.8] as const));
  const few = new Map(Array.from({ length: 30 }, (_, i) => [i.toString(16).padStart(64, "0"), 0.8] as const));

  it("uses your own trust once it covers at least 100 highly trusted people", () => {
    expect(chooseDiscoverLens({ wotEnabled: true, ownScores: many })).toBe("own");
  });

  it("uses the default lens while your own trust is thin, off, or signed out", () => {
    expect(chooseDiscoverLens({ wotEnabled: true, ownScores: few })).toBe("default");
    expect(chooseDiscoverLens({ wotEnabled: false, ownScores: many })).toBe("default");
    expect(chooseDiscoverLens({ wotEnabled: false, ownScores: null })).toBe("default");
  });
});

describe("loadDiscoverTrust", () => {
  it("when the trusted list can't be read, it says so and trusts no one", async () => {
    const r = await loadDiscoverTrust([pk("a")], { follows: new Set(), wotEnabled: false, ownScores: null }, {
      fetchTop: async () => null,
      fetchScores: vi.fn(async () => new Map([[pk("a"), 0.97]])),
    });
    expect(r.reached).toBe(false);
    expect(r.top).toEqual([]);
  });

  it("default lens: the server's top list, and the candidates' scores", async () => {
    const r = await loadDiscoverTrust([pk("a"), pk("c")], { follows: new Set(), wotEnabled: false, ownScores: null }, {
      fetchTop: async () => [pk("a"), pk("b")],
      fetchScores: async () => new Map([[pk("a"), 0.97], [pk("c"), 0.2]]),
    });
    expect(r).toMatchObject({ reached: true, top: [pk("a"), pk("b")] });
    expect(r.scores.get(pk("c"))).toBe(0.2);
  });

  it("own lens: your own highest-trusted people, without asking the server", async () => {
    const own = new Map(Array.from({ length: 120 }, (_, i) => [i.toString(16).padStart(64, "0"), i >= 100 ? 0.9 : 0.6] as const));
    const fetchTop = vi.fn();
    const r = await loadDiscoverTrust([], { follows: new Set(), wotEnabled: true, ownScores: own }, { fetchTop, fetchScores: vi.fn() });
    expect(r.reached).toBe(true);
    expect(r.top[0]).toBe((100).toString(16).padStart(64, "0"));
    expect(fetchTop).not.toHaveBeenCalled();
  });
});
