// Guards the cross-device NEWS BOOKMARK merge. Bookmarks merge ADDITIVELY
// (union by link) with explicit tombstones for deletes: an empty/missing/
// corrupted remote must NEVER wipe local bookmarks (same footgun class as the
// follow-list wipe), while a delete on device A must still remove on device B.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// news-bookmark-sync.ts keeps its top-level imports pure (type-only) and
// lazy-imports the heavy relay graph inside its async I/O helpers (same
// structure as read-state-sync.ts), so the merge/scan/trim logic here imports
// with NO mocking.
import {
  mergeNewsBookmarks,
  mergeTombstones,
  scanLocalChanges,
  trimForPublish,
  isNewsBookmarkDoc,
  bookmarkOrderKey,
  createCoalescedScheduler,
  readLocalBookmarks,
  readLocalTombstones,
  hasAnyNewsBookmarkData,
  MAX_BOOKMARKS,
  MAX_TOMBSTONES,
  MAX_PAYLOAD_BYTES,
  MASS_DELETE_GUARD,
  NEWS_BOOKMARKS_STORAGE_KEY,
  type NewsBookmark,
  type BookmarkTombstone,
  type BookmarkShadow,
} from "./news-bookmark-sync";

// Deterministic localStorage (node env has none).
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
  key: (i: number) => Array.from(__store.keys())[i] ?? null,
  get length() { return __store.size; },
});

const NOW = 1_800_000_000_000; // fixed ms epoch for determinism

function bm(link: string, partial: Partial<NewsBookmark> = {}): NewsBookmark {
  return {
    link,
    title: `Title for ${link}`,
    description: `Description for ${link}`,
    fullContent: "",
    pubDate: new Date(NOW - 86_400_000).toISOString(),
    author: "author",
    categories: [],
    thumbnail: "",
    comments: "",
    ...partial,
  };
}

function ts(link: string, deletedAt: number): BookmarkTombstone {
  return { link, deletedAt };
}

beforeEach(() => {
  __store.clear();
});

// ---------------------------------------------------------------------------

describe("mergeNewsBookmarks — union by link", () => {
  it("unions distinct links from both sides", () => {
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 100 })],
      [bm("b", { savedAt: 200 })],
      [],
    );
    expect(out.map((b) => b.link).sort()).toEqual(["a", "b"]);
  });

  it("dedupes a shared link to ONE entry, newer savedAt wins", () => {
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 100, title: "local older" })],
      [bm("a", { savedAt: 500, title: "remote newer" })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("remote newer");
  });

  it("local wins a savedAt tie (and when both are unstamped)", () => {
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 300, title: "local" })],
      [bm("a", { savedAt: 300, title: "remote" })],
      [],
    );
    expect(out[0].title).toBe("local");
  });

  it("sorts newest-first by savedAt with pubDate fallback", () => {
    const out = mergeNewsBookmarks(
      [bm("old", { savedAt: 100 }), bm("new", { savedAt: 900 })],
      [bm("mid", { savedAt: 500 })],
      [],
    );
    expect(out.map((b) => b.link)).toEqual(["new", "mid", "old"]);
  });
});

describe("mergeNewsBookmarks — never-empty guard", () => {
  it("empty remote array keeps every local bookmark", () => {
    const local = [bm("a", { savedAt: 1 }), bm("b", { savedAt: 2 })];
    const out = mergeNewsBookmarks(local, [], []);
    expect(out.map((b) => b.link).sort()).toEqual(["a", "b"]);
  });

  it("null/undefined remote keeps every local bookmark", () => {
    const local = [bm("a", { savedAt: 1 })];
    expect(mergeNewsBookmarks(local, null, [])).toHaveLength(1);
    expect(mergeNewsBookmarks(local, undefined, [])).toHaveLength(1);
  });

  it("is idempotent — merging the result again changes nothing", () => {
    const local = [bm("a", { savedAt: 100 })];
    const remote = [bm("a", { savedAt: 50 }), bm("b", { savedAt: 200 })];
    const once = mergeNewsBookmarks(local, remote, []);
    const twice = mergeNewsBookmarks(once, remote, []);
    expect(twice).toEqual(once);
  });
});

