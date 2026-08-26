// Pure corroboration engine for the trending-news front page
// (NEWS_TRENDING_PLAN.md, decision 7). No I/O, no timers, no globals —
// everything is a deterministic function over parsed feed items, so it is
// fully unit-testable with synthetic fixtures (see news-corroboration.test.ts).
// The routes layer owns the /api/rss fan-out, the periodic cache, and the
// endpoint; this module owns the RULES: how near-duplicate coverage across
// outlets is grouped and how the resulting stories are ranked.
//
// THE SIGNAL. A story that many independent outlets are running RIGHT NOW is
// the definition of trending news — outlet consensus, not our editorial pick.
// So we cluster headlines that describe the same event and rank a cluster by
// how many DISTINCT outlets cover it, decayed by age. Fuzzy, not semantic
// (decision 7A): token/entity overlap within a time window, no ML. Good enough
// that "8 outlets are running this" rises; cheap enough to recompute per
// interval; with a clean seam to swap in embeddings later.

export interface NewsInput {
  /** Outlet name — the corroboration unit. Two items from the same source
   *  count once. */
  source: string;
  title: string;
  link: string;
  /** Publish time in ms since epoch. Items with no parseable date are dropped
   *  by the caller (an undated item cannot be placed in the recency window). */
  pubDateMs: number;
  description?: string;
  thumbnail?: string;
  categories?: string[];
}

export interface NewsCluster {
  /** The representative item — newest member that has an image, else newest. */
  lead: NewsInput;
  /** Distinct outlets covering the story — the corroboration count. */
  outletCount: number;
  /** Distinct outlet names, newest-first by their contributing item. */
  sources: string[];
  /** One item per outlet (the newest from each), newest-first. */
  items: NewsInput[];
  /** corroboration × recency. Higher is hotter. */
  score: number;
}

export interface ClusterOptions {
  /** Clock, injectable for tests. */
  now?: number;
  /** Items further apart than this are never the same event. Default 48h. */
  windowMs?: number;
  /** Shared significant tokens required to call two headlines the same story. */
  minSharedTokens?: number;
  /** Shared tokens must ALSO be at least this fraction of the shorter headline's
   *  significant tokens — stops a long headline from matching a short one on a
   *  few coincidental words. Default 0.34. */
  minOverlapRatio?: number;
  /** Recency half-life: a cluster's recency weight halves every this-many ms. */
  halfLifeMs?: number;
}

const DEFAULT_WINDOW_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MIN_SHARED = 3;
const DEFAULT_MIN_OVERLAP_RATIO = 0.34;
const DEFAULT_HALF_LIFE_MS = 12 * 60 * 60 * 1000;

// Common headline words that must never be the basis for calling two stories
// the same — otherwise "Market news today" and "Today in sports" collide.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "new", "news", "today", "says",
  "say", "said", "will", "how", "why", "what", "who", "when", "you", "your",
  "we", "our", "they", "their", "he", "she", "his", "her", "up", "out", "over",
  "after", "before", "amid", "into", "about", "more", "than", "just", "now",
  "report", "reports", "watch", "live", "video", "opinion", "analysis",
]);

/**
 * Significant tokens of a headline: lowercased words ≥ 3 chars that are not
 * stopwords. Names and places (the entities that actually identify a story)
 * survive; filler drops. Returned as a Set so overlap is cheap.
 */
export function significantTokens(title: string): Set<string> {
  const out = new Set<string>();
  const words = title
    .toLowerCase()
    .replace(/['’]s\b/g, "") // possessives → the bare name
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/);
  for (const w of words) {
    if (w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

/** Count of tokens two headlines share. */
function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const t of small) if (large.has(t)) n++;
  return n;
}

interface WorkingCluster {
  /** FIXED signature — the tokens of the cluster's representative (its first,
   *  freshest member). Deliberately NOT widened as members join: widening lets
   *  story A→B→C drift together through bridge headlines (single-link
   *  chaining), which merged a crypto story into sports outlets in testing.
   *  A fixed signature keeps every member measured against the same anchor. */
  tokens: Set<string>;
  bySource: Map<string, NewsInput>; // newest item per source
  leadMs: number;
}

/**
 * Group items into stories and rank them. Greedy clustering: newest-first, each
 * item joins the first existing cluster whose REPRESENTATIVE it corroborates —
 * enough shared significant tokens, a real overlap ratio, and within the time
 * window — else starts its own.
 */
export function clusterNews(items: NewsInput[], opts: ClusterOptions = {}): NewsCluster[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const minShared = opts.minSharedTokens ?? DEFAULT_MIN_SHARED;
  const minRatio = opts.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO;
  const halfLife = opts.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;

  // Newest first, so a cluster's representative (its first-placed member) is its
  // freshest — matches how a breaking story is described.
  const sorted = [...items]
    .map((i) => ({ ...i, title: i.title.trim() }))
    .filter((i) => Number.isFinite(i.pubDateMs) && i.title.length > 0)
    .sort((a, b) => b.pubDateMs - a.pubDateMs);

  const working: WorkingCluster[] = [];

  for (const item of sorted) {
    const tokens = significantTokens(item.title);
    if (tokens.size === 0) continue; // an all-stopword headline can't corroborate
    let placed = false;
    for (const c of working) {
      if (Math.abs(item.pubDateMs - c.leadMs) > windowMs) continue;
      const shared = sharedTokenCount(tokens, c.tokens);
      const ratio = shared / Math.min(tokens.size, c.tokens.size);
      if (shared >= minShared && ratio >= minRatio) {
        // Keep only the newest item per source (dedup a source that ran the
        // story twice). `sorted` is newest-first, so the first wins.
        if (!c.bySource.has(item.source)) c.bySource.set(item.source, item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      working.push({ tokens, bySource: new Map([[item.source, item]]), leadMs: item.pubDateMs });
    }
  }

  const clusters: NewsCluster[] = working.map((c) => {
    const members = [...c.bySource.values()].sort((a, b) => b.pubDateMs - a.pubDateMs);
    const outletCount = members.length;
    const newestMs = members[0]?.pubDateMs ?? 0;
    // Recency: exponential decay from the newest member.
    const ageMs = Math.max(0, now - newestMs);
    const recency = Math.pow(0.5, ageMs / halfLife);
    // Corroboration: diminishing returns past the first few outlets, so a
    // 12-outlet pile-up doesn't bury a fresh 3-outlet break. sqrt is a gentle
    // curve — real lift for the 2nd–5th outlet, tapering after.
    const corroboration = Math.sqrt(outletCount);
    // A member with an image leads; else the newest.
    const lead = members.find((m) => !!m.thumbnail) ?? members[0];
    return {
      lead,
      outletCount,
      sources: members.map((m) => m.source),
      items: members,
      score: corroboration * recency,
    };
  });

  return clusters.sort((a, b) => b.score - a.score);
}
