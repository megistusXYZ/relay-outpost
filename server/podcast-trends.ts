// Pure trend-suggestion engine for Podcast Index trending history ("Rising
// now"). No I/O, no timers, no globals — everything here is a deterministic
// function over snapshot rows, so it is fully unit-testable with synthetic
// fixtures (see podcast-trends.test.ts). The routes layer owns persistence
// (podcast_trend_snapshots table) and upstream fetches; this module owns the
// rules.
//
// Snapshot model: capture is REQUEST-DRIVEN, not setInterval — the deployment
// can sleep, so background timers are unreliable. On any trending /
// trend-suggestions hit, if the last snapshot for that category is older than
// SNAPSHOT_MIN_INTERVAL_MS, the route captures the top SNAPSHOT_TOP_N feeds as
// one snapshot "day" and prunes rows older than HISTORY_MAX_DAYS.

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Capture at most one snapshot per category per ~day (20h keeps a daily-ish
 * cadence even when traffic arrives at slightly different times each day). */
export const SNAPSHOT_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** How many top trending feeds to record per snapshot. */
export const SNAPSHOT_TOP_N = 15;
/** Rolling history window. */
export const HISTORY_MAX_DAYS = 14;
/** Day-over-day rank improvement that counts as "surging". */
export const RANK_JUMP_THRESHOLD = 8;
/** "Enters the top N of its category" boundary. */
export const TOP_RANK = 10;
/** Appearing in trending on this many distinct days ⇒ "rising". */
export const MIN_DISTINCT_DAYS = 3;
/**
 * "New entrant" lookback: a show trending today that was absent from EVERY
 * snapshot in the previous N days (while the category HAS snapshots in that
 * window, so absence is meaningful) is momentum "new" — even below the
 * top-{@link TOP_RANK}.
 */
export const NEW_ENTRANT_ABSENT_DAYS = 7;
/**
 * "Consistent high performer": snapshotted (i.e. top {@link SNAPSHOT_TOP_N})
 * on at least this many distinct days ⇒ the suggestion carries
 * `consistent: true`, surfaced to users as "Consistently strong".
 */
export const CONSISTENT_MIN_DAYS = 3;

// ── Types ────────────────────────────────────────────────────────────────────

/** One feed's position in one category snapshot (one row of history). */
export interface TrendSnapshotEntry {
  feedId: number;
  title: string;
  /** Normalized category key ("" = global Top; otherwise a PI category id as text). */
  category: string;
  /** 1-based rank within the snapshot. */
  rank: number;
  /** UTC day of the snapshot, YYYY-MM-DD. */
  day: string;
  trendScore?: number;
  /** True when artwork + author + description were all present at capture. */
  hasCompleteMeta?: boolean;
}

export type TrendMomentum = "new" | "rising" | "surging";

export interface TrendSuggestion {
  feedId: number;
  title: string;
  category: string;
  momentum: TrendMomentum;
  /** Human sentence explaining why this show is suggested. */
  reason: string;
  /**
   * Consistent high performer: snapshotted (top {@link SNAPSHOT_TOP_N}) on
   * ≥ {@link CONSISTENT_MIN_DAYS} distinct days. Surfaced in the UI as a
   * "Consistently strong" chip alongside the momentum tier.
   */
  consistent: boolean;
  /** 0–100 numeric momentum strength — see {@link computeMomentumScore}. */
  momentumScore: number;
}

/**
 * Numeric momentum strength, 0–100 (clamped). The formula sums four bounded
 * signals on top of a tier base, so stronger tiers always outrank weaker ones
 * and the extras break ties within a tier:
 *
 *   momentumScore = base(momentum)            surging 60 · rising 40 · new 25
 *                 + 2 × min(10, jump)         day-over-day rank improvement, ≤ +20
 *                 + 3 × min(7, distinctDays)  persistence in the window,      ≤ +21
 *                 + (rank ≤ 10 ? 11 − rank)   current top-10 position,        ≤ +10
 *                 + (consistent ? 10 : 0)     consistent high performer,        +10
 *   … clamped to [0, 100].
 */