describe("mergeNewsBookmarks — local wipe hydrates from remote", () => {
  it("empty local ([]) comes back as exactly the remote list", () => {
    const remote = [bm("a", { savedAt: 300 }), bm("b", { savedAt: 100 })];
    const out = mergeNewsBookmarks([], remote, []);
    expect(out.map((b) => b.link)).toEqual(["a", "b"]);
  });
});

describe("mergeNewsBookmarks — tombstones (cross-device delete)", () => {
  it("a tombstone newer than the save removes the item everywhere", () => {
    // Device B holds the item (saved at 100); device A deleted it at 500.
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 100 })],
      [bm("a", { savedAt: 100 })],
      [ts("a", 500)],
    );
    expect(out).toHaveLength(0);
  });

  it("a re-save NEWER than the tombstone survives (deliberate re-bookmark)", () => {
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 900 })],
      [],
      [ts("a", 500)],
    );
    expect(out.map((b) => b.link)).toEqual(["a"]);
  });

  it("tombstones only affect their own link", () => {
    const out = mergeNewsBookmarks(
      [bm("a", { savedAt: 100 }), bm("b", { savedAt: 100 })],
      [],
      [ts("a", 500)],
    );
    expect(out.map((b) => b.link)).toEqual(["b"]);
  });
});

describe("mergeTombstones — union + cap", () => {
  it("unions by link, newest deletedAt wins", () => {
    const out = mergeTombstones([ts("a", 100), ts("b", 300)], [ts("a", 500)]);
    expect(out.find((t) => t.link === "a")?.deletedAt).toBe(500);
    expect(out.find((t) => t.link === "b")?.deletedAt).toBe(300);
  });

  it(`caps at ${MAX_TOMBSTONES}, keeping the NEWEST deletes`, () => {
    const many = Array.from({ length: 150 }, (_, i) => ts(`link-${i}`, i));
    const out = mergeTombstones(many, []);
    expect(out).toHaveLength(MAX_TOMBSTONES);
    // Newest (highest deletedAt) kept; oldest dropped.
    expect(out[0].deletedAt).toBe(149);
    expect(out.every((t) => t.deletedAt >= 150 - MAX_TOMBSTONES)).toBe(true);
  });

  it("tolerates junk entries", () => {
    const junk = [null, {}, { link: "", deletedAt: 1 }, { link: "ok" }] as unknown as BookmarkTombstone[];
    const out = mergeTombstones(junk, [ts("a", 100)]);
    expect(out).toEqual([ts("a", 100)]);
  });
});

// ---------------------------------------------------------------------------

