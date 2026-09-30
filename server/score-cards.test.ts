/**
 * The server reads the default lens's score cards for everyone who has no
 * trust map of their own (owner decision, 2026-09-28). The rule that matters:
 * a relay we couldn't ask is never turned into "no score" (that is how every
 * author in the app came to read "no data" when the old API died).
 */
import { describe, it, expect, vi } from "vitest";
import { createScoreCardReader, FULL_LIST_KEEP_MS, type RelayQuery } from "./score-cards";

const LENS = "be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a";
const SVC = "78ed0837" + "0".repeat(56);
const JACK = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const NEWBIE = "c".repeat(64);

const lensMap = { kind: 10040, pubkey: LENS, created_at: 1, tags: [["30382:rank", SVC, "wss://scores.brainstorm.world"]] };
const jackCard = { kind: 30382, pubkey: SVC, created_at: 1, tags: [["d", JACK], ["rank", "91"]] };

function relays(opts: { mapAnswered?: boolean; cardsReached?: boolean; cardsAnswered?: boolean } = {}) {
  const { mapAnswered = true, cardsReached = true, cardsAnswered = true } = opts;
  const query: RelayQuery = vi.fn(async (relay, filter) => {
    if (filter.kinds?.[0] === 10040) return { reached: true, answered: mapAnswered, events: mapAnswered ? [lensMap] : [] };
    if (!cardsReached) return { reached: false, answered: false, events: [] };
    return { reached: true, answered: cardsAnswered, events: [jackCard] };
  });
  return query;
}

describe("score card reader (default lens)", () => {
  it("reads the lens's map, then its service's cards: jack 0.91, a newcomer unranked", async () => {
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relays() });
    const r = await reader.scores([JACK, NEWBIE]);
    expect(r.reached).toBe(true);
    expect(r.scores.get(JACK)).toBe(0.91);
    expect(r.scores.get(NEWBIE)).toBeNull();
  });

  it("asks the relay the map names for that service", async () => {
    const query = relays();
    await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query }).scores([JACK]);
    const cardCall = (query as any).mock.calls.find((c: any[]) => c[1].kinds[0] === 30382);
    expect(cardCall[0]).toBe("wss://scores.brainstorm.world");
    expect(cardCall[1]).toMatchObject({ authors: [SVC], "#d": [JACK] });
  });

  it("a card relay we couldn't reach leaves everyone unknown, not unranked", async () => {
    const r = await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relays({ cardsReached: false }) }).scores([JACK, NEWBIE]);
    expect(r.reached).toBe(false);
    expect(r.scores.size).toBe(0);
  });

  it("a relay that stopped mid-answer keeps what arrived and claims nothing else", async () => {
    const r = await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relays({ cardsAnswered: false }) }).scores([JACK, NEWBIE]);
    expect(r.scores.get(JACK)).toBe(0.91);
    expect(r.scores.has(NEWBIE)).toBe(false);
  });

  it("without the lens's map, nothing can be ranked: unknown", async () => {
    const r = await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relays({ mapAnswered: false }) }).scores([JACK]);
    expect(r.reached).toBe(false);
    expect(r.scores.size).toBe(0);
  });

  it("answers from memory the second time instead of asking again", async () => {
    const query = relays();
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    await reader.scores([JACK, NEWBIE]);
    const calls = (query as any).mock.calls.length;
    const again = await reader.scores([JACK, NEWBIE]);
    expect(again.scores.get(JACK)).toBe(0.91);
    expect(again.scores.get(NEWBIE)).toBeNull();
    expect((query as any).mock.calls.length).toBe(calls);
  });
});

