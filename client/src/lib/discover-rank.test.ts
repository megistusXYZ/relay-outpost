import { describe, it, expect } from "vitest";
import { rankDiscoverFeed, scoreDiscoverEvent, rankByTrustAndFreshness } from "./discover-rank";

const NOW = 1_700_000_000;
const ev = (id: string, pubkey: string, ageHours = 1) => ({
  id,
  pubkey,
  created_at: NOW - ageHours * 3600,
});

describe("scoreDiscoverEvent", () => {
  it("ranks higher engagement above lower, all else equal", () => {
    const opts = { now: NOW, getEngagement: (id: string) => (id === "hi" ? 100 : 1) };
    expect(scoreDiscoverEvent(ev("hi", "a"), opts)).toBeGreaterThan(scoreDiscoverEvent(ev("lo", "b"), opts));
  });
  it("decays with age", () => {
    const opts = { now: NOW, getEngagement: () => 10 };
    expect(scoreDiscoverEvent(ev("fresh", "a", 1), opts)).toBeGreaterThan(scoreDiscoverEvent(ev("old", "a", 48), opts));
  });
  it("boosts network proximity", () => {
    const base = { now: NOW, getEngagement: () => 5 };
    const withProx = { ...base, getProximity: (pk: string) => (pk === "friend" ? 1 : 0) };
    expect(scoreDiscoverEvent(ev("x", "friend"), withProx)).toBeGreaterThan(scoreDiscoverEvent(ev("x", "stranger"), withProx));
  });
});

describe("rankDiscoverFeed", () => {
  it("orders by score when authors are all distinct", () => {
    const events = [ev("low", "a"), ev("high", "b"), ev("mid", "c")];
    const out = rankDiscoverFeed(events, {
      now: NOW,
      getEngagement: (id) => ({ high: 100, mid: 10, low: 1 } as Record<string, number>)[id] ?? 0,
    });
    expect(out.map((e) => e.id)).toEqual(["high", "mid", "low"]);
  });

  it("never places the same author within the diversity window (when feasible)", () => {
    // "loud" holds the 3 top scores; with enough other authors, diversity should
    // interleave them so no two "loud" posts land within a window of 3 slots.
    const events = [
      ev("l1", "loud"), ev("l2", "loud"), ev("l3", "loud"),
      ev("o1", "w"), ev("o2", "x"), ev("o3", "y"), ev("o4", "z"),
    ];
    const eng: Record<string, number> = { l1: 100, l2: 99, l3: 98, o1: 5, o2: 4, o3: 3, o4: 2 };
    const out = rankDiscoverFeed(events, { now: NOW, getEngagement: (id) => eng[id] ?? 0, diversityWindow: 3 });
    const authors = out.map((e) => e.pubkey);
    for (let i = 0; i < authors.length; i++) {
      if (authors[i] === "loud") {
        expect(authors.slice(i + 1, i + 3)).not.toContain("loud");
      }
    }
    // "loud" still leads (highest scores) but is spaced out.
    expect(authors[0]).toBe("loud");
    expect(out).toHaveLength(7);
  });

  it("falls back gracefully when diversity is impossible (more dominant posts than fillers)", () => {
    const events = [ev("l1", "loud"), ev("l2", "loud"), ev("l3", "loud"), ev("o1", "x")];
    const eng: Record<string, number> = { l1: 100, l2: 99, l3: 98, o1: 5 };
    const out = rankDiscoverFeed(events, { now: NOW, getEngagement: (id) => eng[id] ?? 0, diversityWindow: 3 });
    // Nothing is dropped even though perfect spacing is impossible.
    expect(out).toHaveLength(4);
    expect(out.map((e) => e.pubkey).filter((p) => p === "loud")).toHaveLength(3);
  });

  it("maxPerAuthor hard-caps a bursting author — overflow DROPPED, not deferred", () => {
    const events = [
      ev("b1", "burster"), ev("b2", "burster"), ev("b3", "burster"),
      ev("b4", "burster"), ev("b5", "burster"), ev("b6", "burster"),
      ev("o1", "w"), ev("o2", "x"),
    ];
    const eng: Record<string, number> = { b1: 60, b2: 50, b3: 40, b4: 30, b5: 20, b6: 10, o1: 5, o2: 4 };
    const out = rankDiscoverFeed(events, { now: NOW, getEngagement: (id) => eng[id] ?? 0, maxPerAuthor: 3 });
    const bursts = out.filter((e) => e.pubkey === "burster");
    expect(bursts).toHaveLength(3);
    // Keeps the author's HIGHEST-scored posts.
    expect(bursts.map((e) => e.id).sort()).toEqual(["b1", "b2", "b3"]);
    expect(out).toHaveLength(5);
  });

  it("capExempt (followed) authors are never burst-capped", () => {
    const events = [
      ev("f1", "friend"), ev("f2", "friend"), ev("f3", "friend"),
      ev("f4", "friend"), ev("f5", "friend"),
      ev("s1", "stranger"), ev("s2", "stranger"), ev("s3", "stranger"), ev("s4", "stranger"),
    ];
    const out = rankDiscoverFeed(events, {
      now: NOW,
      getEngagement: () => 1,
      maxPerAuthor: 3,
      capExempt: (pk) => pk === "friend",
    });
    expect(out.filter((e) => e.pubkey === "friend")).toHaveLength(5);
    expect(out.filter((e) => e.pubkey === "stranger")).toHaveLength(3);
  });

  it("no maxPerAuthor (default) → nothing is dropped (Latest/Following contract)", () => {
    const events = [ev("a1", "loud"), ev("a2", "loud"), ev("a3", "loud"), ev("a4", "loud"), ev("a5", "loud")];
    const out = rankDiscoverFeed(events, { now: NOW, getEngagement: () => 0 });
    expect(out).toHaveLength(5);
  });

  it("is stable/deterministic and drops nothing", () => {
    const events = [ev("a", "1"), ev("b", "1"), ev("c", "2")];
    const opts = { now: NOW, getEngagement: () => 0 };
    const a = rankDiscoverFeed(events, opts);
    const b = rankDiscoverFeed(events, opts);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a).toHaveLength(3);
  });
});

