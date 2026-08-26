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