describe("reading the lens's map", () => {
  it("uses the first map that arrives instead of waiting for a slow relay", async () => {
    const query: RelayQuery = vi.fn(async (relay, filter) => {
      if (filter.kinds?.[0] === 10040) {
        if (relay === "wss://slow.example") return new Promise(() => {}); // never answers
        return { reached: true, answered: true, events: [lensMap] };
      }
      return { reached: true, answered: true, events: [jackCard] };
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://slow.example", "wss://purplepag.es"], query });
    const r = await Promise.race([
      reader.scores([JACK]),
      new Promise<string>((res) => setTimeout(() => res("waited on the slow relay"), 500)),
    ]);
    expect(typeof r === "string" ? r : r.scores.get(JACK)).toBe(0.91);
  });
});

describe("the lens's trusted authors (Discover)", () => {
  const cardAt = (subject: string, rank: string, at: number) => ({ id: subject + at, kind: 30382, pubkey: SVC, created_at: at, tags: [["d", subject], ["rank", rank]] });
  const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);

  it("lists everyone at the threshold: pages, plus a full read of each page's cut-off second", async () => {
    // Measured on scores.brainstorm.world: a read stops after ~23k cards, and
    // the service stamps 20k+ cards with the same second. So each page's
    // oldest second is read again on its own (since = until = that second),
    // and the next page starts before it.
    const D = "d".repeat(64);
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      if (filter.since !== undefined) return { reached: true, answered: true, events: [cardAt(B, "40", 200), cardAt(D, "80", 200)] };
      if (filter.until === undefined) return { reached: true, answered: false, events: [cardAt(A, "90", 300), cardAt(B, "40", 200)] };
      return { reached: true, answered: true, events: [cardAt(C, "70", 100)] };
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    const r = await reader.trustedAuthors(50);
    expect(r).toEqual({ authors: [A, D, C], reached: true });
    const cardCalls = (query as any).mock.calls.filter((c: any[]) => c[1].kinds[0] === 30382).map((c: any[]) => c[1]);
    expect(cardCalls[1]).toMatchObject({ since: 200, until: 200 });
    expect(cardCalls[2]).toMatchObject({ until: 199 });
  });

  it("a card relay we couldn't reach gives no list, and says so", async () => {
    const query: RelayQuery = vi.fn(async (_relay, filter) =>
      filter.kinds?.[0] === 10040
        ? { reached: true, answered: true, events: [lensMap] }
        : { reached: false, answered: false, events: [] });
    const r = await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query }).trustedAuthors(50);
    expect(r).toEqual({ authors: [], reached: false });
  });

  it("is read once an hour, not per visitor", async () => {
    const query: RelayQuery = vi.fn(async (_relay, filter) =>
      filter.kinds?.[0] === 10040
        ? { reached: true, answered: true, events: [lensMap] }
        : { reached: true, answered: true, events: [cardAt(A, "90", 300)] });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    await reader.trustedAuthors(50);
    const n = (query as any).mock.calls.length;
    await reader.trustedAuthors(50);
    expect((query as any).mock.calls.length).toBe(n);
  });
});

describe("the trusted list stays served while it refreshes", () => {
  const A = "a".repeat(64), B = "b".repeat(64);
  const cardAt = (subject: string, rank: string) => ({ id: subject, kind: 30382, pubkey: SVC, created_at: 1, tags: [["d", subject], ["rank", rank]] });

  it("an hour-old list is served at once while one fresh read replaces it", async () => {
    let t = 0;
    let listRead = 0;
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      if (filter.since === undefined) listRead++;
      // Before the hour the relay holds A; by the refresh it holds B.
      return { reached: true, answered: true, events: [cardAt(t === 0 ? A : B, "90")] };
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query, now: () => t });
    expect((await reader.trustedAuthors(50)).authors).toEqual([A]);
    t = 61 * 60 * 1000;
    const stale = await reader.trustedAuthors(50);
    expect(stale).toEqual({ authors: [A], reached: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((await reader.trustedAuthors(50)).authors).toEqual([B]);
    expect(listRead).toBe(2);
  });
});