export function computeMomentumScore(args: {
  momentum: TrendMomentum;
  /** Rank improvement vs the previous appearance (null/negative ⇒ 0). */
  jump: number | null;
  distinctDays: number;
  /** Current 1-based rank. */
  rank: number;
  consistent: boolean;
}): number {
  const base: Record<TrendMomentum, number> = { surging: 60, rising: 40, new: 25 };
  const jump = Math.max(0, args.jump ?? 0);
  const score =
    base[args.momentum] +
    2 * Math.min(10, jump) +
    3 * Math.min(7, Math.max(0, args.distinctDays)) +
    (args.rank >= 1 && args.rank <= TOP_RANK ? TOP_RANK + 1 - args.rank : 0) +
    (args.consistent ? 10 : 0);
  return Math.max(0, Math.min(100, score));
}

// ── Category naming ──────────────────────────────────────────────────────────
// The preset pills the client uses (ids match client/src/lib/podcast-index.ts).
// Kept small on purpose: labels are only needed for human-readable reasons and
// name→id normalization of the `category` query param.

const PRESET_CATEGORY_LABELS: Record<string, string> = {
  "55": "News",
  "9": "Business",
  "86": "Sports",
  "102": "Technology",
  "29": "Health",
  "67": "Science",
  "41": "Stories",
  "78": "Culture",
  "16": "Comedy",
};

const PRESET_CATEGORY_IDS_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(PRESET_CATEGORY_LABELS).map(([id, name]) => [name.toLowerCase(), id]),
);

/**
 * Normalize a category query value to the snapshot key: "" for global/Top,
 * a numeric id passed through, a known preset NAME mapped to its id, and any
 * other value lowercased (matches how the trending route keys snapshots).
 */
export function normalizeTrendCategoryKey(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v || v.toLowerCase() === "top") return "";
  if (/^\d+$/.test(v)) return v;
  return PRESET_CATEGORY_IDS_BY_NAME[v.toLowerCase()] ?? v.toLowerCase();
}

/** Human label for a category key ("" → "" so global reasons omit the name). */
export function trendCategoryLabel(categoryKey: string): string {
  if (!categoryKey) return "";
  return PRESET_CATEGORY_LABELS[categoryKey]
    ?? (/^\d+$/.test(categoryKey) ? "" : categoryKey.replace(/\b\w/g, (c) => c.toUpperCase()));
}

// ── Snapshot helpers (pure) ──────────────────────────────────────────────────

/** UTC calendar day (YYYY-MM-DD) for a unix-ms timestamp. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whether a new snapshot should be captured now for a category. */
export function shouldCaptureSnapshot(lastCapturedAtMs: number | null | undefined, nowMs: number): boolean {
  if (lastCapturedAtMs == null) return true;
  return nowMs - lastCapturedAtMs >= SNAPSHOT_MIN_INTERVAL_MS;
}

/** Cutoff timestamp (ms) below which history rows should be pruned. */
export function historyCutoffMs(nowMs: number, maxDays: number = HISTORY_MAX_DAYS): number {
  return nowMs - maxDays * 24 * 60 * 60 * 1000;
}

/** The minimal feed shape a snapshot needs (matches the routes' mapped feed). */
export interface SnapshotFeedInput {
  id: number;
  title: string;
  trendScore?: number;
  image?: string;
  author?: string;
  description?: string;
}

/**
 * Turn a trending response (already in upstream trending order) into snapshot
 * entries for the top {@link SNAPSHOT_TOP_N}. Rank = 1-based list position.
 */
export function toSnapshotEntries(
  feeds: SnapshotFeedInput[],
  categoryKey: string,
  nowMs: number,
  topN: number = SNAPSHOT_TOP_N,
): TrendSnapshotEntry[] {
  const day = utcDay(nowMs);
  return feeds
    .filter((f) => f && typeof f.id === "number" && f.title)
    .slice(0, topN)
    .map((f, i) => ({
      feedId: f.id,
      title: f.title,
      category: categoryKey,
      rank: i + 1,
      day,
      trendScore: f.trendScore ?? 0,
      hasCompleteMeta: !!(f.image && f.author && f.description),
    }));
}

