import { describe, it, expect } from "vitest";
import {
  ALERT_WEIGHTS,
  ALERT_MIN,
  CORROBORATION_MAX,
  FEED_MIN,
  PRIORITY_MIN,
  hasBreakingKeyword,
  looksLikePersonName,
  prepareScoringContext,
  presetShowTitleKeys,
  sanitizeMuteList,
  scoreNewsItem,
  scoreNewsItems,
  tierForScore,
  type NewsScoringContext,
  type ScorableNewsItem,
} from "./news-scoring";

// Fixture helper — a healthy article from a saved (but otherwise plain) source.
const item = (extra: Partial<ScorableNewsItem> = {}): ScorableNewsItem => ({
  id: "id-1",
  title: "A perfectly normal headline",
  description: "Some description text long enough to not be thin.",
  sourceUrl: "https://example.com/feed",
  sourceName: "Example Feed",
  sourceCategory: "Tech",
  author: "Example Feed Newsroom Desk", // 4 words — never mistaken for a person
  ...extra,
});

const score = (it: ScorableNewsItem, ctx: NewsScoringContext = {}) =>
  scoreNewsItem(it, prepareScoringContext(ctx));

describe("tierForScore boundaries", () => {
  it("maps the documented boundaries exactly", () => {
    expect(tierForScore(PRIORITY_MIN)).toBe("priority"); // 90
    expect(tierForScore(PRIORITY_MIN - 1)).toBe("alert"); // 89
    expect(tierForScore(ALERT_MIN)).toBe("alert"); // 70
    expect(tierForScore(ALERT_MIN - 1)).toBe("feed"); // 69
    expect(tierForScore(FEED_MIN)).toBe("feed"); // 40
    expect(tierForScore(FEED_MIN - 1)).toBe("low"); // 39
    expect(tierForScore(0)).toBe("low");
    expect(tierForScore(125)).toBe("priority");
  });
});

describe("individual factors", () => {
  it("scores 0 for a plain item with an empty context", () => {
    const s = score(item());
    expect(s.score).toBe(0);
    expect(s.tier).toBe("low");
    expect(s.factors).toEqual([]);
  });

  it("+30 when the source category is one of the user's preset/saved categories", () => {
    const s = score(item(), { savedCategoryKeys: ["tech", "sports"] });
    expect(s.score).toBe(ALERT_WEIGHTS.presetCategory);
    expect(s.factors).toContain("presetCategory");
    // Case-insensitive on both sides.
    expect(score(item({ sourceCategory: "TECH" }), { savedCategoryKeys: ["Tech"] }).score).toBe(30);
  });

  it("+25 (+15 creator-led) when the source is a followed individual creator", () => {
    const s = score(item(), { followedCreatorUrls: ["https://example.com/feed"] });
    // A followed creator IS creator-led, so both factors fire.
    expect(s.factors).toEqual(expect.arrayContaining(["followedCreator", "creatorLed"]));
    expect(s.score).toBe(ALERT_WEIGHTS.followedCreator + ALERT_WEIGHTS.creatorLed);
  });

  it("+20 when the source is currently trending — and degrades to 0 when unconfigured", () => {
    const trending = { trendingSourceKeys: ["example feed"] };
    expect(score(item(), trending).score).toBe(ALERT_WEIGHTS.trendingSource);
    // No trending data at all (Podcast Index unconfigured) — factor contributes nothing.
    expect(score(item(), {}).score).toBe(0);
  });

  it("+25 for breaking/urgent title keywords (word-boundary, case-insensitive)", () => {
    expect(score(item({ title: "BREAKING: markets move" })).score).toBe(ALERT_WEIGHTS.breakingTitle);
    expect(score(item({ title: "Just in — a thing happened" })).score).toBe(25);
    expect(score(item({ title: "Red alert issued" })).score).toBe(25);
    expect(score(item({ title: "Urgent care tips" })).score).toBe(25);
    // Word-boundary: no substring matches.
    expect(score(item({ title: "Breakingpoint reviews" })).score).toBe(0);
    expect(score(item({ title: "Unalerted and calm" })).score).toBe(0);
  });

  it("+15 when the source is a PRESET_SHOWS creator show", () => {
    const s = score(item({ sourceName: "Huberman Lab", author: "" }));
    expect(s.creatorLed).toBe(true);
    expect(s.score).toBe(ALERT_WEIGHTS.creatorLed);
  });

  it("+15 when the author looks like a person name", () => {
    const s = score(item({ author: "Marc Maron" }));
    expect(s.creatorLed).toBe(true);
    expect(s.score).toBe(ALERT_WEIGHTS.creatorLed);
  });

  it("+10 for prior engagement with the source", () => {
    const s = score(item(), { engagedSourceUrls: ["https://example.com/feed"] });
    expect(s.score).toBe(ALERT_WEIGHTS.priorEngagement);
    expect(s.factors).toContain("priorEngagement");
  });

  it("+5 per corroborating outlet beyond the first, capped at +25", () => {
    // 1 outlet (or absent) = no factor.
    expect(score(item()).score).toBe(0);
    expect(score(item({ outletCount: 1 })).score).toBe(0);
    // 2 outlets → +5; 3 → +10.
    const two = score(item({ outletCount: 2 }));
    expect(two.score).toBe(ALERT_WEIGHTS.corroborationPerOutlet);
    expect(two.factors).toContain("corroboration");
    expect(score(item({ outletCount: 3 })).score).toBe(10);
    // 6 outlets hits the cap; more never exceeds it.
    expect(score(item({ outletCount: 6 })).score).toBe(CORROBORATION_MAX);
    expect(score(item({ outletCount: 40 })).score).toBe(CORROBORATION_MAX);
  });

  it("corroboration composes with other factors but cannot alert on its own", () => {
    // Cap alone stays low: 25 < FEED_MIN.
    expect(score(item({ outletCount: 12 })).tier).toBe("low");
    // Preset category + engaged + capped corroboration = 30+10+25 = 65 → feed…
    const near = score(item({ outletCount: 6 }), {
      savedCategoryKeys: ["tech"],
      engagedSourceUrls: ["https://example.com/feed"],
    });
    expect(near.score).toBe(65);
    expect(near.tier).toBe("feed");
    // …and a breaking keyword on top clears the alert line (90 → priority).
    const alerted = score(item({ outletCount: 6, title: "Breaking: markets move" }), {
      savedCategoryKeys: ["tech"],
      engagedSourceUrls: ["https://example.com/feed"],
    });
    expect(alerted.score).toBe(90);
    expect(alerted.tier).toBe("priority");
  });

  it("corroboration never rescues a muted story", () => {
    const s = score(item({ outletCount: 8 }), {
      savedCategoryKeys: ["tech"],
      mutedSourceUrls: ["https://example.com/feed"],
    });
    expect(s.muted).toBe(true);
    expect(s.tier).toBe("low");
  });

  it("-30 for thin content (missing title or description)", () => {
    expect(score(item({ title: "" })).score).toBe(ALERT_WEIGHTS.lowQuality);
    expect(score(item({ description: "  " })).score).toBe(-30);
    const s = score(item({ title: "", description: "" }));
    expect(s.score).toBe(-30); // applied once, not per-field
    expect(s.factors).toContain("thinContent");
  });
});