/**
 * The Discover Feed tile ranks by trust plus freshness (owner, 2026-09-30),
 * not by Primal's like counts: the counts cost a 2 s wait on a first visit
 * (measured), and the front door is meant to show the most respected people.
 * Trust is the author's score on the default lens (0.50 is the bar, 1.0 the
 * top); your follows count as 1.0.
 */
describe("rankByTrustAndFreshness", () => {
  const now = 1_790_000_000;
  const post = (id: string, pubkey: string, hoursAgo: number) => ({ id, pubkey, created_at: now - hoursAgo * 3600 });
  const trustOf = (scores: Record<string, number>) => (pk: string) => scores[pk] ?? 0.5;

  it("posted at the same time, the more trusted person comes first", () => {
    const out = rankByTrustAndFreshness([post("a", "low", 1), post("b", "high", 1)], { now, trustOf: trustOf({ low: 0.55, high: 0.95 }) });
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("trust is worth about two hours of freshness at most: a fresh post beats a six-hour-old one from someone more trusted", () => {
    const out = rankByTrustAndFreshness([post("old", "high", 6), post("fresh", "low", 1)], { now, trustOf: trustOf({ low: 0.55, high: 0.95 }) });
    expect(out.map((e) => e.id)).toEqual(["fresh", "old"]);
  });

  it("and a half-hour-old post by the most trusted beats one just posted by someone at the bar", () => {
    const out = rankByTrustAndFreshness([post("now", "bar", 0), post("halfhour", "top", 0.5)], { now, trustOf: trustOf({ bar: 0.5, top: 1 }) });
    expect(out.map((e) => e.id)).toEqual(["halfhour", "now"]);
  });

  it("the order doesn't depend on the order the posts arrived in", () => {
    const events = [post("a", "x", 2), post("b", "y", 3), post("c", "z", 1)];
    const first = rankByTrustAndFreshness(events, { now, trustOf: trustOf({ x: 0.7, y: 0.9, z: 0.6 }) });
    const again = rankByTrustAndFreshness([...events].reverse(), { now, trustOf: trustOf({ x: 0.7, y: 0.9, z: 0.6 }) });
    expect(again.map((e) => e.id)).toEqual(first.map((e) => e.id));
  });

  // Owner, 2026-09-30: "using Primal is fine but depending on it and only
  // using it is bad; it should be in support, not the main." Primal's like
  // and reply counts, when already in hand, nudge the order: at most 25%,
  // where trust counts for up to 50%.
  describe("Primal's counts, when in hand, only nudge", () => {
    const likes = (counts: Record<string, number>) => (id: string) => counts[id] ?? 0;

    it("between two posts alike in trust and age, the one people engaged with comes first", () => {
      const out = rankByTrustAndFreshness([post("quiet", "x", 1), post("liked", "y", 1)], { now, trustOf: trustOf({ x: 0.7, y: 0.7 }), engagementOf: likes({ liked: 500 }) });
      expect(out.map((e) => e.id)).toEqual(["liked", "quiet"]);
    });

    it("thousands of likes don't outrank a more trusted person", () => {
      const out = rankByTrustAndFreshness([post("viral", "low", 1), post("trusted", "high", 1)], { now, trustOf: trustOf({ low: 0.55, high: 0.95 }), engagementOf: likes({ viral: 5000 }) });
      expect(out.map((e) => e.id)).toEqual(["trusted", "viral"]);
    });

    it("nor a clearly fresher post", () => {
      const out = rankByTrustAndFreshness([post("viral", "x", 4), post("fresh", "y", 1)], { now, trustOf: trustOf({ x: 0.7, y: 0.7 }), engagementOf: likes({ viral: 5000 }) });
      expect(out.map((e) => e.id)).toEqual(["fresh", "viral"]);
    });

    it("with no counts in hand, the order is trust and freshness alone", () => {
      const events = [post("a", "x", 2), post("b", "y", 3), post("c", "z", 1)];
      const without = rankByTrustAndFreshness(events, { now, trustOf: trustOf({ x: 0.7, y: 0.9, z: 0.6 }) });
      const empty = rankByTrustAndFreshness(events, { now, trustOf: trustOf({ x: 0.7, y: 0.9, z: 0.6 }), engagementOf: () => 0 });
      expect(empty.map((e) => e.id)).toEqual(without.map((e) => e.id));
    });
  });
});