describe("scanLocalChanges — stamping and delete detection", () => {
  it("stamps unstamped NEW items with now (newest-first order preserved)", () => {
    const res = scanLocalChanges([bm("new2"), bm("new1")], {}, [], NOW);
    expect(res.changed).toBe(true);
    expect(res.bookmarks[0].savedAt).toBe(NOW);       // array head = newest
    expect(res.bookmarks[1].savedAt).toBe(NOW - 1);
    expect(res.shadow).toEqual({ new2: NOW, new1: NOW - 1 });
  });

  it("RESTORES a clobbered stamp from the shadow instead of re-stamping", () => {
    // RSSFeed rewrote the key from a pre-stamp React copy: the item persists
    // but lost its savedAt. Re-stamping at `now` would beat older remote
    // tombstones and resurrect cross-device deletes.
    const shadow: BookmarkShadow = { a: 12345 };
    const res = scanLocalChanges([bm("a")], shadow, [], NOW);
    expect(res.bookmarks[0].savedAt).toBe(12345);
  });

  it("mints a tombstone for a link that disappeared since the last scan", () => {
    const res = scanLocalChanges([bm("keep", { savedAt: 1 })], { keep: 1, gone: 2 }, [], NOW);
    expect(res.changed).toBe(true);
    expect(res.tombstones).toEqual([ts("gone", NOW)]);
  });

  it("drops a tombstone when the link was re-saved after the delete", () => {
    const res = scanLocalChanges([bm("a", { savedAt: 900 })], { a: 900 }, [ts("a", 500)], NOW);
    expect(res.tombstones).toEqual([]);
  });

  it("keeps a tombstone that is NEWER than the item's save (item is doomed)", () => {
    const res = scanLocalChanges([bm("a", { savedAt: 100 })], { a: 100 }, [ts("a", 500)], NOW);
    expect(res.tombstones).toEqual([ts("a", 500)]);
  });

  it(`mass-disappearance (> ${MASS_DELETE_GUARD} links) mints NO tombstones (clobber guard)`, () => {
    const shadow: BookmarkShadow = {};
    for (let i = 0; i < MASS_DELETE_GUARD + 5; i++) shadow[`gone-${i}`] = 100 + i;
    const res = scanLocalChanges([], shadow, [], NOW);
    expect(res.tombstones).toEqual([]);
    expect(res.shadow).toEqual({});
  });

  it("a clean re-scan of an unchanged stamped list reports changed=false", () => {
    const first = scanLocalChanges([bm("a")], {}, [], NOW);
    const second = scanLocalChanges(first.bookmarks, first.shadow, first.tombstones, NOW + 10_000);
    expect(second.changed).toBe(false);
  });
});

describe("device A deletes → device B removes (full round-trip)", () => {
  it("propagates a single delete without touching other bookmarks", () => {
    // Both devices in sync with two bookmarks.
    const synced = [bm("keep", { savedAt: 100 }), bm("dead", { savedAt: 100 })];
    const shadow: BookmarkShadow = { keep: 100, dead: 100 };

    // Device A: user deletes "dead"; scan mints the tombstone; doc published.
    const scanA = scanLocalChanges([synced[0]], shadow, [], NOW);
    expect(scanA.tombstones).toEqual([ts("dead", NOW)]);
    const publishedBookmarks = trimForPublish(scanA.bookmarks);
    const publishedTombstones = scanA.tombstones;

    // Device B hydrates that doc.
    const tombstonesB = mergeTombstones([], publishedTombstones);
    const scanB = scanLocalChanges(synced, shadow, tombstonesB, NOW + 1000);
    const mergedB = mergeNewsBookmarks(scanB.bookmarks, publishedBookmarks, scanB.tombstones);
    expect(mergedB.map((b) => b.link)).toEqual(["keep"]);
  });
});

// ---------------------------------------------------------------------------

describe("trimForPublish — payload caps", () => {
  it(`caps at ${MAX_BOOKMARKS} items, dropping the OLDEST`, () => {
    // Lean items so the byte budget is NOT the binding cap here.
    const many = Array.from({ length: 250 }, (_, i): NewsBookmark => ({ link: `l-${i}`, savedAt: i + 1 }));
    const out = trimForPublish(many);
    expect(out).toHaveLength(MAX_BOOKMARKS);
    expect(out[0].link).toBe("l-249"); // newest first
    expect(out.every((b) => (b.savedAt ?? 0) > 250 - MAX_BOOKMARKS)).toBe(true);
  });

  it("trims descriptions and drops extracted article HTML for the wire", () => {
    const out = trimForPublish([
      bm("a", { savedAt: 1, description: "x".repeat(2000), fullContent: "<html>huge</html>" }),
    ]);
    expect(out[0].description!.length).toBe(300);
    expect(out[0].fullContent).toBe("");
  });

  it(`enforces the ~${Math.round(MAX_PAYLOAD_BYTES / 1000)}KB serialized budget by dropping oldest`, () => {
    // 200 items × ~300-char descriptions exceeds the byte budget on their own.
    const many = Array.from({ length: 200 }, (_, i) =>
      bm(`https://example.com/article-${i}`, { savedAt: i + 1, description: "d".repeat(400) }),
    );
    const out = trimForPublish(many);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].link).toBe("https://example.com/article-199"); // newest kept
  });
});