describe("tier assembly", () => {
  const richCtx: NewsScoringContext = {
    savedCategoryKeys: ["tech"],
    followedCreatorUrls: ["https://example.com/feed"],
    trendingSourceKeys: ["example feed"],
    engagedSourceUrls: ["https://example.com/feed"],
  };

  it("a followed, trending, engaged preset source reaches priority (≥90)", () => {
    // 30 + 25 + 20 + 15 (creatorLed via follow) + 10 = 100
    const s = score(item(), richCtx);
    expect(s.score).toBe(100);
    expect(s.tier).toBe("priority");
  });

  it("lands exactly on the 90 boundary → priority", () => {
    // 30 preset + 25 follow + 15 creatorLed + 20 trending = 90
    const s = score(item(), { ...richCtx, engagedSourceUrls: [] });
    expect(s.score).toBe(90);
    expect(s.tier).toBe("priority");
  });

  it("70–89 → alert", () => {
    // 30 preset + 25 follow + 15 creatorLed = 70
    const s = score(item(), { savedCategoryKeys: ["tech"], followedCreatorUrls: ["https://example.com/feed"] });
    expect(s.score).toBe(70);
    expect(s.tier).toBe("alert");
  });

  it("40–69 → feed (quiet, no alert)", () => {
    // 30 preset + 10 engagement = 40
    const s = score(item(), { savedCategoryKeys: ["tech"], engagedSourceUrls: ["https://example.com/feed"] });
    expect(s.score).toBe(40);
    expect(s.tier).toBe("feed");
    // 30 + 25 breaking + 10 = 65 stays feed
    const s2 = score(item({ title: "Breaking story" }), {
      savedCategoryKeys: ["tech"],
      engagedSourceUrls: ["https://example.com/feed"],
    });
    expect(s2.score).toBe(65);
    expect(s2.tier).toBe("feed");
  });

  it("<40 → low", () => {
    const s = score(item(), { savedCategoryKeys: ["sports"] }); // no match → 0
    expect(s.tier).toBe("low");
  });
});

