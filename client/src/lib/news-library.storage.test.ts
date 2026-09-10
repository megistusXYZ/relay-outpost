/**
 * The start-up side of the News library migration: run once at boot, before
 * anything reads or writes the library, so every reader (News, Discover, the
 * unread badge, the Orbit menu, the stories rail) sees the carried-over
 * library, and no add or remove can land first and make an untouched device
 * look customised.
 *
 * Storage is an in-memory stand-in: the library lives in localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_STARTER_URLS_V1, STARTER_URLS_V2, deriveLibrary, ensureNewsLibraryMigrated, loadLibraryFeeds } from "./news-library";
import { HIDDEN_DEFAULTS_KEY } from "./rss-feeds";

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.items.set(String(key), String(value)); }
  removeItem(key: string) { this.items.delete(String(key)); }
  clear() { this.items.clear(); }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => { vi.unstubAllGlobals(); });

const urls = (feeds: { url: string }[]) => feeds.map((f) => f.url);
const ZEROHEDGE = "https://feeds.feedburner.com/zerohedge/feed";

describe("ensureNewsLibraryMigrated — once, at start-up", () => {
  it("stores a shaped library so every reader sees it exactly as it was", () => {
    storage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify([ZEROHEDGE]));
    const before = urls(deriveLibrary(LEGACY_STARTER_URLS_V1, { custom: [], hidden: new Set([ZEROHEDGE]) }));

    ensureNewsLibraryMigrated();

    expect(urls(loadLibraryFeeds())).toEqual(before);
  });

  it("gives a device nobody customised the new starter", () => {
    ensureNewsLibraryMigrated();
    expect(new Set(urls(loadLibraryFeeds()))).toEqual(new Set(STARTER_URLS_V2));
  });

  it("folds in the oldest saved-feeds key first, so a very old library isn't mistaken for untouched", () => {
    const oldBlog = { name: "Old blog", url: "https://old.example/feed", category: "Custom" };
    const verge = { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Technology" };
    storage.setItem("relay-outpost-rss-feeds", JSON.stringify([oldBlog, verge]));

    ensureNewsLibraryMigrated();

    const after = urls(loadLibraryFeeds());
    expect(after).toContain(oldBlog.url);
    expect(after).toContain(ZEROHEDGE);
    expect(storage.getItem("relay-outpost-rss-feeds")).toBeNull();
  });

  it("runs once: a change made after the carry-over is never undone", () => {
    ensureNewsLibraryMigrated();
    const bbc = "https://feeds.bbci.co.uk/news/world/rss.xml";
    storage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify([bbc]));

    ensureNewsLibraryMigrated();

    expect(urls(loadLibraryFeeds())).not.toContain(bbc);
  });
});
