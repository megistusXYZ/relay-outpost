/**
 * The server takes the Feed tile's recent sample once for everyone and keeps
 * the notes by trusted people. Measured 2026-09-30, per visitor: 0.6-3 MB per
 * relay and 3-7 score lookups, for about 40 notes that could be shown.
 * A relay or a trusted list we couldn't read is never "nobody posted".
 */
import { describe, it, expect, vi } from "vitest";
import { createFeedSampleReader, FRESH_MS } from "./feed-sample";
import type { RelayQuery } from "./score-cards";

const hex = (c: string, n = 64) => c.repeat(n);
const ALICE = hex("a");
const MALLORY = hex("e");
const note = (id: string, pubkey: string, created_at: number) =>
  ({ id: hex(id), pubkey, created_at, kind: 1, tags: [], content: "gm", sig: hex("f", 128) });
const R1 = "wss://one.example";
const R2 = "wss://two.example";

function setup(opts: {
  answers: Record<string, () => { reached: boolean; answered: boolean; events: any[] }>;
  trusted?: { authors: string[]; reached: boolean };
}) {
  let t = 1_790_000_000_000;
  const query = vi.fn<RelayQuery>(async (relay) => opts.answers[relay]());
  const trusted = vi.fn(async () => opts.trusted ?? { authors: [ALICE], reached: true });
  const reader = createFeedSampleReader({ relays: [R1, R2], query, trusted, now: () => t });
  return { reader, query, trusted, advance: (ms: number) => { t += ms; } };
}
const ok = (...events: any[]) => () => ({ reached: true, answered: true, events });
const down = () => ({ reached: false, answered: false, events: [] });

describe("feed sample reader", () => {
  it("asks each relay for the newest notes of the last six hours", async () => {
    const { reader, query } = setup({ answers: { [R1]: ok(), [R2]: ok() } });
    await reader.read();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual({ kinds: [1], since: 1_790_000_000 - 6 * 3600, limit: 300 });
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
    expect(query).toHaveBeenCalledTimes(2);
  });
});
