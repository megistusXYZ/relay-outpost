/**
 * The server reads the relay monitors so every visitor doesn't have to:
 * a cold Discover load read 6.5 MB from the two monitors for a list the
 * server can hand over in ~25 KB (measured 2026-09-30). One read is shared by
 * everyone, nobody waits on a refresh, and a monitor we couldn't ask is never
 * turned into "the directory is empty".
 */
import { describe, it, expect, vi } from "vitest";
import { createRelayDirectoryReader, FRESH_MS, KEEP_MS, RETRY_MS } from "./relay-directory";
import type { RelayQuery } from "./score-cards";

const A = "wss://monitor-a.example";
const B = "wss://monitor-b.example";
const report = (d: string, created_at = 1, nips: number[] = [1]) =>
  ({ kind: 30166, created_at, tags: [["d", d], ...nips.map((n) => ["N", String(n)])] });

function setup(answers: Record<string, () => { reached: boolean; answered: boolean; events: any[] }>) {
  let t = 1_000_000;
  const query = vi.fn<RelayQuery>(async (relay) => answers[relay]());
  const reader = createRelayDirectoryReader({ monitors: [A, B], query, now: () => t });
  return { reader, query, advance: (ms: number) => { t += ms; } };
}
const ok = (...events: any[]) => () => ({ reached: true, answered: true, events });
const down = () => ({ reached: false, answered: false, events: [] });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("relay directory reader", () => {
  it("asks each monitor for its reports and merges them into one list", async () => {
    const { reader, query } = setup({ [A]: ok(report("wss://one.example")), [B]: ok(report("wss://two.example", 1, [1, 11])) });
    const r = await reader.read();
    expect(r.reached).toBe(true);
    expect(r.relays.map((x) => x.url)).toEqual(["wss://two.example", "wss://one.example"]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual({ kinds: [30166], limit: 2000 });
  });

  it("one read serves everyone for half an hour", async () => {
    const { reader, query, advance } = setup({ [A]: ok(report("wss://one.example")), [B]: ok() });
    await reader.read();
    advance(FRESH_MS - 1);
    await reader.read();
    await reader.read();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("people arriving together share one read", async () => {
    const { reader, query } = setup({ [A]: ok(report("wss://one.example")), [B]: ok() });
    const [x, y] = await Promise.all([reader.read(), reader.read()]);
    expect(x.relays).toHaveLength(1);
    expect(y.relays).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("nobody waits on a refresh: the list in hand is served while a new one is read", async () => {
    const answers = { [A]: ok(report("wss://one.example")), [B]: ok() };
    const { reader, query, advance } = setup(answers);
    await reader.read();
    answers[A] = ok(report("wss://one.example"), report("wss://new.example"));
    advance(FRESH_MS + 1);
    const during = await reader.read();
    expect(during.relays.map((x) => x.url)).toEqual(["wss://one.example"]);
    await flush();
    const after = await reader.read();
    expect(after.relays.map((x) => x.url).sort()).toEqual(["wss://new.example", "wss://one.example"]);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("one monitor down: the other's list still counts", async () => {
    const { reader } = setup({ [A]: down, [B]: ok(report("wss://two.example")) });
    const r = await reader.read();
    expect(r).toMatchObject({ reached: true });
    expect(r.relays).toHaveLength(1);
  });

  it("no monitor answers: says so, and asks again a minute later", async () => {
    const answers = { [A]: down, [B]: down };
    const { reader, query, advance } = setup(answers);
    expect(await reader.read()).toEqual({ reached: false, relays: [] });
    answers[A] = ok(report("wss://one.example"));
    expect(await reader.read()).toEqual({ reached: false, relays: [] });
    advance(RETRY_MS);
    const r = await reader.read();
    expect(r.reached).toBe(true);
    expect(r.relays).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("a monitor that throws is a monitor we couldn't ask", async () => {
    const { reader } = setup({ [A]: () => { throw new Error("boom"); }, [B]: down });
    expect(await reader.read()).toEqual({ reached: false, relays: [] });
  });

  it("a failed refresh keeps the last good list, for a day at most", async () => {
    const answers = { [A]: ok(report("wss://one.example")), [B]: ok() };
    const { reader, advance } = setup(answers);
    await reader.read();
    answers[A] = down; answers[B] = down;
    advance(FRESH_MS + 1);
    await reader.read(); await flush();
    expect((await reader.read()).relays).toHaveLength(1);
    advance(KEEP_MS);
    expect(await reader.read()).toEqual({ reached: false, relays: [] });
  });

  it("a failed refresh isn't retried on every request", async () => {
    const answers = { [A]: ok(report("wss://one.example")), [B]: ok() };
    const { reader, query, advance } = setup(answers);
    await reader.read();
    answers[A] = down; answers[B] = down;
    advance(FRESH_MS + 1);
    await reader.read(); await flush();
    await reader.read(); await flush();
    expect(query).toHaveBeenCalledTimes(4);
    advance(RETRY_MS);
    await reader.read(); await flush();
    expect(query).toHaveBeenCalledTimes(6);
  });

  it("monitors that answer with nothing don't replace a list we have", async () => {
    const answers = { [A]: ok(report("wss://one.example")), [B]: ok() };
    const { reader, advance } = setup(answers);
    await reader.read();
    answers[A] = ok();
    advance(FRESH_MS + 1);
    await reader.read(); await flush();
    expect((await reader.read()).relays).toHaveLength(1);
  });
});
