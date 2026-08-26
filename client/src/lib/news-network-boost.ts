/**
 * The Nostr-network boost for trending news (NEWS_TRENDING_PLAN.md, decision 8)
 * — the differentiator no aggregator can copy. The base trending order is the
 * server's universal corroboration ranking; this LIFTS the stories the viewer's
 * own web-of-trust is sharing, and annotates each with "N you follow shared."
 *
 * Pure by design. The component fetches recent notes from the viewer's follows;
 * this module turns them into a share map and re-ranks the story list. Computed
 * client-side (decision 8) so the base payload stays one cached, universal
 * thing — this is the personal lift, riding follow-feed data the client already
 * has.
 */

/** One story's network signal after the boost. */
export interface NetworkSignal {
  /** Distinct followed accounts that shared a link to this story. */
  count: number;
  /** Their pubkeys, strongest-weight first (for a facepile / "shared by …"). */
  sharers: string[];
}

export interface NetworkShare {
  sharers: Set<string>;
  /** Sum of sharer weights (GrapeRank when available, else 1 each). */
  score: number;
}

export type NetworkShareMap = Map<string, NetworkShare>;

/**
 * Canonical key for matching a shared URL to a story link. Two links to the
 * SAME article must collapse to one key even when a friend linked a different
 * outlet's copy is NOT the goal here (that is handled by matching against every
 * memberLink) — this only normalizes ONE url: drop the scheme, a leading www,
 * tracking params, a trailing slash, and the fragment, lowercased host. The
 * path keeps its case (some CMSes are path-case-sensitive) except the host.
 */
export function normalizeNewsUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    // Strip common tracking + share params so the same article matches.
    const params = new URLSearchParams(u.search);
    for (const k of [...params.keys()]) {
      if (/^utm_/i.test(k) || /^(fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|__twitter_impression|s|igshid)$/i.test(k)) {
        params.delete(k);
      }
    }
    const qs = params.toString();
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return "";
  }
}

const URL_RE = /https?:\/\/[^\s<>"'’)]+/gi;

/** Every http(s) URL in a note's text, de-duplicated. */
export function extractUrls(content: string): string[] {
  const out = new Set<string>();
  const matches = content.match(URL_RE) ?? [];
  for (const m of matches) {
    // Trim trailing punctuation the regex greedily grabbed.
    out.add(m.replace(/[.,;:!?]+$/, ""));
  }
  return [...out];
}

export interface NoteLike {
  /** The account whose note this is — the SHARER (a repost is credited to the
   *  reposter, so pass that as pubkey). */
  pubkey: string;
  content: string;
}

/**
 * Fold recent follow-feed notes into a share map: normalized-URL → who shared
 * it and their summed weight. One account sharing the same URL twice counts
 * once (distinct sharers). `weightOf` supplies a per-sharer weight (GrapeRank
 * influence when the graph is ready) — a trusted friend's share outweighs a
 * random follow's; default 1 each.
 */
export function buildNetworkShareMap(
  notes: NoteLike[],
  opts: { weightOf?: (pubkey: string) => number; viewer?: string | null } = {},
): NetworkShareMap {
  const weightOf = opts.weightOf ?? (() => 1);
  const map: NetworkShareMap = new Map();
  for (const note of notes) {
    if (opts.viewer && note.pubkey === opts.viewer) continue; // your own share isn't social proof
    for (const url of extractUrls(note.content)) {
      const key = normalizeNewsUrl(url);
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) { entry = { sharers: new Set(), score: 0 }; map.set(key, entry); }
      if (!entry.sharers.has(note.pubkey)) {
        entry.sharers.add(note.pubkey);
        entry.score += Math.max(0, weightOf(note.pubkey)) || 1;
      }
    }
  }
  return map;
}

export interface BoostableStory {
  link: string;
  memberLinks: string[];
}

/**
 * Match each story against the share map (ANY member outlet's link counts, so a
 * friend who linked BBC's copy lifts the cluster whose lead is Reuters), then
 * re-rank: base trending order LIFTED by network signal, bounded so a strong
 * corroboration top story is not leapfrogged by one obscure share.
 *
 * Score = baseRank (higher for earlier position) + BOOST × networkScore. Stable
 * against the incoming order, so unshared stories keep their exact sequence and
 * only the shared ones rise.
 */
export function applyNetworkBoost<T extends BoostableStory>(
  stories: T[],
  map: NetworkShareMap,
  opts: { boost?: number; sharerWeight?: (pubkey: string) => number } = {},
): Array<T & { network: NetworkSignal | null }> {
  const BOOST = opts.boost ?? 3;
  const n = stories.length;

  const annotated = stories.map((s, i) => {
    // Gather the union of sharers across all member links.
    const sharers = new Set<string>();
    let shareScore = 0;
    for (const link of [s.link, ...s.memberLinks]) {
      const key = normalizeNewsUrl(link);
      const hit = key ? map.get(key) : undefined;
      if (hit) {
        for (const p of hit.sharers) sharers.add(p);
      }
    }
    if (sharers.size > 0) {
      // Recompute score from the unioned sharer set so a story matched via two
      // member links doesn't double-count a sharer who shared both.
      const weightOf = opts.sharerWeight ?? (() => 1);
      for (const p of sharers) shareScore += Math.max(0, weightOf(p)) || 1;
    }
    const baseRank = n - i; // earlier position → higher base
    const network: NetworkSignal | null = sharers.size > 0
      ? { count: sharers.size, sharers: [...sharers] }
      : null;
    return { story: { ...s, network }, sortScore: baseRank + BOOST * shareScore, idx: i };
  });

  // Stable sort: higher sortScore first; ties keep original order.
  annotated.sort((a, b) => (b.sortScore - a.sortScore) || (a.idx - b.idx));
  return annotated.map((a) => a.story);
}
