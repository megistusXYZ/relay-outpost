/**
 * Articles › Trending ranks by engagement numbers from Primal. It used to
 * keep ONLY articles with numbers, so while they were on their way, or when
 * Primal was down, Trending said "No articles" over a page of fetched
 * articles (reported 2026-09-29). Now: ranked where the numbers are known,
 * newest first where they aren't yet, and it says so.
 */
import { describe, it, expect } from "vitest";
import { trendingArticles, type EngagementStats } from "./trending-articles";

const NOW = 1_790_000_000;
const HOUR = 3600;
const art = (id: string, hoursAgo: number, pubkey = id) =>
  ({ event: { id, pubkey }, publishedAt: NOW - hoursAgo * HOUR, image: undefined, summary: undefined }) as any;
const stats = (likes: number): EngagementStats => ({ zapAmount: 0, replies: 0, likes, reposts: 0 });

describe("trendingArticles", () => {
  const a = art("a", 1), b = art("b", 5), c = art("c", 10);

  it("no numbers yet (or Primal down): every article, newest first, flagged unranked", () => {
    const r = trendingArticles([c, a, b], () => undefined, NOW);
    expect(r.articles.map((x) => x.event.id)).toEqual(["a", "b", "c"]);
    expect(r.ranked).toBe(false);
  });

  it("with numbers: the busiest per hour first", () => {
    // b: 50 likes over 5h beats a: 2 likes over 1h and c: 30 likes over 10h.
    const got = { a: stats(2), b: stats(50), c: stats(30) } as Record<string, EngagementStats>;
    const r = trendingArticles([a, b, c], (id) => got[id], NOW);
    expect(r.articles.map((x) => x.event.id)).toEqual(["b", "c", "a"]);
    expect(r.ranked).toBe(true);
  });

  it("an article whose numbers came back as zero isn't trending", () => {
    const got = { a: stats(0), b: stats(3) } as Record<string, EngagementStats>;
    const r = trendingArticles([a, b], (id) => got[id], NOW);
    expect(r.articles.map((x) => x.event.id)).toEqual(["b"]);
  });

  it("numbers for some: those ranked first, the rest after them newest first, never dropped", () => {
    const got = { c: stats(30) } as Record<string, EngagementStats>;
    const r = trendingArticles([a, b, c], (id) => got[id], NOW);
    expect(r.articles.map((x) => x.event.id)).toEqual(["c", "a", "b"]);
    expect(r.ranked).toBe(true);
  });

  it("one author doesn't fill the top: at most one of theirs in any five", () => {
    const same = [art("s1", 1, "jo"), art("s2", 2, "jo"), art("x", 3), art("y", 4)];
    const got = { s1: stats(40), s2: stats(39), x: stats(5), y: stats(4) } as Record<string, EngagementStats>;
    const r = trendingArticles(same, (id) => got[id], NOW);
    expect(r.articles.map((x) => x.event.id)).toEqual(["s1", "x", "y"]);
  });
});
