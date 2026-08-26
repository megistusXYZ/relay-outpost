// Story clustering for the merged News thread — the duplicate-fatigue fix.
//
// Groups near-duplicate coverage of the SAME story from different outlets into
// one cluster ("stack"), so the thread shows a story once with an "N sources"
// chip instead of five near-identical cards. Pure and framework-free: TF-IDF
// vectors over title+description, cosine similarity, agglomerative clustering
// (average linkage). No network, no deps — everything is unit-tested with
// realistic multi-outlet fixtures (story-cluster.test.ts).
//
// This module is a FEEDER for the smart-alert scorer (news-scoring.ts): each
// cluster's unique-outlet count becomes the scorer's corroboration factor.
// Copy built on top of this must say "N sources" — never "verified"/"true"/
// "confirmed"; outlet count is corroboration, not truth.
//
// ── Determinism & stability contract ─────────────────────────────────────────
// - Clustering identical input yields identical output (same order, same ids);
//   the last result is memoized on (threshold + item-id list) so re-renders and
//   refreshes that deliver the same items are free.
// - clusterId = the EARLIEST-PUBLISHED member's item id (ties → input order),
//   so a stack keeps its identity as later copies of the story stream in.
// - LEAD SELECTION RULE: the lead is the earliest-published member — the outlet
//   that broke the story — with undated items after dated ones and input order
//   as the tie-break. Chosen over "newest" so the stack's face never reshuffles
//   as follow-up copies arrive; leadItemId therefore always equals clusterId.

/** The minimal item shape clustering needs. Merged RSS items satisfy it. */
export interface ClusterableStory {
  /** Stable id — the News reader's item-id convention (guid → id → link). */
  id: string;
  title?: string;
  description?: string;
  /** Feed URL of the originating source (drives outletCount). */
  sourceUrl?: string;
  /** RFC-ish date string; unparseable/missing dates sort after dated members. */
  pubDate?: string;
}

export interface StoryCluster {
  /** Stable id — the earliest-published member's item id. */
  clusterId: string;
  /** Every member id, lead first, then earliest → latest published. */
  itemIds: string[];
  /** The earliest-published member (see lead-selection rule above). */
  leadItemId: string;
  /** Unique non-empty sourceUrls across members (≥ 1). */
  outletCount: number;
}

/**
 * Similarity threshold for merging two stories, tuned against the fixture
 * suites in story-cluster.test.ts. The plan's starting point was 0.68 (from
 * raw-shingle overlap scales); under THIS representation — sublinear TF ×
 * smoothed IDF over unigrams + bigram shingles, unit-cosine — measured
 * fixtures land in two bands: same-story cross-outlet pairs ≥ ~0.26, distinct
 * stories sharing vocabulary ≤ ~0.20 (worst trap: two different
 * "X releases update fixing security flaw" stories at 0.199). 0.23 sits in
 * the gap, biased toward the distinct band because a false MERGE (two stories
 * shown as one) is worse than a false split (today's duplicate cards).
 */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.23;

/** Below this many distinct terms an item is too thin to cluster reliably. */
const MIN_TERMS = 3;

// ── Tokenization ─────────────────────────────────────────────────────────────

// Small English stopword list — function words plus feed boilerplate. Kept
// deliberately compact; TF-IDF already down-weights corpus-common terms.
const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "between", "both",
  "but", "by", "can", "could", "did", "do", "does", "down", "during", "each",
  "few", "for", "from", "further", "had", "has", "have", "having", "he",
  "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into", "is",
  "it", "its", "itself", "just", "man", "may", "me", "might", "more", "most",
  "my", "new", "no", "nor", "not", "now", "of", "off", "on", "once", "only",
  "or", "other", "our", "out", "over", "own", "said", "same", "says", "she",
  "should", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "through", "to", "too",
  "under", "until", "up", "very", "was", "we", "were", "what", "when",
  "where", "which", "while", "who", "whom", "why", "will", "with", "would",
  "you", "your",
  // feed boilerplate
  "read", "full", "story", "article", "news", "report", "update", "updates",
  "live", "latest", "video", "photos", "amp", "nbsp", "quot",
]);

