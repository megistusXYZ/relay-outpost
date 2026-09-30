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
 *
 * Once the hourly list read has every card in hand, lookups are answered
 * from that instead (see `fullList`), and the relay is only asked while
 * there is no usable list: the first seconds after a restart, or a list
 * that couldn't be read to the end.
 */
import WebSocket from "ws";
import { rankServicesFromMap, scoresFromCards, ranksFromCards, trustedAuthorsFromRanks, KIND_TRUST_MAP, KIND_SCORE_CARD } from "@shared/nip85";

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
/**
 * How long the full list of scores (kept from the hourly trusted-list read)
 * answers lookups. It is refreshed hourly; past this it has missed several
 * refreshes and lookups go back to asking the relay.
 */
export const FULL_LIST_KEEP_MS = 3 * 60 * 60 * 1000;

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
  /**
   * Every score the lens's services publish, kept from the trusted-list read
   * (155,000 people, ~20 MB, measured 2026-09-30). Lookups are answered from
   * it: asking the relay took 3-5 s for 50 people it hadn't served lately,
   * and the eight lookups of one Discover load, all uncached after a
   * restart, ran past the 6 s timeout. `complete` is whether the read got to
   * the end of every service's cards: only then does a person's absence
   * mean they have no card.
   */
  let fullList: { at: number; ranks: Map<string, number | null>; complete: boolean } | null = null;

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

  /** A person's score from the full list; undefined when the list can't say. */
  function fromFullList(pk: string): number | null | undefined {
    if (!fullList || now() - fullList.at >= FULL_LIST_KEEP_MS) return undefined;
    if (fullList.ranks.has(pk)) return fullList.ranks.get(pk) ?? null;
    return fullList.complete ? null : undefined;
  }

  /**
   * Whether `scores(pubkeys)` would have to ask the relay: someone in it is
   * neither covered by the full list nor remembered from a recent lookup.
   * The per-IP limit counts only these (score-lookup-gate.ts).
   */
  function needsRelay(pubkeys: readonly string[]): boolean {
    return pubkeys.some((pk) => fromFullList(pk) === undefined && !fresh(pk));
  }

  async function scores(pubkeys: readonly string[]): Promise<{ scores: Map<string, number | null>; reached: boolean }> {
    const out = new Map<string, number | null>();
    const need: string[] = [];
    for (const pk of new Set(pubkeys)) {
      const listed = fromFullList(pk);
      if (listed !== undefined) { out.set(pk, listed); continue; }
      const hit = fresh(pk);
      if (hit) out.set(pk, hit.score);
      else need.push(pk);
    }
    if (need.length === 0) return { scores: out, reached: true };

    // Right after a restart the list is still being read (8 s measured) while
    // these relay lookups run. Whoever the relay didn't answer about in time
    // is filled in from the list if it arrived meanwhile.
    const fillFromList = (): boolean => {
      let filled = false;
      for (const pk of need) {
        if (out.has(pk)) continue;
        const listed = fromFullList(pk);
        if (listed !== undefined) { out.set(pk, listed); filled = true; }
      }
      return filled;
    };

    const list = await lensServices();
    if (list.length === 0) return { scores: out, reached: fillFromList() };
    const byRelay = new Map<string, string[]>();
    for (const s of list) {
      const relay = s.relay ?? FALLBACK_CARD_RELAY;
      byRelay.set(relay, [...(byRelay.get(relay) ?? []), s.service]);
    }
    const order = list.map((s) => s.service);

    // Chunks are asked at the same time: a request may carry 200 people, and
    // one after another two cold relay answers (3-5 s each, measured) would
    // outlast the app's 8 s wait.
    const chunks: string[][] = [];
    for (let i = 0; i < need.length; i += CHUNK) chunks.push(need.slice(i, i + CHUNK));
    let reached = false;
    await Promise.all(chunks.map(async (chunk) => {
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
    }));
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
    if (fillFromList()) reached = true;
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
    // Whether every service's cards were read to the end.
    let complete = true;
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
      let ended = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        // Newest first. A read can stop mid-second (measured: ~23k cards,
        // with 20k+ sharing one second), so the page's oldest second is read
        // again on its own and the next page starts before it.
        const a = await query(relay, { ...base, ...(until !== undefined ? { until } : {}) }, LIST_READ_MS);
        if (a.reached) reached = true;
        keep(a.events);
        if (a.events.length === 0) { ended = a.answered; break; }
        const oldest = Math.min(...a.events.map((e) => e.created_at ?? 0));
        const bucket = await query(relay, { ...base, since: oldest, until: oldest }, LIST_READ_MS);
        keep(bucket.events);
        if (!bucket.answered) complete = false;
        if (a.answered && a.events.length < pageSize) { ended = true; break; }
        until = oldest - 1;
      }
      if (!ended) complete = false;
    }
    if (!reached) return { authors: [], reached: false };
    const ranks = ranksFromCards(cards, list.map((s) => s.service));
    const authors = trustedAuthorsFromRanks(ranks, minRank);
    trusted.set(minRank, { at: now(), authors });
    fullList = { at: now(), ranks, complete };
    return { authors, reached: true };
  }

  return { scores, needsRelay, trustedAuthors };
}
