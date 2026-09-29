/**
 * Score cards through the viewer's OWN trust map (kind 10040), read in the
 * browser (owner decision, 2026-09-28). Most viewers have no map yet (this
 * app doesn't publish one), and for them this returns nothing: their scores
 * come from personal GrapeRank and, for strangers, the server's default lens.
 *
 * The browser can't tell a relay that finished answering from one that went
 * quiet (querySync), so only cards that ARRIVED count here; a missing card
 * is never turned into "unranked".
 */
import { rankServicesFromMap, scoresFromCards, KIND_TRUST_MAP, KIND_SCORE_CARD, type RankService } from "@shared/nip85";

/** General relays where people publish their replaceable lists. */
const MAP_RELAYS = ["wss://purplepag.es", "wss://relay.damus.io", "wss://nos.lol"];
/** Where cards are read when a map names a service without a usable relay. */
const FALLBACK_CARD_RELAY = "wss://nip85.nosfabrica.com";
const MAP_TTL = 60 * 60 * 1000;

const maps = new Map<string, { at: number; services: RankService[] }>();
const inFlight = new Map<string, Promise<RankService[]>>();

/** The rank services the observer's own trust map names ([] if none). */
export function ownRankServices(observer: string): Promise<RankService[]> {
  const hit = maps.get(observer);
  if (hit && Date.now() - hit.at < MAP_TTL) return Promise.resolve(hit.services);
  const running = inFlight.get(observer);
  if (running) return running;
  const read = (async () => {
    const { pool } = await import("./nostr");
    const events = await pool.querySync(MAP_RELAYS, { kinds: [KIND_TRUST_MAP], authors: [observer], limit: 1 }, { maxWait: 4_000 });
    const newest = events.filter((e) => e.pubkey === observer).sort((a, b) => b.created_at - a.created_at)[0];
    const services = rankServicesFromMap(newest);
    maps.set(observer, { at: Date.now(), services });
    return services;
  })().finally(() => inFlight.delete(observer));
  inFlight.set(observer, read);
  return read;
}

/**
 * Scores (0-1) for the people whose cards arrived from the observer's own
 * services. People with no card, or when the observer has no map, are simply
 * absent: this says nothing about them.
 */
export async function ownMapScores(observer: string, pubkeys: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (pubkeys.length === 0) return out;
  const services = await ownRankServices(observer).catch(() => [] as RankService[]);
  if (services.length === 0) return out;
  const { pool } = await import("./nostr");
  const byRelay = new Map<string, string[]>();
  for (const s of services) {
    const relay = s.relay ?? FALLBACK_CARD_RELAY;
    byRelay.set(relay, [...(byRelay.get(relay) ?? []), s.service]);
  }
  const unique = Array.from(new Set(pubkeys));
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const cards = (await Promise.all(
      [...byRelay].map(([relay, authors]) =>
        pool.querySync([relay], { kinds: [KIND_SCORE_CARD], authors, "#d": chunk, limit: chunk.length * authors.length }, { maxWait: 4_000 })
          .catch(() => []),
      ),
    )).flat();
    const got = scoresFromCards(chunk, cards, services.map((s) => s.service), false);
    for (const [pk, score] of got) if (typeof score === "number") out.set(pk, score);
  }
  return out;
}
