import { describe, it, expect } from "vitest";
import { buildDigestGroups, digestSummary } from "./news-digest";
import type { ScorableNewsItem, ScoredNewsItem, AlertTier } from "./news-scoring";

// Fixture helper — a scored item with sensible defaults.
const scored = (
  id: string,
  score: number,
  tier: AlertTier,
  extra: Partial<ScorableNewsItem> = {},
  scoredExtra: Partial<ScoredNewsItem> = {},
): ScoredNewsItem => ({
  item: {
    id,
    title: `Title ${id}`,
    description: "desc",
    sourceUrl: "https://src.com/feed",
    sourceName: "Source",
    sourceCategory: "News",
    ...extra,
  },
  score,
  tier,
  factors: [],
  creatorLed: false,
  muted: false,
  ...scoredExtra,
});

describe("buildDigestGroups", () => {
  it("returns nothing for an empty input", () => {
    expect(buildDigestGroups([])).toEqual([]);
  });

  it("only groups alerting tiers by default (feed/low are excluded)", () => {
    const groups = buildDigestGroups([
      scored("a", 95, "priority"),
      scored("b", 75, "alert"),
      scored("c", 50, "feed"),
      scored("d", 10, "low"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((s) => s.item.id)).toEqual(["a", "b"]);
  });

  it("groups creator-led items by source with episode wording", () => {
    const huberman = {
      sourceUrl: "https://huberman.com/feed",
      sourceName: "Huberman Lab",
      isPodcast: true,
    };
    const groups = buildDigestGroups([
      scored("e1", 90, "priority", huberman, { creatorLed: true }),
      scored("e2", 80, "alert", huberman, { creatorLed: true }),
      scored("e3", 85, "alert", huberman, { creatorLed: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: "creator",
      label: "Huberman Lab",
      countLabel: "3 new episodes",
      topScore: 90,
    });
    // Items sorted best-first.
    expect(groups[0].items.map((s) => s.item.id)).toEqual(["e1", "e3", "e2"]);
  });

  it("uses singular wording for a one-item creator group", () => {
    const g = buildDigestGroups([
      scored("solo", 90, "priority", { sourceName: "Huberman Lab", isPodcast: true }, { creatorLed: true }),
    ]);
    expect(g[0].countLabel).toBe("New episode");
  });

  it("groups non-creator items by category with update wording", () => {
    const groups = buildDigestGroups([
      scored("s1", 75, "alert", { sourceCategory: "Sports", sourceUrl: "https://a.com/f" }),
      scored("s2", 72, "alert", { sourceCategory: "Sports", sourceUrl: "https://b.com/f" }),
      scored("s3", 71, "alert", { sourceCategory: "sports", sourceUrl: "https://c.com/f" }),
    ]);
    expect(groups).toHaveLength(1); // category key is case-insensitive
    expect(groups[0]).toMatchObject({ kind: "category", label: "Sports", countLabel: "3 new updates" });
  });

  it("falls back to the News category when a source has none", () => {
    const g = buildDigestGroups([scored("x", 75, "alert", { sourceCategory: "" })]);
    expect(g[0].label).toBe("News");
  });

  it("orders groups by top item score, then size", () => {
    const groups = buildDigestGroups([
      scored("cat1", 75, "alert", { sourceCategory: "Sports" }),
      scored("cr1", 95, "priority", { sourceName: "Huberman Lab", sourceUrl: "https://h.com/f" }, { creatorLed: true }),
      scored("cat2", 75, "alert", { sourceCategory: "Tech" }),
      scored("cat3", 75, "alert", { sourceCategory: "Tech", sourceUrl: "https://t2.com/f" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Huberman Lab", "Tech", "Sports"]);
  });

  it("mixed podcast/article groups pick the majority unit", () => {
    const g = buildDigestGroups([
      scored("p1", 75, "alert", { sourceCategory: "Health", isPodcast: true, sourceUrl: "https://a.com" }),
      scored("p2", 74, "alert", { sourceCategory: "Health", isPodcast: true, sourceUrl: "https://b.com" }),
      scored("a1", 73, "alert", { sourceCategory: "Health", sourceUrl: "https://c.com" }),
    ]);
    expect(g[0].countLabel).toBe("3 new episodes");
  });

  it("honors an explicit tier filter", () => {
    const g = buildDigestGroups([scored("f", 50, "feed")], { tiers: ["feed"] });
    expect(g).toHaveLength(1);
  });
});

describe("digestSummary", () => {
  it("summarizes totals across groups with distinct sources", () => {
    const groups = buildDigestGroups([
      scored("a", 95, "priority", { sourceUrl: "https://one.com/f", sourceName: "One" }, { creatorLed: true }),
      scored("b", 80, "alert", { sourceUrl: "https://one.com/f", sourceName: "One" }, { creatorLed: true }),
      scored("c", 75, "alert", { sourceCategory: "Sports", sourceUrl: "https://two.com/f" }),
    ]);
    expect(digestSummary(groups)).toEqual({
      totalItems: 3,
      sourceCount: 2,
      headline: "3 new items from 2 sources",
    });
  });

  it("uses singular forms and a caught-up headline", () => {
    const one = buildDigestGroups([scored("a", 75, "alert", { sourceUrl: "https://one.com/f" })]);
    expect(digestSummary(one).headline).toBe("1 new item from 1 source");
    expect(digestSummary([]).headline).toBe("You're all caught up");
  });
});
