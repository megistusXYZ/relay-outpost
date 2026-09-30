/**
 * The server takes the Feed tile's recent sample once for everyone and keeps
 * the notes by trusted people. Measured 2026-09-30, per visitor: 0.6-3 MB per
 * relay and 3-7 score lookups, for about 40 notes that could be shown.
 * A relay or a trusted list we couldn't read is never "nobody posted".
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createFeedSampleReader, ranksForNotes, FRESH_MS } from "./feed-sample";
import type { RelayQuery } from "./score-cards";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const MALLORY = hex("e");
const note = (id: string, pubkey: string, created_at: number) =>
  ({ id: hex(id), pubkey, created_at, kind: 1, tags: [], content: "gm", sig: hex("f", 128) });
const R1 = "wss://one.example";
const R2 = "wss://two.example";
/** A relay only the top-people lookup goes to. */
const TOP = "wss://top.example";

const down = () => ({ reached: false, answered: false, events: [] as any[] });

function setup(opts: {
  answers: Record<string, () => { reached: boolean; answered: boolean; events: any[] }>;
  trusted?: { authors: string[]; reached: boolean };
}) {
  let t = 1_790_000_000_000;
  const query = vi.fn<RelayQuery>(async (relay) => (opts.answers[relay] ?? down)());
  const trusted = vi.fn(async () => opts.trusted ?? { authors: [ALICE], reached: true });
  const reader = createFeedSampleReader({ relays: [R1, R2], topRelays: [TOP], query, trusted, now: () => t });
  return { reader, query, trusted, advance: (ms: number) => { t += ms; } };
}
const ok = (...events: any[]) => () => ({ reached: true, answered: true, events });

describe("feed sample reader", () => {
  it("asks each relay for the newest notes of the last six hours", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(), [R2]: ok() } });
    await reader.read();
    const asked = query.mock.calls.map((c) => [c[0], c[1]]);
    const broad = { kinds: [1], since: 1_790_000_000 - 6 * 3600, limit: 300 };
    expect(asked).toEqual(expect.arrayContaining([[R1, broad], [R2, broad]]));
  });

  it("also asks, once, for the most trusted people's last day, and hands it over with the sample", async () => {
    const { reader, query } = setup({
      answers: { [R1]: ok(note("2", MALLORY, 300)), [R2]: ok(), [TOP]: ok(note("9", ALICE, 50)) },
    });
    const r = await reader.read();
    expect(query.mock.calls.map((c) => [c[0], c[1]])).toContainEqual(
      [TOP, { kinds: [1], authors: [ALICE], since: 1_790_000_000 - 24 * 3600, limit: 150 }],
    );
    expect(query).toHaveBeenCalledTimes(3);
    expect(r.notes.map((e) => e.id)).toEqual([hex("9")]);
  });

  it("hands over only the notes by trusted people, newest first, one copy each", async () => {
    const { reader } = setup({
      answers: {
        [R1]: ok(note("1", ALICE, 100), note("2", MALLORY, 300)),
        [R2]: ok(note("1", ALICE, 100), note("3", ALICE, 200)),
      },
    });
    const r = await reader.read();
    expect(r.reached).toBe(true);
    expect(r.notes.map((e) => e.id)).toEqual([hex("3"), hex("1")]);
  });

  it("the trusted list couldn't be read: says so, and doesn't sample", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(note("1", ALICE, 100)), [R2]: ok() }, trusted: { authors: [], reached: false } });
    expect(await reader.read()).toEqual({ reached: false, notes: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it("no relay answers: says so, never 'nobody posted'", async () => {
    const { reader } = setup({ answers: { [R1]: down, [R2]: () => { throw new Error("boom"); } } });
    expect(await reader.read()).toEqual({ reached: false, notes: [] });
  });

  it("relays answered and no trusted person posted: a real empty answer", async () => {
    const { reader } = setup({ answers: { [R1]: ok(note("2", MALLORY, 300)), [R2]: down } });
    expect(await reader.read()).toEqual({ reached: true, notes: [] });
  });

  it("one sample serves everyone for a couple of minutes", async () => {
    const { reader, query, advance } = setup({ answers: { [R1]: ok(note("1", ALICE, 100)), [R2]: ok() } });
    await reader.read();
    advance(FRESH_MS - 1);
    await reader.read();
    expect(query).toHaveBeenCalledTimes(3);
  });
});

/**
 * The Feed tile ranks by trust plus freshness (owner, 2026-09-30). The app
 * doesn't look up the authors the server vetted, so the server sends their
 * scores with the notes, from the full list it keeps in memory. It never
 * makes a visitor wait on the score relay for them: without the list, the
 * tile ranks by freshness alone.
 */
describe("trust scores sent with the feed sample", () => {
  const n = (id: string, pubkey: string) => note(id, pubkey, 100);
  const cards = (scores: Record<string, number | null>, inMemory = true) => ({
    needsRelay: vi.fn(() => !inMemory),
    scores: vi.fn(async (pks: readonly string[]) => ({ scores: new Map(pks.filter((p) => p in scores).map((p) => [p, scores[p]] as const)), reached: true })),
  });

  it("gives each author's score, from memory", async () => {
    const c = cards({ [ALICE]: 0.83, [MALLORY]: 0.61 });
    expect(await ranksForNotes([n("1", ALICE), n("2", ALICE), n("3", MALLORY)], c)).toEqual({ [ALICE]: 0.83, [MALLORY]: 0.61 });
    expect(c.scores).toHaveBeenCalledWith([ALICE, MALLORY]);
  });

  it("someone with no score card gets no score, not a made-up one", async () => {
    expect(await ranksForNotes([n("1", ALICE)], cards({ [ALICE]: null }))).toEqual({});
  });

  it("without the list in memory, sends none rather than make the visitor wait on the relay", async () => {
    const c = cards({ [ALICE]: 0.83 }, false);
    expect(await ranksForNotes([n("1", ALICE)], c)).toEqual({});
    expect(c.scores).not.toHaveBeenCalled();
  });

  it("the route sends them with the notes", () => {
    const routes = readFileSync(path.resolve(import.meta.dirname, "routes.ts"), "utf8");
    const route = routes.slice(routes.indexOf('app.get("/api/discover/feed-sample"'), routes.indexOf('app.get("/api/discover/sample/:name"'));
    expect(route).toMatch(/ranks: await ranksForNotes\(result\.notes, scoreCards\)/);
  });
});
