// Smart alert scoring for News/RSS items — the fatigue fix behind "324 unread".
//
// Pure and framework-free: every function here is a deterministic map from an
// item + a scoring context to a numeric score and an alert tier, so the whole
// policy is unit-testable with fixtures (news-scoring.test.ts). The News page
// owns building the context (saved feeds, read ledger, trending cache, user
// prefs) and rendering the result; this module owns the rules.
//
// IMPORTANT — "priority" is IN-APP prominence, not OS push. The app has no
// web-push/notification infrastructure; tier 1 means "pinned at the top of the
// Alerts strip, visually prominent", nothing leaves the page.

import { normalizeShowTitle, PRESET_SHOWS } from "@/lib/podcast-index";

// ── Weights (documented contract; see scoreNewsItem) ─────────────────────────

export const ALERT_WEIGHTS = {
  /** Item's source is in one of the user's preset/saved categories. */
  presetCategory: 30,
  /** Source is a followed individual creator (preset-show feed or a user-added podcast). */
  followedCreator: 25,
  /** Source is currently trending (Podcast Index trend cache; 0 when unconfigured). */
  trendingSource: 20,
  /** Breaking/urgent keyword in the title. */
  breakingTitle: 25,
  /** Individual-creator-led show (PRESET_SHOWS or a person-name author). */
  creatorLed: 15,
  /** Prior engagement — the user has read/played items from this source before. */
  priorEngagement: 10,
  /**
   * Corroboration — story clustering (story-cluster.ts) found this story
   * covered by additional unique outlets. Per outlet beyond the first, capped
   * at CORROBORATION_MAX. A breadth-of-coverage signal, NOT a truth claim:
   * any copy built on it says "N sources", never "verified"/"confirmed".
   */
  corroborationPerOutlet: 5,
  /** Low-quality signal: thin content, or a muted source/keyword. */
  lowQuality: -30,
} as const;

/**
 * Cap on the total corroboration bonus (= 6+ outlets). Sized so corroboration
 * alone never crosses a tier boundary from zero (25 < FEED_MIN) but lifts
 * genuinely multi-outlet stories over the alert line when they already carry
 * a preset/creator signal (e.g. 30 preset + 10 engagement + 25 corroboration
 * = 65 feed → +breaking or trending clears 70).
 */
export const CORROBORATION_MAX = 25;

/** Alert tiers. Tier 1 ("priority") is in-app prominence only — no OS push exists. */
export type AlertTier = "priority" | "alert" | "feed" | "low";

/** Tier boundaries (inclusive minimums). */
export const PRIORITY_MIN = 90;
export const ALERT_MIN = 70;
export const FEED_MIN = 40;

/** Map a numeric score to its tier (mute overrides are applied by the caller). */
export function tierForScore(score: number): AlertTier {
  if (score >= PRIORITY_MIN) return "priority";
  if (score >= ALERT_MIN) return "alert";
  if (score >= FEED_MIN) return "feed";
  return "low";
}

/** Tiers that alert (surface in the Priority strip + count toward unread). */
export const ALERTING_TIERS: readonly AlertTier[] = ["priority", "alert"];

// ── Item / context shapes ────────────────────────────────────────────────────

/** The minimal item shape scoring needs. RSSItem + its MergeSource satisfy it. */
export interface ScorableNewsItem {
  /** Stable id (guid → id → link, mirroring rssItemId). */
  id: string;
  title?: string;
  description?: string;
  /** Feed URL of the source (the SavedFeed.url). */
  sourceUrl?: string;
  /** Display name of the source feed. */
  sourceName?: string;
  /** SavedFeed.category of the source. */
  sourceCategory?: string;
  author?: string;
  /** True for podcast episodes (item has playable audio). */
  isPodcast?: boolean;
  /** Episode duration in seconds, when known. */
  durationSec?: number;
  /**
   * Unique outlets covering this story, from story clustering
   * (StoryCluster.outletCount). Absent/1 = uncorroborated (no factor).
   */
  outletCount?: number;
}

/**
 * Everything the policy needs to score items. All fields optional/degradable:
 * an empty context scores items on content signals alone (trending degrades to
 * 0 when the Podcast Index proxy is unconfigured, etc.).
 */