// ── Suggestion engine ────────────────────────────────────────────────────────

interface FeedTrendStats {
  latest: TrendSnapshotEntry;
  /** Entry from the most recent PRIOR day the feed appeared (if any). */
  prev: TrendSnapshotEntry | null;
  distinctDays: number;
}

function labelPhrase(categoryKey: string): { inCat: string; catTop: string; presetHint: string } {
  const label = trendCategoryLabel(categoryKey);
  if (!label) {
    return {
      inCat: "in trending",
      catTop: `the trending top ${TOP_RANK}`,
      presetHint: "Consider adding it to your feeds.",
    };
  }
  return {
    inCat: `in ${label}`,
    catTop: `the ${label} top ${TOP_RANK}`,
    presetHint: `Consider adding to the ${label} preset.`,
  };
}

/** UTC day string N days before a YYYY-MM-DD day. */
function dayMinus(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? utcDay(t - n * 86_400_000) : day;
}

/**
 * Compute rising-show suggestions from snapshot history (any mix of categories;
 * pass pre-filtered rows for a single category to scope it).
 *
 * Rules (in priority order — first match sets the momentum):
 *  - "surging": rank improved by ≥ {@link RANK_JUMP_THRESHOLD} positions vs the
 *    previous day the show appeared.
 *  - "rising": appeared in trending on ≥ {@link MIN_DISTINCT_DAYS} distinct
 *    days, OR broke into the top {@link TOP_RANK} having prior history.
 *  - "new": first-ever appearance, straight into the top {@link TOP_RANK}.
 *  - "new" (new entrant): trending today (any rank) while absent from EVERY
 *    snapshot of the previous {@link NEW_ENTRANT_ABSENT_DAYS} days — only when
 *    the category has snapshots in that window, so absence is evidence rather
 *    than missing data.
 *
 * Each suggestion also carries `consistent` (top-{@link SNAPSHOT_TOP_N} on
 * ≥ {@link CONSISTENT_MIN_DAYS} distinct days — a consistent high performer)
 * and a 0–100 `momentumScore` ({@link computeMomentumScore}).
 *
 * Only shows present on the LATEST snapshot day are eligible (a suggestion is
 * always about something trending right now). Results are prioritized by
 * momentum strength, then complete metadata, then trendScore, then rank.
 */
