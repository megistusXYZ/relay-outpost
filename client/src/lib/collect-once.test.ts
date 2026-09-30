/**
 * Discover's one-shot relay lookups. They used to wait until EVERY relay
 * finished, up to the cap: measured 2026-09-29, the signed-in Feed tile took
 * 17.7 s cold, two lookups of ~8 s each held by one slow relay while the
 * others had long answered. Now a lookup settles once it has posts and
 * they've stopped arriving; it never settles early with nothing in hand, so
 * "nothing here" is still only said after the relays answered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { collectOnce, type Subscribe } from "./collect-once";

const ev = (id: string) => ({ id, pubkey: "p", created_at: 1, kind: 1, tags: [], content: "", sig: "" }) as any;

/** A fake relay subscription: a script of events and an EOSE time (or never). */
function fakeRelays(script: { at: number; id: string }[], eoseAt: number | null, relayEose: { relay: string; at: number }[] = []) {
  const closed = vi.fn();
  const subscribe: Subscribe = (_relays, _filter, handlers) => {
    for (const s of script) setTimeout(() => handlers.onevent(ev(s.id)), s.at);
    for (const r of relayEose) setTimeout(() => handlers.onrelayeose?.(r.relay), r.at);
    if (eoseAt !== null) setTimeout(() => handlers.oneose(), eoseAt);
    return { close: closed };
  };
  return { subscribe, closed };
}

async function settleTime(p: Promise<unknown>): Promise<number> {
  const t0 = Date.now();
  let done = false;
  p.then(() => { done = true; });
  while (!done) await vi.advanceTimersByTimeAsync(50);
  return Date.now() - t0;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_790_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("collectOnce", () => {
  it("posts in hand and a relay that never finishes: settles soon after they stop, not at the 8 s cap", async () => {
    const { subscribe, closed } = fakeRelays([{ at: 100, id: "a" }, { at: 250, id: "b" }], null);
    const p = collectOnce(subscribe, ["wss://a", "wss://slow"], {}, 8000);
    const took = await settleTime(p);
    expect(await p).toHaveLength(2);
    expect(took).toBeLessThanOrEqual(1500);
    expect(closed).toHaveBeenCalled();
  });

  it("keeps listening while posts are still arriving", async () => {
    const script = [0, 400, 800, 1200, 1600, 2000].map((at, i) => ({ at, id: `e${i}` }));
    const p = collectOnce(fakeRelays(script, null).subscribe, ["wss://a"], {}, 8000);
    await settleTime(p);
    expect(await p).toHaveLength(6);
  });

  it("with nothing in hand it waits for the relays (or the cap): never a fast false 'empty'", async () => {
    const p = collectOnce(fakeRelays([], null).subscribe, ["wss://slow"], {}, 8000);
    const took = await settleTime(p);
    expect(await p).toEqual([]);
    expect(took).toBeGreaterThanOrEqual(8000);
  });

  it("everyone finished: settles right away, as before", async () => {
    const p = collectOnce(fakeRelays([{ at: 50, id: "a" }], 300).subscribe, ["wss://a"], {}, 8000);
    const took = await settleTime(p);
    expect(await p).toHaveLength(1);
    expect(took).toBeLessThanOrEqual(350);
  });

  it("hands each post to onEvent as it arrives (the page warms its store)", async () => {
    const onEvent = vi.fn();
    const p = collectOnce(fakeRelays([{ at: 10, id: "a" }], 100).subscribe, ["wss://a"], {}, 8000, { onEvent });
    await settleTime(p);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("most relays answered 'nothing' and one is dead: settles on that answer, not the 8 s cap", async () => {
    // Measured 2026-09-30 with relay.primal.net down: the trusted-people
    // lookups for Events, Videos and Articles came back empty from the three
    // healthy relays in under a second, then waited 8 s for the dead one.
    const relays = ["wss://a", "wss://b", "wss://c", "wss://dead"];
    const answered = [{ relay: "wss://a", at: 300 }, { relay: "wss://b", at: 400 }, { relay: "wss://c", at: 500 }];
    const p = collectOnce(fakeRelays([], null, answered).subscribe, relays, {}, 8000);
    const took = await settleTime(p);
    expect(await p).toEqual([]);
    expect(took).toBeLessThanOrEqual(1500);
  });

  it("only one of four answered 'nothing': keeps waiting (not a majority)", async () => {
    const relays = ["wss://a", "wss://b", "wss://c", "wss://d"];
    const p = collectOnce(fakeRelays([], null, [{ relay: "wss://a", at: 300 }]).subscribe, relays, {}, 8000);
    const took = await settleTime(p);
    expect(took).toBeGreaterThanOrEqual(8000);
  });
});