/** Strip HTML tags/entities from feed descriptions (cheap, good enough). */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&#\d+;|&[a-z]+;/gi, " ");
}

// Hyphens split tokens so "half-point" and "half point" phrasings align.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Lowercase, tokenize, stopword-strip. Exported for the tests. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const matches = stripMarkup(text).toLowerCase().matchAll(TOKEN_RE);
  for (const m of matches) {
    const t = m[0].replace(/[’']s$/, "").replace(/^['’]+|['’]+$/g, "");
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// ── TF-IDF vectors + cosine ──────────────────────────────────────────────────

type SparseVec = Map<string, number>;

/** Title terms count double — headlines carry the story's identity. */
const TITLE_WEIGHT = 2;

/**
 * Add a field's unigrams AND word-bigram shingles (over the stopword-stripped
 * stream) to the term counts. Shingles are the discriminator: distinct stories
 * can share vocabulary ("releases … security flaw"), but the same story shares
 * PHRASES ("interest rates", "half point", "tsunami advisories").
 */
function addFieldTerms(tf: SparseVec, tokens: string[], weight: number) {
  for (let i = 0; i < tokens.length; i++) {
    tf.set(tokens[i], (tf.get(tokens[i]) || 0) + weight);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      tf.set(bigram, (tf.get(bigram) || 0) + weight);
    }
  }
}

function termCounts(item: ClusterableStory): SparseVec {
  const tf: SparseVec = new Map();
  addFieldTerms(tf, tokenize(item.title || ""), TITLE_WEIGHT);
  addFieldTerms(tf, tokenize(item.description || ""), 1);
  return tf;
}

/** Unit-normalized TF-IDF vectors for the whole corpus (empty map = too thin). */
function buildVectors(items: ClusterableStory[]): SparseVec[] {
  const counts = items.map(termCounts);
  // Document frequency over distinct term presence.
  const df = new Map<string, number>();
  for (const tf of counts) {
    for (const term of tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const n = items.length;
  return counts.map((tf) => {
    if (tf.size < MIN_TERMS) return new Map();
    const vec: SparseVec = new Map();
    let norm = 0;
    for (const [term, count] of tf) {
      // Sublinear tf × smoothed idf (sklearn-style).
      const w = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + (df.get(term) || 0))) + 1);
      vec.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return new Map();
    for (const [term, w] of vec) vec.set(term, w / norm);
    return vec;
  });
}

/** Cosine similarity of two unit vectors (dot product; empty vec → 0). */
function cosine(a: SparseVec, b: SparseVec): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of small) {
    const wb = big.get(term);
    if (wb !== undefined) dot += w * wb;
  }
  return dot;
}

/**
 * Pairwise cosine matrix over the corpus's TF-IDF vectors — exposed for
 * threshold tuning and the margin assertions in the tests.
 */
export function similarityMatrix(items: ClusterableStory[]): number[][] {
  const vectors = buildVectors(items);
  return vectors.map((a) => vectors.map((b) => cosine(a, b)));
}

// ── Agglomerative clustering (average linkage) ───────────────────────────────

/**
 * Merge-loop over the pairwise similarity matrix. Average linkage via the
 * Lance–Williams update: sim(A∪B, C) = (|A|·sim(A,C) + |B|·sim(B,C)) / (|A|+|B|).
 * Deterministic: the best pair each round breaks ties on the smaller indices.
 * O(n²) space, O(n²·merges) time — fine for the ~500-item merged thread.
 */