// ---------------------------------------------------------------------------

describe("isNewsBookmarkDoc — corrupted remote tolerated", () => {
  it("accepts a well-formed doc", () => {
    expect(isNewsBookmarkDoc({ version: 1, lastModified: 1, bookmarks: [], tombstones: [] })).toBe(true);
  });

  it("rejects junk (treated as no-remote → local untouched)", () => {
    expect(isNewsBookmarkDoc(null)).toBe(false);
    expect(isNewsBookmarkDoc("garbage")).toBe(false);
    expect(isNewsBookmarkDoc({})).toBe(false);
    expect(isNewsBookmarkDoc({ version: 1, lastModified: 1, bookmarks: {}, tombstones: [] })).toBe(false);
    expect(isNewsBookmarkDoc({ version: 1, lastModified: 1, bookmarks: [] })).toBe(false);
  });

  it("junk ITEMS inside a valid doc are filtered by the merge", () => {
    const junkItems = [null, 42, { title: "no link" }, { link: "" }] as unknown as NewsBookmark[];
    const out = mergeNewsBookmarks([bm("a", { savedAt: 1 })], junkItems, []);
    expect(out.map((b) => b.link)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------

describe("localStorage readers — resilient to corruption", () => {
  it("reads back valid bookmarks and reports data present", () => {
    localStorage.setItem(NEWS_BOOKMARKS_STORAGE_KEY, JSON.stringify([bm("a")]));
    expect(readLocalBookmarks().map((b) => b.link)).toEqual(["a"]);
    expect(hasAnyNewsBookmarkData()).toBe(true);
  });

  it("empty/corrupted storage yields [] and NO publishable data (never-clobber guard)", () => {
    expect(readLocalBookmarks()).toEqual([]);
    expect(readLocalTombstones()).toEqual([]);
    expect(hasAnyNewsBookmarkData()).toBe(false);
    localStorage.setItem(NEWS_BOOKMARKS_STORAGE_KEY, "{not json");
    expect(readLocalBookmarks()).toEqual([]);
    expect(hasAnyNewsBookmarkData()).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("createCoalescedScheduler — debounce coalesces", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("many rapid schedules produce exactly ONE call after the delay", () => {
    const fn = vi.fn();
    const s = createCoalescedScheduler(fn, 4000);
    for (let i = 0; i < 10; i++) {
      s.schedule();
      vi.advanceTimersByTime(200); // keep re-arming inside the window
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1); // no trailing extra call
  });

  it("flush() fires a pending call immediately (visibility→hidden) and only once", () => {
    const fn = vi.fn();
    const s = createCoalescedScheduler(fn, 4000);
    s.schedule();
    s.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush()/cancel() with nothing pending is a no-op", () => {
    const fn = vi.fn();
    const s = createCoalescedScheduler(fn, 4000);
    s.flush();
    s.cancel();
    expect(fn).not.toHaveBeenCalled();
    expect(s.pending()).toBe(false);
  });

  it("cancel() stops a pending call", () => {
    const fn = vi.fn();
    const s = createCoalescedScheduler(fn, 4000);
    s.schedule();
    s.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("bookmarkOrderKey — ordering fallbacks", () => {
  it("prefers savedAt, falls back to pubDate, then 0", () => {
    expect(bookmarkOrderKey(bm("a", { savedAt: 123 }))).toBe(123);
    const withDate = bm("b");
    delete (withDate as Partial<NewsBookmark>).savedAt;
    expect(bookmarkOrderKey(withDate)).toBe(new Date(withDate.pubDate!).getTime());
    expect(bookmarkOrderKey({ link: "c" })).toBe(0);
    expect(bookmarkOrderKey({ link: "d", pubDate: "not a date" })).toBe(0);
  });
});
