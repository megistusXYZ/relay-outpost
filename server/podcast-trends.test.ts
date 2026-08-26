import { describe, it, expect } from "vitest";
import {
  computeMomentumScore,
  computeTrendSuggestions,
  historyCutoffMs,
  normalizeTrendCategoryKey,
  shouldCaptureSnapshot,
  toSnapshotEntries,
  trendCategoryLabel,
  utcDay,
  CONSISTENT_MIN_DAYS,
  HISTORY_MAX_DAYS,
  RANK_JUMP_THRESHOLD,
  SNAPSHOT_MIN_INTERVAL_MS,
  SNAPSHOT_TOP_N,
  type TrendSnapshotEntry,
} from "./podcast-trends";

// Fixture helper — a snapshot row with sensible defaults.
const entry = (
  feedId: number,
  day: string,
  rank: number,
  extra: Partial<TrendSnapshotEntry> = {},
): TrendSnapshotEntry => ({
  feedId,
  title: `Show ${feedId}`,
  category: "102",
  rank,
  day,
  trendScore: 0,
  hasCompleteMeta: true,
  ...extra,
});

describe("utcDay", () => {
  it("formats a unix-ms timestamp as UTC YYYY-MM-DD", () => {
    expect(utcDay(Date.UTC(2026, 6, 17, 12, 0, 0))).toBe("2026-07-17");
    // Just before midnight UTC stays on the same day.
    expect(utcDay(Date.UTC(2026, 6, 17, 23, 59, 59))).toBe("2026-07-17");
    expect(utcDay(Date.UTC(2026, 6, 18, 0, 0, 1))).toBe("2026-07-18");
  });
});

describe("shouldCaptureSnapshot", () => {
  const now = Date.UTC(2026, 6, 17, 12, 0, 0);
  it("captures when there is no prior snapshot", () => {
    expect(shouldCaptureSnapshot(null, now)).toBe(true);
    expect(shouldCaptureSnapshot(undefined, now)).toBe(true);
  });
  it("skips when the last snapshot is fresher than the interval", () => {
    expect(shouldCaptureSnapshot(now - SNAPSHOT_MIN_INTERVAL_MS + 1000, now)).toBe(false);
    expect(shouldCaptureSnapshot(now - 60_000, now)).toBe(false);
  });
  it("captures once the interval has elapsed", () => {
    expect(shouldCaptureSnapshot(now - SNAPSHOT_MIN_INTERVAL_MS, now)).toBe(true);
    expect(shouldCaptureSnapshot(now - 2 * SNAPSHOT_MIN_INTERVAL_MS, now)).toBe(true);
  });
});

describe("historyCutoffMs", () => {
  it("cuts off at the rolling window", () => {
    const now = 1_000_000_000_000;
    expect(historyCutoffMs(now)).toBe(now - HISTORY_MAX_DAYS * 86_400_000);
    expect(historyCutoffMs(now, 1)).toBe(now - 86_400_000);
  });
});

describe("normalizeTrendCategoryKey", () => {
  it("maps empty / Top to the global key", () => {
    expect(normalizeTrendCategoryKey("")).toBe("");
    expect(normalizeTrendCategoryKey(null)).toBe("");
    expect(normalizeTrendCategoryKey(undefined)).toBe("");
    expect(normalizeTrendCategoryKey("Top")).toBe("");
  });
  it("passes numeric ids through", () => {
    expect(normalizeTrendCategoryKey("86")).toBe("86");
    expect(normalizeTrendCategoryKey(" 55 ")).toBe("55");
  });
  it("maps known preset names to their ids (case-insensitive)", () => {
    expect(normalizeTrendCategoryKey("Sports")).toBe("86");
    expect(normalizeTrendCategoryKey("news")).toBe("55");
    expect(normalizeTrendCategoryKey("TECHNOLOGY")).toBe("102");
    expect(normalizeTrendCategoryKey("Comedy")).toBe("16");
  });
  it("lowercases unknown names", () => {
    expect(normalizeTrendCategoryKey("True Crime")).toBe("true crime");
  });
});

