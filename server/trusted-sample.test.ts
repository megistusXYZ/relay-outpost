/**
 * The server takes Discover's broad samples once for everyone and keeps the
 * events by trusted people (articles, events, videos; the Feed tile's notes
 * go through the same reader). A relay or a trusted list we couldn't read is
 * never "nothing was posted".
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { createDiscoverSampleReader, FRESH_MS, RELAY_ANSWER_MS, ROUTE_WAIT_MS } from "./trusted-sample";
import type { RelayQuery } from "./score-cards";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const MALLORY = hex("e");
const article = (id: string, pubkey: string, created_at: number, d = id) =>
  ({ id: hex(id), pubkey, created_at, kind: 30023, tags: [["d", d], ["title", "T" + id]], content: "body", sig: hex("f", 128) });
const R1 = "wss://one.example";
const R2 = "wss://two.example";
/** A relay only the top-people lookups go to (as damus is). */
const TOP = "wss://top.example";

const down = () => ({ reached: false, answered: false, events: [] as any[] });

function setup(opts: {
  answers: Record<string, () => { reached: boolean; answered: boolean; events: any[] }>;
  trusted?: { authors: string[]; reached: boolean };
}) {
  let t = 1_790_000_000_000;
  const query = vi.fn<RelayQuery>(async (relay) => (opts.answers[relay] ?? down)());
  const trusted = vi.fn(async () => opts.trusted ?? { authors: [ALICE], reached: true });
  const reader = createDiscoverSampleReader({ relays: [R1, R2], topRelays: [R1, TOP], query, trusted, now: () => t });
  return { reader, query, trusted, advance: (ms: number) => { t += ms; } };
}
const ok = (...events: any[]) => () => ({ reached: true, answered: true, events });

describe("discover sample reader", () => {
  it("asks the sample relays for the newest from anyone, and the top-lookup relays for the most trusted people's own", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(), [R2]: ok(), [TOP]: ok() } });
    await reader.read("articles");
    const asked = query.mock.calls.map((c) => [c[0], c[1]]);
    const broad = { kinds: [30023], limit: 40 };
    const top = { kinds: [30023], authors: [ALICE], limit: 30 };
    expect(asked).toEqual(expect.arrayContaining([[R1, broad], [R2, broad], [R1, top], [TOP, top]]));
    expect(asked).toHaveLength(4);
  });

  it("the most trusted people's own posts ride along, even when the broad read missed them", async () => {
    const { reader } = setup({
      answers: {
        [R1]: ok(article("2", MALLORY, 300)),
        [R2]: ok(),
        // Only the top-people lookup finds Alice's older article.
        [TOP]: ok(article("9", ALICE, 50)),
      },
    });
    const r = await reader.read("articles");
    expect(r.events.map((e) => e.id)).toEqual([hex("9")]);
  });

  it("images: no broad read at all, only the most trusted people's last day", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(), [R2]: ok(), [TOP]: ok() } });
    await reader.read("images");
    expect(query.mock.calls.map((c) => [c[0], c[1]])).toEqual(expect.arrayContaining([
      [R1, { kinds: [1, 20], authors: [ALICE], since: 1_790_000_000 - 86400, limit: 80 }],
      [TOP, { kinds: [1, 20], authors: [ALICE], since: 1_790_000_000 - 86400, limit: 80 }],
    ]));
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("hands over only trusted people's events, newest first, one copy each", async () => {
    const { reader } = setup({
      answers: {
        [R1]: ok(article("1", ALICE, 100), article("2", MALLORY, 300)),
        [R2]: ok(article("1", ALICE, 100), article("3", ALICE, 200)),
      },
    });
    const r = await reader.read("articles");
    expect(r.reached).toBe(true);
    expect(r.events.map((e) => e.id)).toEqual([hex("3"), hex("1")]);
  });

  it("each sample is its own read and its own cache", async () => {
    const { reader, query, advance } = setup({ answers: { [R1]: ok(article("1", ALICE, 100)), [R2]: ok() } });
    await reader.read("articles");
    advance(FRESH_MS - 1);
    await reader.read("articles");
    expect(query).toHaveBeenCalledTimes(4);
    await reader.read("events");
    expect(query).toHaveBeenCalledTimes(8);
  });

  /**
   * Measured 2026-09-30: damus accepted the connection and never answered a
   * top-people lookup, and snort didn't connect. The read waits for every
   * relay, so with an 11 s allowance one silent relay held the first read
   * past the 6 s the route gives a visitor: everyone got a 503.
   */
  it("gives a relay less time than the route gives a visitor, so one silent relay can't turn a sample into a 503", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(article("1", ALICE, 100)), [R2]: ok(), [TOP]: ok() } });
    await reader.read("articles");
    const allowances = query.mock.calls.map((c) => c[2]);
    expect(allowances.length).toBeGreaterThan(0);
    for (const ms of allowances) expect(ms).toBeLessThanOrEqual(RELAY_ANSWER_MS);
    expect(RELAY_ANSWER_MS).toBeLessThan(ROUTE_WAIT_MS);
    const routes = readFileSync(path.resolve(import.meta.dirname, "routes.ts"), "utf8");
    expect(routes.match(/setTimeout\(\(\) => r\(null\), ROUTE_WAIT_MS\)/g) ?? []).toHaveLength(2); // feed sample + samples
  });

  it("a relay that never answers doesn't keep the others' events back", async () => {
    const { reader } = setup({
      answers: {
        [R1]: ok(article("1", ALICE, 100)),
        // Reached, never answered: what the relay query returns when its time runs out.
        [R2]: () => ({ reached: true, answered: false, events: [] }),
        [TOP]: () => ({ reached: true, answered: false, events: [] }),
      },
    });
    const r = await reader.read("articles");
    expect(r.reached).toBe(true);
    expect(r.events.map((e) => e.id)).toEqual([hex("1")]);
  });

  it("the trusted list couldn't be read: says so, and doesn't sample", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(article("1", ALICE, 100)), [R2]: ok() }, trusted: { authors: [], reached: false } });
    expect(await reader.read("articles")).toEqual({ reached: false, events: [] });
    expect(query).not.toHaveBeenCalled();
  });

  it("no relay answers: says so, never 'nothing was posted'", async () => {
    const { reader } = setup({ answers: { [R1]: down, [R2]: () => { throw new Error("boom"); } } });
    expect(await reader.read("events")).toEqual({ reached: false, events: [] });
  });

  it("relays answered and no trusted person posted: a real empty answer", async () => {
    const { reader } = setup({ answers: { [R1]: ok(article("2", MALLORY, 300)), [R2]: down } });
    expect(await reader.read("articles")).toEqual({ reached: true, events: [] });
  });
});