export function computeTrendSuggestions(
  history: TrendSnapshotEntry[],
  opts: { limit?: number } = {},
): TrendSuggestion[] {
  const limit = Math.min(10, Math.max(1, opts.limit ?? 5));
  if (!history.length) return [];

  const latestDay = history.reduce((m, e) => (e.day > m ? e.day : m), history[0].day);
  const windowDays = new Set(history.map((e) => e.day)).size;
  // Per-category snapshot days BEFORE today within the new-entrant lookback —
  // absence only means "new" when the category actually has history to be
  // absent from.
  const newEntrantFloor = dayMinus(latestDay, NEW_ENTRANT_ABSENT_DAYS);
  const priorLookbackDaysByCategory = new Map<string, Set<string>>();
  for (const e of history) {
    if (e.day >= latestDay || e.day < newEntrantFloor) continue;
    let set = priorLookbackDaysByCategory.get(e.category);
    if (!set) priorLookbackDaysByCategory.set(e.category, (set = new Set()));
    set.add(e.day);
  }

  // Group rows per feed (keyed by category+feedId so mixed-category input
  // never cross-contaminates a feed trending in two categories).
  const byFeed = new Map<string, TrendSnapshotEntry[]>();
  for (const e of history) {
    const key = `${e.category}:${e.feedId}`;
    const list = byFeed.get(key);
    if (list) list.push(e);
    else byFeed.set(key, [e]);
  }

  const momentumWeight: Record<TrendMomentum, number> = { surging: 3, rising: 2, new: 1 };
  const scored: { suggestion: TrendSuggestion; score: number; rank: number }[] = [];

  for (const entries of byFeed.values()) {
    entries.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const latest = entries[entries.length - 1];
    if (latest.day !== latestDay) continue; // not currently trending

    // If a day somehow has duplicate rows, keep the best (lowest) rank per day.
    const rankByDay = new Map<string, TrendSnapshotEntry>();
    for (const e of entries) {
      const cur = rankByDay.get(e.day);
      if (!cur || e.rank < cur.rank) rankByDay.set(e.day, e);
    }
    const days = [...rankByDay.keys()].sort();
    const distinctDays = days.length;
    const prevDay = days.length >= 2 ? days[days.length - 2] : null;
    const stats: FeedTrendStats = {
      latest: rankByDay.get(latestDay)!,
      prev: prevDay ? rankByDay.get(prevDay)! : null,
      distinctDays,
    };

    const { latest: cur, prev } = stats;
    const jump = prev ? prev.rank - cur.rank : null;
    const enteredTop = cur.rank <= TOP_RANK && (!prev || prev.rank > TOP_RANK);
    const phrases = labelPhrase(cur.category);

    // New entrant: nothing from this show in the category's snapshots for the
    // whole lookback window, while the category itself has snapshots there.
    const priorCatDays = priorLookbackDaysByCategory.get(cur.category);
    const appearedInLookback = days.some((d) => d < latestDay && d >= newEntrantFloor);
    const isNewEntrant = !!priorCatDays && priorCatDays.size > 0 && !appearedInLookback;

    // Consistent high performer: snapshotted (⇒ top SNAPSHOT_TOP_N) on enough
    // distinct days. Rank guard is belt-and-braces — snapshots only hold top-N.
    const consistentDays = [...rankByDay.values()].filter((e) => e.rank <= SNAPSHOT_TOP_N).length;
    const consistent = consistentDays >= CONSISTENT_MIN_DAYS;

    let momentum: TrendMomentum | null = null;
    let reason = "";

    if (jump != null && jump >= RANK_JUMP_THRESHOLD) {
      momentum = "surging";
      reason = `${cur.title} is surging ${phrases.inCat} — up ${jump} spots since yesterday to #${cur.rank}. ${phrases.presetHint}`;
    } else if (stats.distinctDays >= MIN_DISTINCT_DAYS) {
      momentum = "rising";
      reason = `${cur.title} is rising fast ${phrases.inCat} — appeared in trending ${stats.distinctDays} of the last ${windowDays} day${windowDays === 1 ? "" : "s"}. ${phrases.presetHint}`;
    } else if (enteredTop && prev) {
      momentum = "rising";
      reason = `${cur.title} just broke into ${phrases.catTop} at #${cur.rank}. ${phrases.presetHint}`;
    } else if (enteredTop && stats.distinctDays === 1) {
      momentum = "new";
      reason = `${cur.title} is new ${phrases.inCat} — straight into ${phrases.catTop} at #${cur.rank}. ${phrases.presetHint}`;
    } else if (isNewEntrant) {
      momentum = "new";
      reason = `${cur.title} is a new entrant ${phrases.inCat} — first appearance in over a week, now at #${cur.rank}. ${phrases.presetHint}`;
    }

    if (!momentum) continue;

    // Prioritize: momentum strength ≫ complete metadata ≫ trendScore, with the
    // better current rank breaking remaining ties.
    const score =
      momentumWeight[momentum] * 1_000_000 +
      (cur.hasCompleteMeta ? 100_000 : 0) +
      Math.min(99_999, Math.max(0, cur.trendScore ?? 0));
    scored.push({
      suggestion: {
        feedId: cur.feedId,
        title: cur.title,
        category: cur.category,
        momentum,
        reason,
        consistent,
        momentumScore: computeMomentumScore({
          momentum,
          jump,
          distinctDays: stats.distinctDays,
          rank: cur.rank,
          consistent,
        }),
      },
      score,
      rank: cur.rank,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.rank - b.rank);
  return scored.slice(0, limit).map((s) => s.suggestion);
}
