/**
 * Trust scores from NIP-85 score cards, read through one observer's trust map
 * (the default lens: everyone without a map of their own; owner decision,
 * 2026-09-28). Replaces the brainstorm.world scores API, which now serves a
 * web page. See shared/nip85.ts for the map and card formats.
 *
 * Reach-honest: `reached: false` and no entries when the cards couldn't be
 * read; "unranked" (null) only for a person the relay finished answering
 * about. Cached so every visitor shares one read: the lens's services for an
 * hour, scores for 30 minutes, "no card" for 5.
 */
import WebSocket from "ws";
import { rankServicesFromMap, scoresFromCards, trustedAuthorsFromCards, KIND_TRUST_MAP, KIND_SCORE_CARD } from "@shared/nip85";

export interface RelayAnswer {
  /** The socket opened. */
  reached: boolean;
  /** The relay finished answering (EOSE). */
  answered: boolean;
  events: any[];
}
export type RelayQuery = (relay: string, filter: Record<string, any>, timeoutMs?: number) => Promise<RelayAnswer>;

/** One REQ against one relay, with reached and answered kept apart. */
export const queryRelay: RelayQuery = (relay, filter, timeoutMs = 6_000) =>
  new Promise((resolve) => {
    const events: any[] = [];
    let reached = false;
    let settled = false;
    let ws: WebSocket;
    const finish = (answered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve({ reached, answered, events });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch {
      finish(false);
      return;
    }
    const subId = `cards_${Math.random().toString(36).slice(2, 10)}`;
    ws.on("open", () => {
      reached = true;
      ws.send(JSON.stringify(["REQ", subId, filter]));
    });
    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[1] !== subId) return;
        if (msg[0] === "EVENT" && msg[2]) events.push(msg[2]);
        else if (msg[0] === "EOSE") finish(true);
        else if (msg[0] === "CLOSED") finish(false);
      } catch { /* not ours / not JSON */ }
    });
    ws.on("error", () => finish(false));
    ws.on("close", () => finish(false));
  });

const SERVICES_TTL = 60 * 60 * 1000;
const SCORE_TTL = 30 * 60 * 1000;
const UNRANKED_TTL = 5 * 60 * 1000;
const CHUNK = 100;
/** Where cards are read when the map names a service without a usable relay. */
const FALLBACK_CARD_RELAY = "wss://nip85.nosfabrica.com";
const MAX_CACHED = 5_000;

/**
 * One read asks for everything the relay allows (scores.brainstorm.world:
 * max_limit 100,000). Paging by time can't work here: the service publishes
 * in bulk, 5,000+ cards stamped with the same second. Measured: ~14k cards
 * in the first 6s, so the list read gets a long allowance; it runs hourly on
 * the server, never on a visitor's request path once warm.
 */
const DEFAULT_PAGE = 100_000;
const LIST_READ_MS = 45_000;
/** Enough pages for tens of thousands of cards, bounded all the same. */
const MAX_PAGES = 12;
const TRUSTED_TTL = 60 * 60 * 1000;