/**
 * Measured 2026-09-30: a score lookup the score relay hasn't served lately
 * takes 3-5 s for 50 people, longer with several at once. After a restart
 * our own cache is empty, a Discover load sends about eight at once, and the
 * slowest passed the 6 s timeout: tiles said "Couldn't reach" (or, before
 * #208, "Quiet right now"). The hourly trusted-list read already downloads
 * every card (155,000 people), so lookups are answered from that.
 */
describe("score lookups are answered from the full list the server already reads", () => {
  const A = "a".repeat(64), LOW = "b".repeat(64), NOBODY = "c".repeat(64);
  const card = (subject: string, rank: string, created_at = 300) =>
    ({ id: subject + rank, kind: 30382, pubkey: SVC, created_at, tags: [["d", subject], ["rank", rank]] });

  /** A relay holding A (90) and LOW (20). `listAnswered: false` cuts the list read off. */
  function setup(opts: { listAnswered?: boolean } = {}) {
    let t = 0;
    const lookups: string[][] = [];
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      if (filter["#d"]) {
        lookups.push(filter["#d"]);
        return { reached: true, answered: true, events: [card(A, "90"), card(LOW, "20")].filter((c) => filter["#d"].includes(c.tags[0][1])) };
      }
      return { reached: true, answered: opts.listAnswered ?? true, events: [card(A, "90"), card(LOW, "20")] };
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query, now: () => t });
    return { reader, lookups, advance: (ms: number) => { t += ms; } };
  }

  it("once the list is read, a lookup doesn't ask the relay at all", async () => {
    const { reader, lookups } = setup();
    await reader.trustedAuthors(50);
    const r = await reader.scores([A, LOW, NOBODY]);
    expect(r.reached).toBe(true);
    expect(r.scores.get(A)).toBe(0.9);
    expect(r.scores.get(LOW)).toBe(0.2);
    expect(lookups).toEqual([]);
  });

  it("someone missing from a complete list has no score card: unranked, not unknown", async () => {
    const { reader } = setup();
    await reader.trustedAuthors(50);
    const r = await reader.scores([NOBODY]);
    expect(r.scores.has(NOBODY)).toBe(true);
    expect(r.scores.get(NOBODY)).toBeNull();
  });

  it("a list read that was cut off proves nothing about who's missing: the relay is asked about them", async () => {
    const { reader, lookups } = setup({ listAnswered: false });
    await reader.trustedAuthors(50);
    const r = await reader.scores([A, NOBODY]);
    expect(r.scores.get(A)).toBe(0.9);
    expect(lookups).toEqual([[NOBODY]]);
    expect(r.scores.get(NOBODY)).toBeNull();
  });

  it("before the list is read, lookups ask the relay as they always did", async () => {
    const { reader, lookups } = setup();
    const r = await reader.scores([A]);
    expect(r.scores.get(A)).toBe(0.9);
    expect(lookups).toEqual([[A]]);
  });

  it("right after a restart: what the relay didn't answer in time is filled from the list that arrived meanwhile", async () => {
    let releaseList: () => void = () => {};
    const listGate = new Promise<void>((r) => { releaseList = r; });
    let releaseLookup: () => void = () => {};
    const lookupGate = new Promise<void>((r) => { releaseLookup = r; });
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      // The lookup times out at the relay (reached, never answered).
      if (filter["#d"]) { await lookupGate; return { reached: true, answered: false, events: [] }; }
      await listGate;
      return { reached: true, answered: true, events: [card(A, "90")] };
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    const list = reader.trustedAuthors(50);
    const lookup = reader.scores([A, NOBODY]);
    releaseList();
    await list;
    releaseLookup();
    const r = await lookup;
    expect(r.reached).toBe(true);
    expect(r.scores.get(A)).toBe(0.9);
    expect(r.scores.get(NOBODY)).toBeNull();
  });

  it("and with no list yet, what the relay didn't answer stays unknown (nothing is made up)", async () => {
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      if (filter["#d"]) return { reached: true, answered: false, events: [] };
      return new Promise(() => {}); // a list read that hasn't finished
    });
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    void reader.trustedAuthors(50);
    const r = await reader.scores([A]);
    expect(r.scores.has(A)).toBe(false);
  });

  it("a list that hasn't been refreshed for hours isn't trusted for lookups", async () => {
    const { reader, lookups, advance } = setup();
    await reader.trustedAuthors(50);
    advance(FULL_LIST_KEEP_MS + 1);
    await reader.scores([NOBODY]);
    expect(lookups).toEqual([[NOBODY]]);
  });
});