export interface NewsScoringContext {
  /** Lowercased category names of the user's preset/saved feeds. */
  savedCategoryKeys?: Iterable<string>;
  /** Feed URLs treated as followed individual creators. */
  followedCreatorUrls?: Iterable<string>;
  /** normalizeShowTitle() keys of sources currently trending ([] when unknown). */
  trendingSourceKeys?: Iterable<string>;
  /** Feed URLs the user has previously read/played items from (read ledger). */
  engagedSourceUrls?: Iterable<string>;
  /** Muted feed URLs — force low-quality AND the "low" tier. */
  mutedSourceUrls?: Iterable<string>;
  /** Muted keywords (case-insensitive substring on title+description). */
  mutedKeywords?: Iterable<string>;
  /** "Only notify about my presets" — non-matching items never alert. */
  onlyPresets?: boolean;
  /** "Only notify about followed creators" — non-matching items never alert. */
  onlyFollowedCreators?: boolean;
}

export interface ScoredNewsItem<T extends ScorableNewsItem = ScorableNewsItem> {
  item: T;
  score: number;
  tier: AlertTier;
  /** Which factors fired (weight-table keys plus mute markers), for debugging/tests. */
  factors: string[];
  /** True when the source is an individual creator (drives creator digest grouping). */
  creatorLed: boolean;
  /** True when a mute rule matched (tier is forced to "low"). */
  muted: boolean;
}

// ── Heuristics ───────────────────────────────────────────────────────────────

/** Curated breaking/urgent title keywords (word-boundary, case-insensitive). */
export const BREAKING_KEYWORDS = ["breaking", "urgent", "just in", "alert"] as const;

const BREAKING_RE = new RegExp(
  `\\b(?:${BREAKING_KEYWORDS.map((k) => k.replace(/ /g, "\\s+")).join("|")})\\b`,
  "i",
);

/** True when a title carries a breaking/urgent keyword. */
export function hasBreakingKeyword(title: string | undefined): boolean {
  return !!title && BREAKING_RE.test(title);
}

// Words that mark a 2–3-word source/author as an outlet, not a person
// ("NPR News", "BBC Sport", "Daily Show Clips"…).
const NON_PERSON_WORDS = new Set([
  "news", "daily", "show", "podcast", "radio", "report", "reports", "magazine",
  "media", "network", "official", "the", "sport", "sports", "tv", "channel",
  "weekly", "review", "journal", "times", "post", "blog", "team", "staff",
]);

/**
 * Cheap person-name heuristic: 2–3 capitalized words, no digits, none of the
 * common outlet words. "Marc Maron" → true; "NPR News" / "The Verge" → false.
 */
