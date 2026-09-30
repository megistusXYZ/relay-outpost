/**
 * "Did ANY of these relays serve us?" is answered by the first yes. The
 * Discover tiles asked with Promise.all, which waits for every relay's check:
 * measured 2026-09-30, Events and Videos had their posts in ~1 s and then
 * sat until ~8.3 s, when the slowest relay's check finally failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { anyOf } from "./any-of";

const after = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const failAfter = (ms: number) => new Promise<boolean>((_, j) => setTimeout(() => j(new Error("x")), ms));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function timed(p: Promise<boolean>) {
  const start = Date.now();
  let v: boolean | undefined, at = -1;
  p.then((x) => { v = x; at = Date.now() - start; });
  while (at < 0 && Date.now() - start < 20_000) await vi.advanceTimersByTimeAsync(50);
  return { v, at };
}

describe("anyOf", () => {
  it("answers yes at the first yes, not when the slowest check ends", async () => {
    const r = await timed(anyOf([after(8000, false), after(300, true), after(5000, true)]));
    expect(r.v).toBe(true);
    expect(r.at).toBeLessThanOrEqual(350);
  });

  it("answers no only once every check has said no (or failed)", async () => {
    const r = await timed(anyOf([after(200, false), failAfter(400), after(900, false)]));
    expect(r.v).toBe(false);
    expect(r.at).toBeGreaterThanOrEqual(900);
  });

  it("no checks: no", async () => {
    expect(await anyOf([])).toBe(false);
  });
});
