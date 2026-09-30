/**
 * One read shared by every visitor (the relay directory, the Feed tile's
 * sample). The rules: nobody waits on a refresh, a bad read never replaces a
 * good list, and visitors can't make the server read relays in a loop.
 */
import { describe, it, expect, vi } from "vitest";
import { createSharedRead, type SharedAnswer } from "./shared-read";

function setup(first: SharedAnswer<string>) {
  let t = 0;
  const state = { answer: first };
  const source = vi.fn(async () => state.answer);
  const shared = createSharedRead<string>({ read: source, freshMs: 100, keepMs: 1000, retryMs: 10, now: () => t });
  return { shared, source, state, advance: (ms: number) => { t += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createSharedRead", () => {
  it("one read serves everyone while it's fresh", async () => {
    const { shared, source, advance } = setup({ reached: true, items: ["a"] });
    await shared.read(); advance(99); await shared.read();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("past fresh: the list in hand is served while one new read replaces it", async () => {
    const { shared, source, state, advance } = setup({ reached: true, items: ["a"] });
    await shared.read();
    state.answer = { reached: true, items: ["b"] };
    advance(101);
    expect((await shared.read()).items).toEqual(["a"]);
    await flush();
    expect((await shared.read()).items).toEqual(["b"]);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("a read that fails or finds nothing never replaces a list in hand", async () => {
    const { shared, state, advance } = setup({ reached: true, items: ["a"] });
    await shared.read();
    state.answer = { reached: false, items: [] };
    advance(101); await shared.read(); await flush();
    state.answer = { reached: true, items: [] };
    advance(11); await shared.read(); await flush();
    expect(await shared.read()).toEqual({ reached: true, items: ["a"] });
  });

  it("a list is kept for keepMs at most", async () => {
    const { shared, state, advance } = setup({ reached: true, items: ["a"] });
    await shared.read();
    state.answer = { reached: false, items: [] };
    advance(1000);
    expect(await shared.read()).toEqual({ reached: false, items: [] });
  });

  it("with nothing in hand, a failed read is repeated to later visitors, not re-run for each", async () => {
    const { shared, source, state, advance } = setup({ reached: false, items: [] });
    expect(await shared.read()).toEqual({ reached: false, items: [] });
    state.answer = { reached: true, items: ["a"] };
    expect(await shared.read()).toEqual({ reached: false, items: [] });
    expect(source).toHaveBeenCalledTimes(1);
    advance(10);
    expect(await shared.read()).toEqual({ reached: true, items: ["a"] });
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("a read that throws is a read that didn't reach", async () => {
    let t = 0;
    const shared = createSharedRead<string>({ read: async () => { throw new Error("boom"); }, freshMs: 100, keepMs: 1000, retryMs: 10, now: () => t });
    expect(await shared.read()).toEqual({ reached: false, items: [] });
  });

  it("visitors arriving together share one read", async () => {
    const { shared, source } = setup({ reached: true, items: ["a"] });
    await Promise.all([shared.read(), shared.read(), shared.read()]);
    expect(source).toHaveBeenCalledTimes(1);
  });
});
