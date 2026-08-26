/**
 * Discover feed ranking — the "interesting mix" for the For You / Discover feed.
 *
 * Pure + deterministic so it is unit-testable in isolation. Blends three signals
 * the caller supplies (engagement, recency, network/trust proximity) into a
 * score, then applies an author-diversity pass so one loud account can't
 * dominate a run of the feed. "Latest" mode bypasses this entirely (the caller
 * sorts chronologically instead).
 */

export interface DiscoverRankOpts {
  /** Current time in unix seconds (injected for determinism/testability). */
  now: number;
  /** Engagement score for an event id (>= 0). Reuse computeEngagementScore. */
  getEngagement: (id: string) => number;
  /**
   * Network/trust proximity for an author, 0..1 (follow ≈ 1, follow-of-follow
   * ≈ 0.5, WoT-scored > 0, stranger 0). Optional — omit for logged-out guests.
   */
  getProximity?: (pubkey: string) => number;
  /** No more than one post per author within this many consecutive slots. Default 3. */
  diversityWindow?: number;
  /**
   * Hard burst cap (For You path only): keep at most this many posts per
   * author in the ranked window — overflow is DROPPED, not deferred. The
   * diversity pass above only reorders, so a spam account posting 30 times
   * still landed all 30 in the feed, just spaced out; the cap removes them.
   * Off when undefined.
   */
  maxPerAuthor?: number;
  /** Authors exempt from maxPerAuthor (e.g. the user's follows). */
  capExempt?: (pubkey: string) => boolean;
}

interface RankableEvent {
  id: string;
  pubkey: string;
  created_at: number;
}

/** Recency multiplier: gentle decay so fresh-but-quiet posts still surface. */
function timeDecay(ageSeconds: number): number {
  const ageHours = Math.max(ageSeconds / 3600, 0);
  return 1 / Math.pow(ageHours + 2, 0.6);
}

export function scoreDiscoverEvent<T extends RankableEvent>(event: T, opts: DiscoverRankOpts): number {
  const engagement = Math.max(0, opts.getEngagement(event.id));
  const proximity = opts.getProximity ? Math.max(0, Math.min(1, opts.getProximity(event.pubkey))) : 0;
  const recency = timeDecay(opts.now - event.created_at);
  // (1 + engagement) keeps zero-engagement posts rankable; proximity is a 0.5–1.5
  // multiplier so your network is boosted without erasing global discovery.
  return (1 + engagement) * recency * (0.5 + proximity);
}

/**
 * Rank events into the interesting mix, then enforce author diversity:
 * greedily place the highest-scored event whose author hasn't appeared in the
 * last `diversityWindow` slots; deferred events are reconsidered as the window
 * slides, so diversity alone drops nothing — only reorders. When
 * `maxPerAuthor` is set, a non-exempt author's posts beyond their highest-
 * scored N are DROPPED before the diversity pass (burst cap).
 */
export function rankDiscoverFeed<T extends RankableEvent>(events: T[], opts: DiscoverRankOpts): T[] {
  const window = opts.diversityWindow ?? 3;

  let scored = events
    .map((e) => ({ e, score: scoreDiscoverEvent(e, opts) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.e.created_at !== a.e.created_at) return b.e.created_at - a.e.created_at;
      return a.e.id.localeCompare(b.e.id);
    });

  // Burst cap: already sorted best-first, so the filter keeps each capped
  // author's top-scored `maxPerAuthor` posts and drops the rest outright.
  if (opts.maxPerAuthor !== undefined && opts.maxPerAuthor > 0) {
    const cap = opts.maxPerAuthor;
    const perAuthor = new Map<string, number>();
    scored = scored.filter(({ e }) => {
      if (opts.capExempt && opts.capExempt(e.pubkey)) return true;
      const n = (perAuthor.get(e.pubkey) ?? 0) + 1;
      perAuthor.set(e.pubkey, n);
      return n <= cap;
    });
  }

  if (window <= 1) return scored.map((s) => s.e);

  const out: T[] = [];
  const pending = scored.slice();
  // Track the author of the last `window` placed items.
  const recentAuthors: string[] = [];

  while (pending.length > 0) {
    let placedIdx = -1;
    for (let i = 0; i < pending.length; i++) {
      if (!recentAuthors.includes(pending[i].e.pubkey)) {
        placedIdx = i;
        break;
      }
    }
    // Every remaining candidate shares an author in the window → take the best
    // (highest-scored) one anyway rather than stall.
    if (placedIdx === -1) placedIdx = 0;

    const [picked] = pending.splice(placedIdx, 1);
    out.push(picked.e);
    recentAuthors.push(picked.e.pubkey);
    if (recentAuthors.length > window - 1) recentAuthors.shift();
  }

  return out;
}