describe("a large lookup with no list in hand", () => {
  it("asks the relay about its chunks at the same time, not one after another", async () => {
    // One request may carry 200 people (shared/wot-batch.ts). A cold relay
    // answer takes 3-5 s (measured 2026-09-30); two in a row would outlast
    // the app's 8 s wait.
    let inFlight = 0, most = 0;
    const query: RelayQuery = vi.fn(async (_relay, filter) => {
      if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
      inFlight++; most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { reached: true, answered: true, events: [] };
    });
    const people = Array.from({ length: 200 }, (_, i) => i.toString(16).padStart(64, "0"));
    const r = await createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query }).scores(people);
    expect(r.reached).toBe(true);
    expect(r.scores.size).toBe(200);
    expect(most).toBe(2);
  });
});

/**
 * The per-IP limit on score lookups only counts lookups that will ask the
 * relay (score-lookup-gate.ts), so the reader has to say which those are.
 */
describe("whether a lookup needs the relay", () => {
  const A = "a".repeat(64), NOBODY = "c".repeat(64);
  const card = (subject: string, rank: string) => ({ id: subject + rank, kind: 30382, pubkey: SVC, created_at: 300, tags: [["d", subject], ["rank", rank]] });
  const relay = (listAnswered = true): RelayQuery => vi.fn(async (_relay, filter) => {
    if (filter.kinds?.[0] === 10040) return { reached: true, answered: true, events: [lensMap] };
    if (filter["#d"]) return { reached: true, answered: true, events: [card(A, "90")].filter((c) => filter["#d"].includes(c.tags[0][1])) };
    return { reached: true, answered: listAnswered, events: [card(A, "90")] };
  });

  it("with no list in hand, it does", () => {
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relay() });
    expect(reader.needsRelay([A])).toBe(true);
  });

  it("with the full list in hand, it doesn't: not for people on it, not for people missing from it", async () => {
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relay() });
    await reader.trustedAuthors(50);
    expect(reader.needsRelay([A, NOBODY])).toBe(false);
  });

  it("a list that was cut off can't speak for people missing from it", async () => {
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relay(false) });
    await reader.trustedAuthors(50);
    expect(reader.needsRelay([A])).toBe(false);
    expect(reader.needsRelay([A, NOBODY])).toBe(true);
  });

  it("someone just looked up is remembered, so asking again needs no relay", async () => {
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relay() });
    await reader.scores([A, NOBODY]);
    expect(reader.needsRelay([A, NOBODY])).toBe(false);
  });

  it("a list too old to use means the relay again", async () => {
    let t = 0;
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query: relay(), now: () => t });
    await reader.trustedAuthors(50);
    t = FULL_LIST_KEEP_MS + 1;
    expect(reader.needsRelay([NOBODY])).toBe(true);
  });

  it("agrees with what a lookup then does", async () => {
    const query = relay();
    const reader = createScoreCardReader({ lens: LENS, mapRelays: ["wss://purplepag.es"], query });
    await reader.trustedAuthors(50);
    const before = (query as any).mock.calls.length;
    expect(reader.needsRelay([A, NOBODY])).toBe(false);
    await reader.scores([A, NOBODY]);
    expect((query as any).mock.calls.length).toBe(before);
  });
});
