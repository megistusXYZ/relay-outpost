/**
 * Discover shows only highly trusted people (owner call, 2026-09-29).
 *
 * - The bar is a score of 0.50+ (rank 50+ on a score card), plus anyone the
 *   viewer follows. Discover is the front door, so this is strict on purpose:
 *   no score means not shown here (elsewhere, no score means unknown).
 * - Whose trust: the viewer's own once it covers at least 100 highly trusted
 *   people (web of trust on); otherwise the default lens (npub1healthsx3…),
 *   read by our server from its score cards.
 * - If the trusted list can't be read, tiles say so and show nothing
 *   unvetted: `reached: false` and an empty `top`.
 */

export const DISCOVER_MIN_SCORE = 0.5;
export const OWN_LENS_MIN_PEOPLE = 100;
const TOP_SIZE = 300;

export interface DiscoverTrustContext {
  follows: ReadonlySet<string>;
  scores: ReadonlyMap<string, number>;
}

/** The tile author gate: followed, or trusted at 0.50+. */
export function admitToDiscover(author: string, ctx: DiscoverTrustContext): boolean {
  if (ctx.follows.has(author)) return true;
  const s = ctx.scores.get(author);
  return typeof s === "number" && s >= DISCOVER_MIN_SCORE;
}

export function gateByTrust<T>(items: readonly T[], authorOf: (item: T) => string, ctx: DiscoverTrustContext): T[] {
  return items.filter((item) => admitToDiscover(authorOf(item), ctx));
}

function highlyTrusted(scores: ReadonlyMap<string, number>): string[] {
  return [...scores]
    .filter(([, s]) => s >= DISCOVER_MIN_SCORE)
    .sort((a, b) => b[1] - a[1])
    .map(([pk]) => pk);
}

export function chooseDiscoverLens(opts: { wotEnabled: boolean; ownScores: ReadonlyMap<string, number> | null }): "own" | "default" {
  if (!opts.wotEnabled || !opts.ownScores) return "default";
  return highlyTrusted(opts.ownScores).length >= OWN_LENS_MIN_PEOPLE ? "own" : "default";
}

export interface DiscoverTrust {
  /** Whether we could find out who's trusted at all. */
  reached: boolean;
  /** The most trusted people, highest first: tiles fetch content by them. */
  top: string[];
  /** Scores for the candidates asked about (and, own lens, everyone scored). */
  scores: Map<string, number>;
  lens: "own" | "default";
}

export interface DiscoverTrustDeps {
  /** The default lens's top list, or null when it couldn't be read. */
  fetchTop: () => Promise<string[] | null>;
  /** Default-lens scores (0-1) for these people; absent = no score. */
  fetchScores: (pubkeys: string[]) => Promise<Map<string, number>>;
}

export async function loadDiscoverTrust(
  candidates: readonly string[],
  opts: { follows: ReadonlySet<string>; wotEnabled: boolean; ownScores: ReadonlyMap<string, number> | null },
  deps: DiscoverTrustDeps = defaultDeps,
): Promise<DiscoverTrust> {
  const lens = chooseDiscoverLens(opts);
  if (lens === "own" && opts.ownScores) {
    return { reached: true, top: highlyTrusted(opts.ownScores).slice(0, TOP_SIZE), scores: new Map(opts.ownScores), lens };
  }
  const top = await deps.fetchTop().catch(() => null);
  if (!top) return { reached: false, top: [], scores: new Map(), lens };
  const unique = [...new Set(candidates)].filter((pk) => !opts.follows.has(pk));
  const scores = unique.length > 0 ? await deps.fetchScores(unique).catch(() => new Map<string, number>()) : new Map<string, number>();
  // Everyone on the top list is trusted by definition, even if not asked about.
  for (const pk of top) if (!scores.has(pk)) scores.set(pk, DISCOVER_MIN_SCORE);
  return { reached: true, top, scores, lens };
}

const defaultDeps: DiscoverTrustDeps = {
  fetchTop: async () => {
    const res = await fetch("/api/discover/trusted-authors", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { authors?: string[] };
    return Array.isArray(data.authors) ? data.authors : null;
  },
  fetchScores: async (pubkeys) => {
    const { fetchBrainstormWotBatch } = await import("./brainstorm-search");
    return fetchBrainstormWotBatch(pubkeys);
  },
};
