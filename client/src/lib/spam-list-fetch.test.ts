/**
 * The shared spam list is asked for again only after a while, when it fails.
 *
 * Measured on production 2026-10-04: spam.nostr.band no longer answers; each
 * ask held a connection open for its 8 s timeout, and a failure wasn't
 * remembered, so every screen that mounted the spam filter asked again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

describe("the shared spam list", () => {
  it("after a failed ask, the next screens don't ask again straight away", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchSpamList } = await import("./spam-filter");
    await fetchSpamList();
    await fetchSpamList();
    await fetchSpamList();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a host that doesn't answer is given up on in a few seconds, not eight", async () => {
    vi.useFakeTimers();
    let aborted = -1;
    const start = Date.now();
    vi.stubGlobal("fetch", (_u: string, init: { signal: AbortSignal }) => new Promise((_r, reject) => {
      init.signal.addEventListener("abort", () => { aborted = Date.now() - start; reject(new Error("aborted")); });
    }));
    const { fetchSpamList } = await import("./spam-filter");
    const p = fetchSpamList();
    await vi.advanceTimersByTimeAsync(8000);
    await p;
    expect(aborted).toBeGreaterThan(0);
    expect(aborted).toBeLessThanOrEqual(4000);
  });

  it("it's asked again once the wait is over", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchSpamList } = await import("./spam-filter");
    await fetchSpamList();
    vi.advanceTimersByTime(31 * 60 * 1000);
    await fetchSpamList();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
