import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordFirstSeen,
  recordEventsFirstSeen,
  getFirstSeen,
  __resetFirstSeenForTests,
  __firstSeenSizeForTests,
} from "./account-age";

const NOW = 1_700_000_000;

beforeEach(() => {
  __resetFirstSeenForTests();
});

describe("getFirstSeen", () => {
  it("returns null for a pubkey the ledger has never seen (callers fail open)", () => {
    expect(getFirstSeen("never_seen")).toBeNull();
  });

  it("returns the recorded timestamp after evidence lands", () => {
    recordFirstSeen("pk1", NOW - 100, NOW);
    expect(getFirstSeen("pk1")).toBe(NOW - 100);
  });
});

describe("recordFirstSeen — keeps the MINIMUM evidence", () => {
  it("older evidence lowers the value", () => {
    recordFirstSeen("pk_min", NOW - 100, NOW);
    recordFirstSeen("pk_min", NOW - 5000, NOW);
    expect(getFirstSeen("pk_min")).toBe(NOW - 5000);
  });

  it("newer evidence never raises the value", () => {
    recordFirstSeen("pk_keep", NOW - 5000, NOW);
    recordFirstSeen("pk_keep", NOW - 10, NOW);
    expect(getFirstSeen("pk_keep")).toBe(NOW - 5000);
  });

  it("clamps future-dated timestamps to now (spam can't be perpetually new)", () => {
    recordFirstSeen("pk_future", NOW + 999_999, NOW);
    expect(getFirstSeen("pk_future")).toBe(NOW);
  });

  it("ignores nonsense input (zero, negative, NaN, empty pubkey)", () => {
    recordFirstSeen("pk_zero", 0, NOW);
    recordFirstSeen("pk_neg", -5, NOW);
    recordFirstSeen("pk_nan", Number.NaN, NOW);
    recordFirstSeen("", NOW - 100, NOW);
    expect(getFirstSeen("pk_zero")).toBeNull();
    expect(getFirstSeen("pk_neg")).toBeNull();
    expect(getFirstSeen("pk_nan")).toBeNull();
    expect(__firstSeenSizeForTests()).toBe(0);
  });
});

describe("recordEventsFirstSeen — the feed-flush batch chokepoint", () => {
  it("records min created_at per pubkey across a batch", () => {
    recordEventsFirstSeen(
      [
        { pubkey: "a", created_at: NOW - 10 },
        { pubkey: "b", created_at: NOW - 20 },
        { pubkey: "a", created_at: NOW - 300 },
      ],
      NOW
    );
    expect(getFirstSeen("a")).toBe(NOW - 300);
    expect(getFirstSeen("b")).toBe(NOW - 20);
  });

  it("tolerates holes in the batch", () => {
    recordEventsFirstSeen([{ pubkey: "ok", created_at: NOW - 1 }, null as any, undefined as any], NOW);
    expect(getFirstSeen("ok")).toBe(NOW - 1);
  });
});

describe("LRU cap — the ledger cannot grow unbounded", () => {
  it("caps at 2000 entries, evicting the least-recently-touched first", () => {
    for (let i = 0; i < 2001; i++) {
      recordFirstSeen(`pk_${i}`, NOW - 100, NOW);
    }
    expect(__firstSeenSizeForTests()).toBe(2000);
    // pk_0 was inserted first and never touched again → evicted.
    expect(getFirstSeen("pk_0")).toBeNull();
    expect(getFirstSeen("pk_2000")).toBe(NOW - 100);
  });

  it("re-touching a key refreshes its LRU position", () => {
    for (let i = 0; i < 2000; i++) {
      recordFirstSeen(`lru_${i}`, NOW - 100, NOW);
    }
    // Touch the oldest key, then overflow by one — lru_1 (now oldest) evicts.
    recordFirstSeen("lru_0", NOW - 50, NOW);
    recordFirstSeen("lru_overflow", NOW - 100, NOW);
    expect(getFirstSeen("lru_0")).toBe(NOW - 100); // min kept, entry alive
    expect(getFirstSeen("lru_1")).toBeNull();
  });
});

describe("persistence is guarded (node has no localStorage)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recording without localStorage does not throw, even when the persist timer fires", () => {
    vi.useFakeTimers();
    expect(() => {
      recordFirstSeen("no_storage_pk", NOW - 10, NOW);
      vi.runAllTimers();
    }).not.toThrow();
    expect(getFirstSeen("no_storage_pk")).toBe(NOW - 10);
  });

  it("writes a capped JSON map to localStorage when available (debounced)", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
    vi.useFakeTimers();
    recordFirstSeen("persist_pk", NOW - 10, NOW);
    vi.runAllTimers();
    const raw = store.get("relay-outpost-first-seen");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ persist_pk: NOW - 10 });
  });

  it("a throwing setItem (iOS private mode / quota) is swallowed", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    });
    vi.useFakeTimers();
    expect(() => {
      recordFirstSeen("quota_pk", NOW - 10, NOW);
      vi.runAllTimers();
    }).not.toThrow();
    expect(getFirstSeen("quota_pk")).toBe(NOW - 10);
  });
});