export function createScoreCardReader(opts: {
  lens: string;
  mapRelays: string[];
  query?: RelayQuery;
  now?: () => number;
  pageSize?: number;
}) {
  const query = opts.query ?? queryRelay;
  const now = opts.now ?? Date.now;
  let services: { at: number; list: ReturnType<typeof rankServicesFromMap> } | null = null;
  const cache = new Map<string, { at: number; score: number | null }>();

  async function lensServices() {
    if (services && now() - services.at < SERVICES_TTL) return services.list;
    // First map to arrive wins: one slow map relay mustn't hold every score
    // for its full timeout (measured: 6.5s on the first request of the hour).
    const map = await new Promise<any>((resolve) => {
      let pending = opts.mapRelays.length;
      if (pending === 0) resolve(null);
      for (const r of opts.mapRelays) {
        query(r, { kinds: [KIND_TRUST_MAP], authors: [opts.lens], limit: 1 })
          .then((a) => {
            const newest = a.events
              .filter((e) => e?.pubkey === opts.lens)
              .sort((x, y) => (y.created_at ?? 0) - (x.created_at ?? 0))[0];
            if (newest) resolve(newest);
          })
          .catch(() => {})
          .finally(() => { if (--pending === 0) resolve(null); });
      }
    });
    const list = rankServicesFromMap(map);
    if (list.length > 0) services = { at: now(), list };
    return list;
  }

  function fresh(pk: string): { score: number | null } | null {
    const hit = cache.get(pk);
    if (!hit) return null;
    const ttl = hit.score === null ? UNRANKED_TTL : SCORE_TTL;
    return now() - hit.at < ttl ? hit : null;
  }

  async function scores(pubkeys: readonly string[]): Promise<{ scores: Map<string, number | null>; reached: boolean }> {
    const out = new Map<string, number | null>();
    const need: string[] = [];
    for (const pk of new Set(pubkeys)) {
      const hit = fresh(pk);
      if (hit) out.set(pk, hit.score);
      else need.push(pk);
    }
    if (need.length === 0) return { scores: out, reached: true };

    const list = await lensServices();
    if (list.length === 0) return { scores: out, reached: false };
    const byRelay = new Map<string, string[]>();
    for (const s of list) {
      const relay = s.relay ?? FALLBACK_CARD_RELAY;
      byRelay.set(relay, [...(byRelay.get(relay) ?? []), s.service]);
    }
    const order = list.map((s) => s.service);

    let reached = false;
    for (let i = 0; i < need.length; i += CHUNK) {
      const chunk = need.slice(i, i + CHUNK);
      const answers = await Promise.all(
        [...byRelay].map(([relay, authors]) =>
          query(relay, { kinds: [KIND_SCORE_CARD], authors, "#d": chunk, limit: chunk.length * authors.length }),
        ),
      );
      if (answers.some((a) => a.reached)) reached = true;
      const answered = answers.every((a) => a.answered);
      const got = scoresFromCards(chunk, answers.flatMap((a) => a.events), order, answered);
      for (const [pk, score] of got) {
        out.set(pk, score);
        cache.set(pk, { at: now(), score });
      }
    }
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    return { scores: out, reached };
  }

  const trusted = new Map<number, { at: number; authors: string[] }>();

  /**
   * Everyone the lens trusts at `minRank` (0-100) and above, highest first:
   * Discover's authors (owner call, 2026-09-29). Every card the lens's
   * services publish, read in pages, once an hour. `reached: false` with no
   * authors when the cards couldn't be read, never an empty "nobody".
   */
  const refreshing = new Map<number, Promise<{ authors: string[]; reached: boolean }>>();

  async function trustedAuthors(minRank: number): Promise<{ authors: string[]; reached: boolean }> {
    const hit = trusted.get(minRank);
    if (hit && now() - hit.at < TRUSTED_TTL) return { authors: hit.authors, reached: true };
    // Older than an hour: keep serving it while ONE fresh read replaces it.
    // Only a server with no list at all makes the caller wait.
    let running = refreshing.get(minRank);
    if (!running) {
      running = readTrusted(minRank).finally(() => refreshing.delete(minRank));
      refreshing.set(minRank, running);
    }
    if (hit) return { authors: hit.authors, reached: true };
    return running;
  }

  async function readTrusted(minRank: number): Promise<{ authors: string[]; reached: boolean }> {
    const list = await lensServices();
    if (list.length === 0) return { authors: [], reached: false };
    const pageSize = opts.pageSize ?? DEFAULT_PAGE;
    const cards: any[] = [];
    const seenIds = new Set<string>();
    let reached = false;
    const keep = (events: any[]) => {
      for (const e of events) {
        if (e?.id && seenIds.has(e.id)) continue;
        if (e?.id) seenIds.add(e.id);
        cards.push(e);
      }
    };
    for (const s of list) {
      const relay = s.relay ?? FALLBACK_CARD_RELAY;
      const base = { kinds: [KIND_SCORE_CARD], authors: [s.service], limit: pageSize };
      let until: number | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        // Newest first. A read can stop mid-second (measured: ~23k cards,
        // with 20k+ sharing one second), so the page's oldest second is read
        // again on its own and the next page starts before it.
        const a = await query(relay, { ...base, ...(until !== undefined ? { until } : {}) }, LIST_READ_MS);
        if (a.reached) reached = true;
        keep(a.events);
        if (a.events.length === 0) break;
        const oldest = Math.min(...a.events.map((e) => e.created_at ?? 0));
        const bucket = await query(relay, { ...base, since: oldest, until: oldest }, LIST_READ_MS);
        keep(bucket.events);
        if (a.answered && a.events.length < pageSize) break;
        until = oldest - 1;
      }
    }
    if (!reached) return { authors: [], reached: false };
    const authors = trustedAuthorsFromCards(cards, list.map((s) => s.service), minRank);
    trusted.set(minRank, { at: now(), authors });
    return { authors, reached: true };
  }

  return { scores, trustedAuthors };
}
