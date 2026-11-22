import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TTLCache } from "./ttl-cache";

describe("TTLCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns a value within its TTL and drops it after", () => {
    const c = new TTLCache<string>(10, 1000);
    c.set("a", "x");
    expect(c.get("a")).toBe("x");
    vi.advanceTimersByTime(1001);
    expect(c.get("a")).toBeUndefined();
  });

  it("honors a per-entry TTL override that outlives the default", () => {
    const c = new TTLCache<string>(10, 1000);
    c.set("news", "n");                 // default 1s
    c.set("podcast", "p", 60_000);      // override 60s
    vi.advanceTimersByTime(2000);
    expect(c.get("news")).toBeUndefined();   // default expired
    expect(c.get("podcast")).toBe("p");      // override still alive
  });

  it("evicts the least-recently-used entry at capacity", () => {
    const c = new TTLCache<number>(2, 60_000);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");           // touch a → b is now LRU
    c.set("c", 3);        // over capacity → evicts b
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });
});

/**
 * A count limit alone doesn't bound memory when entries can be large: the feed
 * cache held up to 256 feeds of up to ~25 MB each. With a byte budget, old
 * entries make room for new ones, and an entry bigger than the per-entry limit
 * is not kept at all.
 */
describe("TTLCache with a byte budget", () => {
  const sizeOf = (s: string) => s.length;

  it("keeps the total under the budget by dropping the oldest", () => {
    const c = new TTLCache<string>(100, 60_000, { maxBytes: 1000, sizeOf });
    for (let i = 0; i < 10; i++) c.set(`k${i}`, "x".repeat(300));
    expect(c.bytes).toBeLessThanOrEqual(1000);
    expect(c.size).toBe(3);
    expect(c.get("k9")).toBeDefined();
    expect(c.get("k0")).toBeUndefined();
  });

  it("does not keep an entry over the per-entry limit, and drops an older copy of it", () => {
    const c = new TTLCache<string>(100, 60_000, { maxBytes: 1000, maxEntryBytes: 400, sizeOf });
    c.set("feed", "x".repeat(100));
    c.set("feed", "x".repeat(500));
    expect(c.get("feed")).toBeUndefined();
    expect(c.bytes).toBe(0);
  });

  it("replacing an entry counts only its new size", () => {
    const c = new TTLCache<string>(100, 60_000, { maxBytes: 1000, sizeOf });
    c.set("a", "x".repeat(600));
    c.set("a", "x".repeat(200));
    expect(c.bytes).toBe(200);
  });

  it("an expired entry gives its bytes back", () => {
    const c = new TTLCache<string>(100, 1, { maxBytes: 1000, sizeOf });
    c.set("a", "x".repeat(600));
    const until = Date.now() + 5;
    while (Date.now() < until) { /* let it expire */ }
    expect(c.get("a")).toBeUndefined();
    expect(c.bytes).toBe(0);
  });

  it("without a budget it behaves as before", () => {
    const c = new TTLCache<string>(2, 60_000);
    c.set("a", "x".repeat(10_000)); c.set("b", "y"); c.set("c", "z");
    expect(c.size).toBe(2);
    expect(c.get("a")).toBeUndefined();
  });
});