describe("mutes", () => {
  it("a muted source forces the low tier even at a would-be-priority score", () => {
    const s = score(item(), {
      savedCategoryKeys: ["tech"],
      followedCreatorUrls: ["https://example.com/feed"],
      trendingSourceKeys: ["example feed"],
      engagedSourceUrls: ["https://example.com/feed"],
      mutedSourceUrls: ["https://example.com/feed"],
    });
    expect(s.score).toBe(100 + ALERT_WEIGHTS.lowQuality); // −30 applied
    expect(s.muted).toBe(true);
    expect(s.tier).toBe("low"); // override wins over the 70-point score
    expect(s.factors).toContain("mutedSource");
  });

  it("a muted keyword matches title or description, case-insensitive", () => {
    const byTitle = score(item({ title: "Election night special" }), { mutedKeywords: ["election"] });
    expect(byTitle.muted).toBe(true);
    expect(byTitle.tier).toBe("low");
    const byDesc = score(item({ description: "All about the ELECTION results" }), {
      mutedKeywords: ["election"],
    });
    expect(byDesc.muted).toBe(true);
    const clean = score(item(), { mutedKeywords: ["election"] });
    expect(clean.muted).toBe(false);
  });

  it("mute + thin content still only applies the penalty once", () => {
    const s = score(item({ title: "" }), { mutedSourceUrls: ["https://example.com/feed"] });
    expect(s.score).toBe(ALERT_WEIGHTS.lowQuality);
    expect(s.factors).toEqual(expect.arrayContaining(["thinContent", "mutedSource"]));
  });
});

describe("only-notify toggles", () => {
  const followedTrending: NewsScoringContext = {
    followedCreatorUrls: ["https://example.com/feed"],
    trendingSourceKeys: ["example feed"],
    engagedSourceUrls: ["https://example.com/feed"],
  };

  it("onlyPresets demotes an alerting non-preset item to the quiet feed tier", () => {
    // 25 + 20 + 15 + 10 = 70 → alert normally…
    expect(score(item(), followedTrending).tier).toBe("alert");
    // …but with onlyPresets on and no category match, it must not alert.
    const s = score(item(), { ...followedTrending, onlyPresets: true });
    expect(s.score).toBe(70);
    expect(s.tier).toBe("feed");
  });

  it("onlyFollowedCreators keeps followed-creator alerts and demotes the rest", () => {
    const kept = score(item(), { ...followedTrending, onlyFollowedCreators: true });
    expect(kept.tier).toBe("alert"); // source IS followed
    const other = score(item({ sourceUrl: "https://other.com/feed", sourceName: "Huberman Lab" }), {
      savedCategoryKeys: ["tech"],
      trendingSourceKeys: ["huberman lab"],
      onlyFollowedCreators: true,
    });
    // 30 + 20 + 15 = 65 → feed anyway, and never promoted.
    expect(other.tier).toBe("feed");
  });

  it("either enabled toggle can rescue an item (union, not intersection)", () => {
    const s = score(item(), {
      savedCategoryKeys: ["tech"],
      followedCreatorUrls: ["https://example.com/feed"],
      onlyPresets: true,
      onlyFollowedCreators: true,
    });
    // 30 + 25 + 15 = 70, matches both criteria → alert survives.
    expect(s.tier).toBe("alert");
  });

  it("toggles never promote — a low item stays low", () => {
    const s = score(item(), { savedCategoryKeys: ["tech"], onlyPresets: true });
    expect(s.score).toBe(30);
    expect(s.tier).toBe("low");
  });
});

describe("helpers", () => {
  it("hasBreakingKeyword handles multi-word phrases", () => {
    expect(hasBreakingKeyword("JUST  IN: something")).toBe(true);
    expect(hasBreakingKeyword(undefined)).toBe(false);
  });

  it("looksLikePersonName accepts people and rejects outlets", () => {
    expect(looksLikePersonName("Marc Maron")).toBe(true);
    expect(looksLikePersonName("Andrew D. Huberman")).toBe(true);
    expect(looksLikePersonName("NPR News")).toBe(false);
    expect(looksLikePersonName("BBC Sport")).toBe(false);
    expect(looksLikePersonName("The Verge")).toBe(false);
    expect(looksLikePersonName("lowercase name")).toBe(false);
    expect(looksLikePersonName("Agent 47")).toBe(false);
    expect(looksLikePersonName("")).toBe(false);
    expect(looksLikePersonName("One")).toBe(false);
  });

  it("presetShowTitleKeys contains normalized curated titles and aliases", () => {
    const keys = presetShowTitleKeys();
    expect(keys.has("huberman lab")).toBe(true);
    expect(keys.has("joe rogan experience")).toBe(true); // leading "the" stripped
    expect(keys.has("peter attia drive")).toBe(true); // alias
  });

  it("sanitizeMuteList trims, dedupes (case-insensitive) and caps", () => {
    expect(sanitizeMuteList([" a ", "A", "b", "", 42 as any])).toEqual(["a", "b"]);
    expect(sanitizeMuteList("nope" as any)).toEqual([]);
    const big = Array.from({ length: 80 }, (_, i) => `kw${i}`);
    expect(sanitizeMuteList(big)).toHaveLength(50);
    expect(sanitizeMuteList(big, 3)).toHaveLength(3);
  });

  it("scoreNewsItems batch-scores with one shared context", () => {
    const out = scoreNewsItems([item(), item({ id: "id-2", sourceCategory: "Sports" })], {
      savedCategoryKeys: ["tech"],
    });
    expect(out).toHaveLength(2);
    expect(out[0].score).toBe(30);
    expect(out[1].score).toBe(0);
  });
});
