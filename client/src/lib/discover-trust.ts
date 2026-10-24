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
/**
 * Your own network leads (owner, 2026-10-23): from this many follows on, the
 * people your follows follow come first, then the lens's trusted list.
 */
export const FOF_MIN_FOLLOWS = 10;
/** Followed by at least this many of your follows, so one follow's whole list doesn't flood in. */
const FOF_MIN_SHARED = 2;
/** At most this many of them lead. */
const FOF_TOP = 150;
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

type TrustOpts = {
  follows: ReadonlySet<string>;
  wotEnabled: boolean;
  ownScores: ReadonlyMap<string, number> | null;
  /** How many of your follows follow each person (use-follows-of-follows), on your device. */
  fof?: ReadonlyMap<string, number>;
};

/** Your follows' follows, most shared first: who leads Discover, or [] when the blend doesn't apply. */
export function fofLeaders(opts: TrustOpts): Array<[string, number]> {
  if (chooseDiscoverLens(opts) !== "default" || !opts.fof || opts.follows.size < FOF_MIN_FOLLOWS) return [];
  return [...opts.fof]
    .filter(([pk, n]) => n >= FOF_MIN_SHARED && !opts.follows.has(pk))
    .sort((a, b) => b[1] - a[1])
    .slice(0, FOF_TOP);
}

/** Memo/snapshot key: answers from different lenses, or with and without the blend, never mix. */
export function discoverLensKey(opts: TrustOpts): string {
  return `trusted:${chooseDiscoverLens(opts)}${fofLeaders(opts).length > 0 ? "+fof" : ""}`;
}

export interface DiscoverTrust {
  /** Whether we could find out who's trusted at all. */
  reached: boolean;
  /** The most trusted people, highest first: tiles fetch content by them. */
  top: string[];
  /** Scores for the candidates asked about (and, own lens, everyone scored). */
  scores: Map<string, number>;
  /**
   * Candidates whose score couldn't be read (the lookup failed, was rate
   * limited, or left them out). Not the same as having no score: the server
   * answers -1 for a person with no score card. Nobody here is admitted, so
   * a tile left empty while this is non-empty hasn't earned "quiet"
   * (see `emptyIsUnproven`).
   */
  unscored: Set<string>;
  lens: "own" | "default";
}

/**
 * An empty tile may only say "quiet" when everyone in its pool could be
 * checked. If some couldn't, the honest answer is "couldn't reach" (with
 * Retry): measured 2026-09-30, a rate-limited score lookup emptied the Feed
 * tile and it said "Quiet right now" over a busy network.
 */
export function emptyIsUnproven(trust: Pick<DiscoverTrust, "unscored">): boolean {
  return trust.unscored.size > 0;
}

export interface DiscoverTrustDeps {
  /** The default lens's top list, or null when it couldn't be read. */
  fetchTop: () => Promise<string[] | null>;
  /** Default-lens scores (0-1) for these people; absent = no score. */
  fetchScores: (pubkeys: string[]) => Promise<Map<string, number>>;
}

export async function loadDiscoverTrust(
  candidates: readonly string[],
  opts: TrustOpts & {
    /**
     * People our server already checked against the default lens's trusted
     * list (the Feed tile's sample, server/feed-sample.ts). Not asked about
     * again; admitted. Ignored under the viewer's own lens.
     */
    vetted?: ReadonlySet<string>;
  },
  deps: DiscoverTrustDeps = defaultDeps,
): Promise<DiscoverTrust> {
  const lens = chooseDiscoverLens(opts);
  if (lens === "own" && opts.ownScores) {
    return { reached: true, top: highlyTrusted(opts.ownScores).slice(0, TOP_SIZE), scores: new Map(opts.ownScores), unscored: new Set(), lens };
  }
  const top = await deps.fetchTop().catch(() => null);
  if (!top) return { reached: false, top: [], scores: new Map(), unscored: new Set(), lens };
  const unique = [...new Set(candidates)].filter((pk) => !opts.follows.has(pk) && !opts.vetted?.has(pk));
  const scores = unique.length > 0 ? await deps.fetchScores(unique).catch(() => new Map<string, number>()) : new Map<string, number>();
  // Everyone on the top list is trusted by definition, even if not asked about.
  for (const pk of top) if (!scores.has(pk)) scores.set(pk, DISCOVER_MIN_SCORE);
  // So is everyone the server vetted: it used the same list these scores come from.
  for (const pk of opts.vetted ?? []) if (!scores.has(pk)) scores.set(pk, DISCOVER_MIN_SCORE);
  // Your follows' follows lead: admitted, and trusted like the people you
  // follow (1, the top of the 0-1 scale the ranker weighs with freshness),
  // and first in `top`, most shared first, so their posts are fetched first.
  const leaders = fofLeaders(opts);
  for (const [pk] of leaders) scores.set(pk, 1);
  const led = new Set(leaders.map(([pk]) => pk));
  const blendedTop = leaders.length > 0 ? [...leaders.map(([pk]) => pk), ...top.filter((pk) => !led.has(pk))] : top;
  // Whoever is still without an entry was never answered about: the server
  // sends a number for everyone it could check (-1 = no score card).
  const unscored = new Set(unique.filter((pk) => !scores.has(pk)));
  return { reached: true, top: blendedTop, scores, unscored, lens };
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
