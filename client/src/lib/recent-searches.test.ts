import { describe, it, expect, beforeEach, vi } from "vitest";

// vitest runs in the node environment — stub a Map-backed localStorage so the
// guarded wrappers exercise their real read/write paths.
const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import {
  pushRecentSearch,
  getRecentSearches,
  recordRecentSearch,
  clearRecentSearches,
  RECENT_SEARCHES_CAP,
  RECENT_SEARCH_MAX_LEN,
} from "./recent-searches";

describe("pushRecentSearch (pure)", () => {
  it("pushes newest first", () => {
    expect(pushRecentSearch(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("normalizes whitespace and ignores empty queries", () => {
    expect(pushRecentSearch([], "  hello   world  ")).toEqual(["hello world"]);
    expect(pushRecentSearch(["a"], "   ")).toEqual(["a"]);
    expect(pushRecentSearch(["a"], "")).toEqual(["a"]);
  });

  it("dedupes case-insensitively, keeping the newest casing on top", () => {
    expect(pushRecentSearch(["nostr", "zaps"], "Nostr")).toEqual(["Nostr", "zaps"]);
  });

  it("caps at RECENT_SEARCHES_CAP", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_SEARCHES_CAP + 3; i++) list = pushRecentSearch(list, `q${i}`);
    expect(list).toHaveLength(RECENT_SEARCHES_CAP);
    expect(list[0]).toBe(`q${RECENT_SEARCHES_CAP + 2}`);
  });

  it("ignores oversized pasted blobs", () => {
    expect(pushRecentSearch(["a"], "x".repeat(RECENT_SEARCH_MAX_LEN + 1))).toEqual(["a"]);
  });
});

describe("localStorage wrappers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("records and reads per-account, isolated between accounts", () => {
    recordRecentSearch("pk1", "alpha");
    recordRecentSearch("pk1", "beta");
    recordRecentSearch("pk2", "other");
    expect(getRecentSearches("pk1")).toEqual(["beta", "alpha"]);
    expect(getRecentSearches("pk2")).toEqual(["other"]);
  });

  it("clear removes only that account's list", () => {
    recordRecentSearch("pk1", "alpha");
    recordRecentSearch("pk2", "other");
    clearRecentSearches("pk1");
    expect(getRecentSearches("pk1")).toEqual([]);
    expect(getRecentSearches("pk2")).toEqual(["other"]);
  });

  it("survives malformed stored data", () => {
    localStorage.setItem("ro_recent_searches_pk1", "{not json");
    expect(getRecentSearches("pk1")).toEqual([]);
    localStorage.setItem("ro_recent_searches_pk1", JSON.stringify({ nope: 1 }));
    expect(getRecentSearches("pk1")).toEqual([]);
    localStorage.setItem("ro_recent_searches_pk1", JSON.stringify(["ok", 42, "  ", "also"]));
    expect(getRecentSearches("pk1")).toEqual(["ok", "also"]);
  });
});
