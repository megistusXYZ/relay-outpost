/**
 * NIP-85 trust scores, as NosFabrica publishes them (2026-09-28).
 *
 * An observer's kind-10040 trust map names the rank services it trusts, as
 * `["30382:rank", <service hex>, <relay hint>]`, in the observer's order.
 * Each service publishes a kind-30382 score card per person: `d` = the
 * person, `rank` = 0-100 (GrapeRank influence × 100) through that observer's
 * web of trust. The app works in 0-1 influence, so ranks are divided by 100.
 *
 * Pure: the relay reads live in the server (default lens) and the client (a
 * viewer's own map). Shared so both read maps and cards the same way.
 */
import { isJunkRelay } from "./relay-junk";

/** The trust map kind: an observer's delegations to score services. */
export const KIND_TRUST_MAP = 10040;
/** A score card: one service's assertion about one person. */
export const KIND_SCORE_CARD = 30382;

const HEX64 = /^[0-9a-f]{64}$/;

interface NostrEventLike {
  pubkey: string;
  tags: string[][];
}

export interface RankService {
  service: string;
  /** Where the service publishes, or null when the map gave no usable hint. */
  relay: string | null;
}

/** The rank services a trust map delegates to, in the observer's order. */
export function rankServicesFromMap(map: NostrEventLike | null | undefined): RankService[] {
  const out: RankService[] = [];
  const seen = new Set<string>();
  for (const t of map?.tags ?? []) {
    if (t[0] !== "30382:rank" || !HEX64.test(t[1] ?? "") || seen.has(t[1])) continue;
    seen.add(t[1]);
    const hint = t[2] && !isJunkRelay(t[2]) ? t[2] : null;
    out.push({ service: t[1], relay: hint });
  }
  return out;
}

/**
 * Score cards → a score per person, 0-1.
 *
 * - The first-listed service with a card for a person wins.
 * - `answered` is whether every relay asked finished (EOSE). Only then does
 *   "no card" mean something: the person is unranked (null). If a relay never
 *   finished, a missing card says nothing, so the person is left out
 *   (unknown), never reported as unranked.
 */
export function scoresFromCards(
  requested: readonly string[],
  cards: readonly NostrEventLike[],
  services: readonly string[],
  answered: boolean,
): Map<string, number | null> {
  const priority = new Map(services.map((s, i) => [s, i] as const));
  const best = new Map<string, { pri: number; rank: number | null }>();
  for (const c of cards) {
    const pri = priority.get(c.pubkey);
    if (pri === undefined) continue;
    const subject = c.tags.find((t) => t[0] === "d")?.[1];
    if (!subject) continue;
    const raw = c.tags.find((t) => t[0] === "rank")?.[1];
    const n = raw === undefined ? NaN : Number(raw);
    const rank = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) / 100 : null;
    const prev = best.get(subject);
    if (!prev || pri < prev.pri) best.set(subject, { pri, rank });
  }
  const out = new Map<string, number | null>();
  for (const pk of requested) {
    const hit = best.get(pk);
    if (hit) out.set(pk, hit.rank);
    else if (answered) out.set(pk, null);
  }
  return out;
}

/**
 * The people a lens trusts at `minRank` (0-100) and above, highest rank
 * first: Discover's source of authors (owner call, 2026-09-29: only highly
 * trusted people, rank 50+). Same rules as scoresFromCards: the first-listed
 * service decides a person's rank; cards without a usable rank, or from
 * services the lens doesn't list, don't count.
 */
export function trustedAuthorsFromCards(
  cards: readonly NostrEventLike[],
  services: readonly string[],
  minRank: number,
): string[] {
  const subjects = [...new Set(cards.map((c) => c.tags.find((t) => t[0] === "d")?.[1]).filter((d): d is string => !!d))];
  const scores = scoresFromCards(subjects, cards, services, false);
  return [...scores]
    .filter(([, s]) => typeof s === "number" && s * 100 >= minRank)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([pk]) => pk);
}
