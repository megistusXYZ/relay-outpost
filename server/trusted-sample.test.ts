/**
 * The server takes Discover's broad samples once for everyone and keeps the
 * events by trusted people (articles, events, videos; the Feed tile's notes
 * go through the same reader). A relay or a trusted list we couldn't read is
 * never "nothing was posted".
 */
import { describe, it, expect, vi } from "vitest";
import { createDiscoverSampleReader, FRESH_MS } from "./trusted-sample";
import type { RelayQuery } from "./score-cards";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const MALLORY = hex("e");
const article = (id: string, pubkey: string, created_at: number, d = id) =>
  ({ id: hex(id), pubkey, created_at, kind: 30023, tags: [["d", d], ["title", "T" + id]], content: "body", sig: hex("f", 128) });
const R1 = "wss://one.example";
const R2 = "wss://two.example";

function setup(opts: {
  answers: Record<string, () => { reached: boolean; answered: boolean; events: any[] }>;
  trusted?: { authors: string[]; reached: boolean };
}) {
  let t = 1_790_000_000_000;
  const query = vi.fn<RelayQuery>(async (relay) => opts.answers[relay]());
  const trusted = vi.fn(async () => opts.trusted ?? { authors: [ALICE], reached: true });
  const reader = createDiscoverSampleReader({ relays: [R1, R2], query, trusted, now: () => t });
  return { reader, query, trusted, advance: (ms: number) => { t += ms; } };
}
const ok = (...events: any[]) => () => ({ reached: true, answered: true, events });
const down = () => ({ reached: false, answered: false, events: [] });

describe("discover sample reader", () => {
  it("asks each relay for the sample's kinds and limit", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(), [R2]: ok() } });
    await reader.read("articles");
    expect(query.mock.calls.map((c) => c[1])).toEqual([{ kinds: [30023], limit: 40 }, { kinds: [30023], limit: 40 }]);
    await reader.read("videos");
    expect(query.mock.calls[2][1]).toEqual({ kinds: [21, 22, 34235, 34236], limit: 20 });
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
    expect(query).toHaveBeenCalledTimes(2);
    await reader.read("events");
    expect(query).toHaveBeenCalledTimes(4);
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