describe("trendCategoryLabel", () => {
  it("labels preset ids and leaves global empty", () => {
    expect(trendCategoryLabel("")).toBe("");
    expect(trendCategoryLabel("102")).toBe("Technology");
    expect(trendCategoryLabel("86")).toBe("Sports");
  });
  it("title-cases non-numeric keys and hides unknown numeric ids", () => {
    expect(trendCategoryLabel("true crime")).toBe("True Crime");
    expect(trendCategoryLabel("999")).toBe("");
  });
});

describe("toSnapshotEntries", () => {
  const now = Date.UTC(2026, 6, 17, 8, 0, 0);
  const feed = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Show ${id}`,
    trendScore: 100 - id,
    image: "https://a/img.jpg",
    author: "Host",
    description: "About the show",
    ...extra,
  });

  it("keeps upstream order as rank (1-based) and stamps the UTC day", () => {
    const entries = toSnapshotEntries([feed(7), feed(3), feed(9)], "86", now);
    expect(entries.map((e) => [e.feedId, e.rank])).toEqual([[7, 1], [3, 2], [9, 3]]);
    expect(entries.every((e) => e.day === "2026-07-17" && e.category === "86")).toBe(true);
  });

  it("caps at the top-N and drops malformed feeds", () => {
    const feeds = Array.from({ length: 30 }, (_, i) => feed(i + 1));
    expect(toSnapshotEntries(feeds, "", now)).toHaveLength(SNAPSHOT_TOP_N);
    const withJunk = [feed(1), { id: "x", title: "bad" } as any, { id: 2, title: "" } as any, feed(3)];
    expect(toSnapshotEntries(withJunk, "", now).map((e) => e.feedId)).toEqual([1, 3]);
  });

  it("flags complete metadata only when artwork + author + description exist", () => {
    const [ok, noArt, noAuthor] = toSnapshotEntries(
      [feed(1), feed(2, { image: "" }), feed(3, { author: "" })],
      "",
      now,
    );
    expect(ok.hasCompleteMeta).toBe(true);
    expect(noArt.hasCompleteMeta).toBe(false);
    expect(noAuthor.hasCompleteMeta).toBe(false);
  });
});

describe("computeTrendSuggestions", () => {
  it("returns nothing for empty history", () => {
    expect(computeTrendSuggestions([])).toEqual([]);
  });

  it("suggests a show trending on 3+ distinct days as rising, with a human reason", () => {
    const lex = { title: "Lex Fridman Podcast" };
    const history = [
      entry(1, "2026-07-13", 12, lex),
      entry(1, "2026-07-15", 12, lex),
      entry(1, "2026-07-16", 11, lex),
      // Contributes a 4th distinct window day; flat rank > 10 → no suggestion.
      entry(2, "2026-07-14", 12),
      entry(2, "2026-07-16", 12),
    ];
    const out = computeTrendSuggestions(history);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ feedId: 1, momentum: "rising", category: "102" });
    expect(out[0].reason).toBe(
      "Lex Fridman Podcast is rising fast in Technology — appeared in trending 3 of the last 4 days. Consider adding to the Technology preset.",
    );
  });

  it("flags a large day-over-day rank jump as surging", () => {
    const history = [
      entry(5, "2026-07-16", 13),
      entry(5, "2026-07-17", 13 - RANK_JUMP_THRESHOLD),
    ];
    const out = computeTrendSuggestions(history);
    expect(out).toHaveLength(1);
    expect(out[0].momentum).toBe("surging");
    expect(out[0].reason).toContain(`up ${RANK_JUMP_THRESHOLD} spots`);
  });

  it("treats breaking into the top 10 (with prior history) as rising", () => {
    const history = [
      entry(6, "2026-07-16", 14),
      entry(6, "2026-07-17", 9), // +5 jump — below the surge threshold
    ];
    const out = computeTrendSuggestions(history);
    expect(out).toHaveLength(1);
    expect(out[0].momentum).toBe("rising");
    expect(out[0].reason).toContain("broke into the Technology top 10 at #9");
  });

  it("marks a first-ever appearance straight into the top 10 as new", () => {
    const history = [
      entry(3, "2026-07-16", 4), // prior day, other show
      entry(7, "2026-07-17", 6),
      entry(3, "2026-07-17", 4),
    ];
    const out = computeTrendSuggestions(history);
    const s7 = out.find((s) => s.feedId === 7);
    expect(s7?.momentum).toBe("new");
    expect(s7?.reason).toContain("straight into the Technology top 10 at #6");
  });

  it("only suggests shows present on the latest snapshot day", () => {
    const history = [
      entry(1, "2026-07-13", 2),
      entry(1, "2026-07-14", 2),
      entry(1, "2026-07-15", 2), // 3 days… but gone today
      entry(9, "2026-07-16", 20),
      entry(9, "2026-07-17", 3),
    ];
    const out = computeTrendSuggestions(history);
    expect(out.map((s) => s.feedId)).toEqual([9]);
  });

  it("prioritizes stronger momentum, then complete metadata, then trendScore", () => {
    const history = [
      // rising (3 days), complete meta, high score
      entry(1, "2026-07-15", 12), entry(1, "2026-07-16", 12), entry(1, "2026-07-17", 12),
      // surging jump — but incomplete metadata
      entry(2, "2026-07-16", 15), entry(2, "2026-07-17", 2, { hasCompleteMeta: false }),
      // surging jump with complete metadata, low trendScore
      entry(3, "2026-07-16", 14), entry(3, "2026-07-17", 3, { trendScore: 5 }),
      // surging jump with complete metadata, high trendScore
      entry(4, "2026-07-16", 13), entry(4, "2026-07-17", 4, { trendScore: 90 }),
    ];
    const out = computeTrendSuggestions(history);
    expect(out.map((s) => s.feedId)).toEqual([4, 3, 2, 1]);
  });

  it("respects and clamps the limit", () => {
    const history = Array.from({ length: 8 }, (_, i) => [
      entry(i + 1, "2026-07-15", i + 2),
      entry(i + 1, "2026-07-16", i + 2),
      entry(i + 1, "2026-07-17", i + 2),
    ]).flat();
    expect(computeTrendSuggestions(history, { limit: 3 })).toHaveLength(3);
    expect(computeTrendSuggestions(history, { limit: 99 })).toHaveLength(8);
    expect(computeTrendSuggestions(history, { limit: 0 })).toHaveLength(1);
  });

  it("keeps categories separate for the same feed id and words global reasons without a category", () => {
    const history = [
      entry(1, "2026-07-16", 15, { category: "" }),
      entry(1, "2026-07-17", 3, { category: "" }),
      entry(1, "2026-07-17", 12, { category: "86" }),
    ];
    const out = computeTrendSuggestions(history);
    expect(out).toHaveLength(1); // the "86" row alone has no momentum
    expect(out[0]).toMatchObject({ feedId: 1, category: "", momentum: "surging" });
    expect(out[0].reason).toContain("surging in trending");
    expect(out[0].reason).not.toContain("undefined");
  });

  it("collapses duplicate same-day rows to the best rank", () => {
    const history = [
      entry(2, "2026-07-16", 15),
      entry(2, "2026-07-17", 12),
      entry(2, "2026-07-17", 4), // better duplicate wins → jump of 11 ⇒ surging
    ];
    const out = computeTrendSuggestions(history);
    expect(out[0].momentum).toBe("surging");
  });

  // ── New entrant (absent from the last 7 days of snapshots) ────────────────
  describe("new entrant rule", () => {
    it("flags a first-ever appearance below the top 10 as new when the category has recent history", () => {
      const history = [
        entry(1, "2026-07-15", 3), // category history inside the lookback
        entry(1, "2026-07-16", 3),
        entry(1, "2026-07-17", 3), // rank 3 flat 3 days → rising (also asserts coexistence)
        entry(8, "2026-07-17", 12), // first ever, rank 12 — not top 10
      ];
      const out = computeTrendSuggestions(history);
      const s8 = out.find((s) => s.feedId === 8);
      expect(s8?.momentum).toBe("new");
      expect(s8?.reason).toContain("new entrant");
      expect(s8?.reason).toContain("#12");
    });

    it("flags a show returning after 8+ days away as new", () => {
      const history = [
        entry(8, "2026-07-08", 12), // last seen 9 days ago (outside the 7-day lookback)
        entry(9, "2026-07-16", 11), // someone else keeps the lookback populated
        entry(8, "2026-07-17", 12), // returns today, flat rank, no top-10 entry
      ];
      const out = computeTrendSuggestions(history);
      const s8 = out.find((s) => s.feedId === 8);
      expect(s8?.momentum).toBe("new");
      expect(s8?.reason).toContain("new entrant");
    });

    it("does not fire for a show seen within the last 7 days", () => {
      const history = [
        entry(9, "2026-07-16", 11),
        entry(8, "2026-07-14", 12), // seen 3 days ago
        entry(8, "2026-07-17", 12), // flat rank 12 → no rule matches
      ];
      const out = computeTrendSuggestions(history);
      expect(out.find((s) => s.feedId === 8)).toBeUndefined();
    });

    it("does not fire when the category has no prior snapshots to be absent from", () => {
      const history = [
        entry(8, "2026-07-17", 12), // single-day history — absence proves nothing
      ];
      expect(computeTrendSuggestions(history)).toEqual([]);
    });

    it("lets stronger rules win over new-entrant (a returning show with a big jump surges)", () => {
      const history = [
        entry(9, "2026-07-16", 11),
        entry(8, "2026-07-08", 15),
        entry(8, "2026-07-17", 3), // jump 12 ≥ threshold → surging beats new-entrant
      ];
      const out = computeTrendSuggestions(history);
      expect(out.find((s) => s.feedId === 8)?.momentum).toBe("surging");
    });

    it("keeps the straight-into-the-top-10 wording for first-ever top-10 debuts", () => {
      const history = [
        entry(9, "2026-07-16", 11),
        entry(8, "2026-07-17", 5),
      ];
      const out = computeTrendSuggestions(history);
      const s8 = out.find((s) => s.feedId === 8);
      expect(s8?.momentum).toBe("new");
      expect(s8?.reason).toContain("straight into");
    });
  });

  // ── Consistent high performer flag ────────────────────────────────────────
  describe("consistent flag", () => {
    it(`marks a show snapshotted on ${CONSISTENT_MIN_DAYS}+ distinct days as consistent`, () => {
      const history = [
        entry(1, "2026-07-14", 12),
        entry(1, "2026-07-15", 12),
        entry(1, "2026-07-16", 11),
        entry(1, "2026-07-17", 11),
      ];
      const out = computeTrendSuggestions(history);
      expect(out[0].momentum).toBe("rising");
      expect(out[0].consistent).toBe(true);
    });

    it("leaves short-history shows unflagged (2-day surge is not consistent)", () => {
      const history = [
        entry(5, "2026-07-16", 13),
        entry(5, "2026-07-17", 2),
      ];
      const out = computeTrendSuggestions(history);
      expect(out[0].momentum).toBe("surging");
      expect(out[0].consistent).toBe(false);
    });
  });
});

describe("computeMomentumScore", () => {
  it("follows the documented formula", () => {
    // surging base 60 + jump 11→capped 2×10=20 + days 2→6 + rank 4→(11−4)=7 + no consistency
    expect(
      computeMomentumScore({ momentum: "surging", jump: 11, distinctDays: 2, rank: 4, consistent: false }),
    ).toBe(60 + 20 + 6 + 7);
    // rising base 40 + no jump + 3 days→9 + rank 12 (no top-10 bonus) + consistent 10
    expect(
      computeMomentumScore({ momentum: "rising", jump: 0, distinctDays: 3, rank: 12, consistent: true }),
    ).toBe(40 + 9 + 10);
    // new base 25 + null jump + 1 day→3 + rank 6→5
    expect(
      computeMomentumScore({ momentum: "new", jump: null, distinctDays: 1, rank: 6, consistent: false }),
    ).toBe(25 + 3 + 5);
  });

  it("clamps to 100 and ignores negative jumps", () => {
    expect(
      computeMomentumScore({ momentum: "surging", jump: 50, distinctDays: 14, rank: 1, consistent: true }),
    ).toBe(100);
    expect(
      computeMomentumScore({ momentum: "rising", jump: -5, distinctDays: 1, rank: 15, consistent: false }),
    ).toBe(40 + 3);
  });

  it("is attached to every suggestion", () => {
    const history = [
      entry(5, "2026-07-16", 13),
      entry(5, "2026-07-17", 13 - RANK_JUMP_THRESHOLD),
    ];
    const out = computeTrendSuggestions(history);
    // surging 60 + 2×8=16 + 2 days→6 + rank 5→6 = 88
    expect(out[0].momentumScore).toBe(88);
    expect(out[0].consistent).toBe(false);
  });
});
