/**
 * "People to follow" ranking for the Discover strip (DISCOVER_BENTO_PLAN.md
 * round 2, decisions 15–16). Pure: the component fetches the pools, this
 * decides who appears and in what order.
 *
 * TWO POOLS, STRICT PRECEDENCE. Friends-of-follows — people followed by
 * several of the viewer's own follows — rank first, by that count. It is the
 * one signal a global trending list cannot fake and no other client shows a
 * small community's members about each other. Trending fills whatever is left.
 *
 * THE FLOOR RUNS HERE, BEFORE RENDER. Both pools pass the flagged set at rank
 * time: a trending pool is Primal-fed and can absolutely contain accounts the
 * viewer's shield would hide, and a recommendation card is the single worst
 * surface to leak one onto — it is the app *vouching* to a newcomer.
 */

export interface PersonCandidate {
  pubkey: string;
  source: "network" | "trending";
  /** How many of the viewer's follows follow them — the card's "why". */
  followedByCount?: number;
}

/**
 * One follower-in-common is noise (everyone follows somebody); two is a
 * pattern worth surfacing above a curated global list.
 */
const MIN_NETWORK_OVERLAP = 2;

export function rankPeopleToFollow(opts: {
  viewer: string | null;
  /** The viewer's own follows — never recommended back to them. */
  followSet: Set<string>;
  /** pubkey → how many of the viewer's follows follow them. */
  networkCounts: Map<string, number>;
  /** Fallback pool, already in its own order (curation preserved). */
  trending: string[];
  flagged: Set<string>;
  limit?: number;
}): PersonCandidate[] {
  const { viewer, followSet, networkCounts, trending, flagged, limit = 6 } = opts;

  const excluded = (pubkey: string) =>
    pubkey === viewer || followSet.has(pubkey) || flagged.has(pubkey);

  const network: PersonCandidate[] = [...networkCounts.entries()]
    .filter(([pubkey, count]) => count >= MIN_NETWORK_OVERLAP && !excluded(pubkey))
    .sort((a, b) => b[1] - a[1])
    .map(([pubkey, count]) => ({ pubkey, source: "network" as const, followedByCount: count }));

  const seen = new Set(network.map((c) => c.pubkey));
  const fallback: PersonCandidate[] = trending
    .filter((pubkey) => !excluded(pubkey) && !seen.has(pubkey))
    .map((pubkey) => ({ pubkey, source: "trending" as const }));

  return [...network, ...fallback].slice(0, limit);
}