function agglomerate(vectors: SparseVec[], threshold: number): number[][] {
  const n = vectors.length;
  // clusters[i] = member indices, or null when merged away.
  const clusters: (number[] | null)[] = vectors.map((_, i) => [i]);
  // Pairwise sims, keyed i * n + j (i < j), only pairs that could ever merge.
  const sims = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (vectors[i].size === 0) continue; // thin items never cluster
    for (let j = i + 1; j < n; j++) {
      if (vectors[j].size === 0) continue;
      const s = cosine(vectors[i], vectors[j]);
      if (s >= threshold) sims.set(i * n + j, s);
    }
  }

  // A sim can only fall under average linkage, so pruning below-threshold
  // entries as we go keeps the scan set small.
  while (sims.size > 0) {
    // Find the best pair (ties → smallest i, then smallest j).
    let bestKey = -1;
    let bestSim = -1;
    for (const [key, s] of sims) {
      if (s > bestSim || (s === bestSim && key < bestKey)) {
        bestSim = s;
        bestKey = key;
      }
    }
    if (bestSim < threshold) break;
    const i = Math.floor(bestKey / n);
    const j = bestKey % n;
    const a = clusters[i]!;
    const b = clusters[j]!;
    // Merge j into i, then recompute i's sims to every other live cluster.
    clusters[i] = [...a, ...b];
    clusters[j] = null;
    sims.delete(bestKey);
    for (let k = 0; k < n; k++) {
      if (k === i || !clusters[k]) continue;
      const keyIK = k < i ? k * n + i : i * n + k;
      const keyJK = k < j ? k * n + j : j * n + k;
      const simIK = sims.get(keyIK);
      const simJK = sims.get(keyJK);
      sims.delete(keyJK);
      if (simIK === undefined && simJK === undefined) continue;
      // Absent entries are below-threshold; treat as 0 — an underestimate that
      // only makes merging MORE conservative, never less.
      const merged = (a.length * (simIK ?? 0) + b.length * (simJK ?? 0)) / (a.length + b.length);
      if (merged >= threshold) sims.set(keyIK, merged);
      else sims.delete(keyIK);
    }
  }

  return clusters.filter((c): c is number[] => c !== null);
}

// ── Public API ───────────────────────────────────────────────────────────────

function itemTime(item: ClusterableStory): number {
  if (!item.pubDate) return Number.MAX_SAFE_INTEGER;
  const t = new Date(item.pubDate).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function buildCluster(items: ClusterableStory[], memberIdx: number[]): StoryCluster {
  // Lead = earliest published; undated after dated; ties → input order.
  const ordered = [...memberIdx].sort(
    (a, b) => itemTime(items[a]) - itemTime(items[b]) || a - b,
  );
  const leadItemId = items[ordered[0]].id;
  const outlets = new Set<string>();
  for (const idx of ordered) {
    const u = (items[idx].sourceUrl || "").trim();
    if (u) outlets.add(u);
  }
  return {
    clusterId: leadItemId,
    itemIds: ordered.map((idx) => items[idx].id),
    leadItemId,
    outletCount: Math.max(outlets.size, 1),
  };
}

// Single-entry memo: the News page re-derives its merged list on every refresh
// tick; when the item-id set is unchanged the previous clustering is returned
// as-is (same reference), which also keeps downstream useMemos stable.
let memoKey: string | null = null;
let memoResult: StoryCluster[] | null = null;

/**
 * Cluster a merged item list into story stacks. Returns one StoryCluster per
 * story INCLUDING singletons (so every input id appears in exactly one
 * cluster), ordered by each cluster's first appearance in the input.
 */
export function clusterStories(
  items: ClusterableStory[],
  opts: { threshold?: number } = {},
): StoryCluster[] {
  const threshold = opts.threshold ?? CLUSTER_SIMILARITY_THRESHOLD;
  const key = `${threshold} ${items.map((it) => it.id).join(" ")}`;
  if (memoKey === key && memoResult) return memoResult;

  const vectors = buildVectors(items);
  const groups = agglomerate(vectors, threshold);
  // Order clusters by their first member's input position (deterministic).
  groups.sort((a, b) => Math.min(...a) - Math.min(...b));
  const result = groups.map((g) => buildCluster(items, g));

  memoKey = key;
  memoResult = result;
  return result;
}
