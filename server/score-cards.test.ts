/**
 * The server reads the default lens's score cards for everyone who has no
 * trust map of their own (owner decision, 2026-09-28). The rule that matters:
 * a relay we couldn't ask is never turned into "no score" (that is how every
 * author in the app came to read "no data" when the old API died).
 */
import { describe, it, expect, vi } from "vitest";
import { createScoreCardReader, type RelayQuery } from "./score-cards";

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