export function looksLikePersonName(name: string | undefined): boolean {
  const s = (name || "").trim();
  if (!s || s.length > 40 || /\d/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  for (const w of words) {
    if (!/^[A-ZÀ-Þ][\p{L}'’.-]*$/u.test(w)) return false;
    if (NON_PERSON_WORDS.has(w.toLowerCase())) return false;
  }
  return true;
}

let presetShowKeysCache: Set<string> | null = null;
/** normalizeShowTitle() keys of every curated PRESET_SHOWS title + alias. */
export function presetShowTitleKeys(): Set<string> {
  if (!presetShowKeysCache) {
    presetShowKeysCache = new Set<string>();
    for (const shows of Object.values(PRESET_SHOWS)) {
      for (const show of shows) {
        for (const t of [show.title, ...(show.aliases ?? [])]) {
          const k = normalizeShowTitle(t);
          if (k) presetShowKeysCache.add(k);
        }
      }
    }
  }
  return presetShowKeysCache;
}

/** Trim/dedupe/cap a user-entered mute list (also used by the settings UI). */
export function sanitizeMuteList(raw: unknown, cap = 50): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t || t.length > 500) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

const toLowerSet = (it?: Iterable<string>): Set<string> => {
  const s = new Set<string>();
  if (it) for (const v of it) if (typeof v === "string" && v.trim()) s.add(v.trim().toLowerCase());
  return s;
};
const toSet = (it?: Iterable<string>): Set<string> => {
  const s = new Set<string>();
  if (it) for (const v of it) if (typeof v === "string" && v.trim()) s.add(v.trim());
  return s;
};

/** Pre-resolved context sets — build once per batch via prepareScoringContext. */
export interface PreparedScoringContext {
  savedCategories: Set<string>;
  followedCreators: Set<string>;
  trendingKeys: Set<string>;
  engagedSources: Set<string>;
  mutedSources: Set<string>;
  mutedKeywords: string[];
  onlyPresets: boolean;
  onlyFollowedCreators: boolean;
  presetShowKeys: Set<string>;
}

export function prepareScoringContext(ctx: NewsScoringContext = {}): PreparedScoringContext {
  return {
    savedCategories: toLowerSet(ctx.savedCategoryKeys),
    followedCreators: toSet(ctx.followedCreatorUrls),
    trendingKeys: toSet(ctx.trendingSourceKeys),
    engagedSources: toSet(ctx.engagedSourceUrls),
    mutedSources: toSet(ctx.mutedSourceUrls),
    mutedKeywords: [...toLowerSet(ctx.mutedKeywords)],
    onlyPresets: !!ctx.onlyPresets,
    onlyFollowedCreators: !!ctx.onlyFollowedCreators,
    presetShowKeys: presetShowTitleKeys(),
  };
}

/**
 * Score one item. Factor weights are the ALERT_WEIGHTS table; the tier is
 * tierForScore(score) with two overrides applied afterwards:
 *  - MUTE WINS: a muted source/keyword forces tier "low", whatever the score.
 *  - "Only …" toggles: when onlyPresets / onlyFollowedCreators are on, an item
 *    matching none of the enabled criteria is demoted out of the alerting
 *    tiers (priority/alert → feed); it still reads normally in the feed.
 */
export function scoreNewsItem<T extends ScorableNewsItem>(
  item: T,
  prepared: PreparedScoringContext,
): ScoredNewsItem<T> {
  const factors: string[] = [];
  let score = 0;

  const sourceUrl = (item.sourceUrl || "").trim();
  const sourceKey = normalizeShowTitle(item.sourceName || "");
  const category = (item.sourceCategory || "").trim().toLowerCase();

  const matchesPreset = !!category && prepared.savedCategories.has(category);
  if (matchesPreset) {
    score += ALERT_WEIGHTS.presetCategory;
    factors.push("presetCategory");
  }

  const matchesCreator = !!sourceUrl && prepared.followedCreators.has(sourceUrl);
  if (matchesCreator) {
    score += ALERT_WEIGHTS.followedCreator;
    factors.push("followedCreator");
  }

  if (sourceKey && prepared.trendingKeys.has(sourceKey)) {
    score += ALERT_WEIGHTS.trendingSource;
    factors.push("trendingSource");
  }

  if (hasBreakingKeyword(item.title)) {
    score += ALERT_WEIGHTS.breakingTitle;
    factors.push("breakingTitle");
  }

  const creatorLed =
    (!!sourceKey && prepared.presetShowKeys.has(sourceKey)) ||
    looksLikePersonName(item.author) ||
    matchesCreator;
  if (creatorLed) {
    score += ALERT_WEIGHTS.creatorLed;
    factors.push("creatorLed");
  }

  if (sourceUrl && prepared.engagedSources.has(sourceUrl)) {
    score += ALERT_WEIGHTS.priorEngagement;
    factors.push("priorEngagement");
  }

  // Corroboration: +5 per unique outlet beyond the first, capped at +25.
  const extraOutlets = Math.max(0, Math.floor(item.outletCount ?? 1) - 1);
  if (extraOutlets > 0) {
    score += Math.min(extraOutlets * ALERT_WEIGHTS.corroborationPerOutlet, CORROBORATION_MAX);
    factors.push("corroboration");
  }

  // Low-quality signal — thin content or a mute match (applied at most once).
  const thin = !(item.title || "").trim() || !(item.description || "").trim();
  const mutedSource = !!sourceUrl && prepared.mutedSources.has(sourceUrl);
  const haystack = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  const mutedKeyword = prepared.mutedKeywords.some((k) => haystack.includes(k));
  const muted = mutedSource || mutedKeyword;
  if (thin || muted) {
    score += ALERT_WEIGHTS.lowQuality;
    if (thin) factors.push("thinContent");
    if (mutedSource) factors.push("mutedSource");
    if (mutedKeyword) factors.push("mutedKeyword");
  }

  let tier = tierForScore(score);
  // Mute override always wins.
  if (muted) tier = "low";
  // "Only …" toggles zero out non-matching items' alert tiers.
  else if (prepared.onlyPresets || prepared.onlyFollowedCreators) {
    const allowed =
      (prepared.onlyPresets && matchesPreset) ||
      (prepared.onlyFollowedCreators && matchesCreator);
    if (!allowed && (tier === "priority" || tier === "alert")) tier = "feed";
  }

  return { item, score, tier, factors, creatorLed, muted };
}

/** Batch-score items with one prepared context. */
export function scoreNewsItems<T extends ScorableNewsItem>(
  items: T[],
  ctx: NewsScoringContext = {},
): ScoredNewsItem<T>[] {
  const prepared = prepareScoringContext(ctx);
  return items.map((it) => scoreNewsItem(it, prepared));
}
