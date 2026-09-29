/**
 * Discover paints what it showed last time, then refreshes (performance QA,
 * 2026-09-28: Articles, Events and Marketplace took 4-6s and Live ~9s on
 * every visit, repeat visits included). The snapshot is per device and per
 * account: it must never show one account's feed to another, and never show
 * something old enough to mislead.
 */
import { describe, it, expect } from "vitest";
import { saveSnapshot, readSnapshot, SNAPSHOT_MAX_AGE_MS } from "./tile-snapshot";

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const NOW = 1_790_000_000_000;
const posts = [{ id: "p1", content: "hello" }];

describe("tile snapshots", () => {
  it("a saved answer reads back on the next visit", () => {
    const store = memoryStore();
    saveSnapshot(store, "alice", "teaser", posts, NOW);
    expect(readSnapshot(store, "alice", "teaser", NOW + 60_000)).toEqual(posts);
  });

  it("another account on the same device never sees it", () => {
    const store = memoryStore();
    saveSnapshot(store, "alice", "teaser", posts, NOW);
    expect(readSnapshot(store, "bob", "teaser", NOW + 60_000)).toBeNull();
    expect(readSnapshot(store, null, "teaser", NOW + 60_000)).toBeNull();
  });

  it("a visitor's snapshot is kept apart from signed-in ones", () => {
    const store = memoryStore();
    saveSnapshot(store, null, "market", ["listing"], NOW);
    expect(readSnapshot(store, null, "market", NOW + 1_000)).toEqual(["listing"]);
    expect(readSnapshot(store, "alice", "market", NOW + 1_000)).toBeNull();
  });

  it("an answer older than the limit is ignored", () => {
    const store = memoryStore();
    saveSnapshot(store, "alice", "teaser", posts, NOW);
    expect(readSnapshot(store, "alice", "teaser", NOW + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("a newer save replaces the older one", () => {
    const store = memoryStore();
    saveSnapshot(store, "alice", "teaser", posts, NOW);
    saveSnapshot(store, "alice", "teaser", [{ id: "p2", content: "newer" }], NOW + 5_000);
    expect(readSnapshot(store, "alice", "teaser", NOW + 6_000)).toEqual([{ id: "p2", content: "newer" }]);
  });

  it("storage that throws (private mode, full) costs nothing", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(() => saveSnapshot(broken, "alice", "teaser", posts, NOW)).not.toThrow();
    expect(readSnapshot(broken, "alice", "teaser", NOW)).toBeNull();
  });

  it("a corrupt entry reads as nothing", () => {
    const store = memoryStore();
    store.setItem("ro_tile_snap:alice:teaser", "{not json");
    expect(readSnapshot(store, "alice", "teaser", NOW)).toBeNull();
  });
});
