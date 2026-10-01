/**
 * Paging a relay's catalog backwards in time (the Marketplace).
 *
 * Measured 2026-10-01: the page stopped at 30 pages (3,000 listings) and the
 * 30th page was still full; paging on from a browser reached 6,000 listings,
 * back to May, before the relay stopped answering. Everything older than the
 * first 3,000 could not be reached at all.
 */
import { describe, it, expect, vi } from "vitest";
import { newCursor, pageOlder, olderNotShown } from "./catalog-pager";

const ev = (id: string, created_at: number) => ({ id, created_at });
/** A relay holding events at times 1000, 999, 998 … answering `per` a page. */
function relay(total: number, per: number) {
  const all = Array.from({ length: total }, (_, i) => ev("e" + i, 1000 - i));
  return vi.fn(async (until: number) => ({ events: all.filter((e) => e.created_at <= until).slice(0, per), answered: true }));
}

describe("pageOlder", () => {
  it("walks back page by page and stops at the page limit, remembering where it got to", async () => {
    const fetchPage = relay(50, 10);
    const cursor = newCursor(2000);
    const first = await pageOlder(fetchPage, cursor, 3);
    expect(first.fresh).toHaveLength(30);
    expect(cursor.dry).toBe(false);
    // The next call carries on from there: nothing asked twice, nothing skipped.
    const second = await pageOlder(fetchPage, cursor, 3);
    expect(second.fresh.map((e) => e.id)).toEqual(Array.from({ length: 20 }, (_, i) => "e" + (30 + i)));
  });

  it("knows the catalog has run dry when the relay ANSWERS with nothing new", async () => {
    const fetchPage = relay(15, 10);
    const cursor = newCursor(2000);
    const r = await pageOlder(fetchPage, cursor, 10);
    expect(r.fresh).toHaveLength(15);
    expect(cursor.dry).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3); // two pages with listings, one empty answer
  });

  it("a page that never answered is not the end of the catalog: it stops, and can be tried again", async () => {
    let calls = 0;
    const fetchPage = vi.fn(async (until: number) => (++calls === 2 ? { events: [], answered: false } : { events: [ev("a" + calls, until - 1)], answered: true }));
    const cursor = newCursor(2000);
    const r = await pageOlder(fetchPage, cursor, 10);
    expect(r.fresh).toHaveLength(1);
    expect(r.stalled).toBe(true);
    expect(cursor.dry).toBe(false);
    const again = await pageOlder(fetchPage, cursor, 1);
    expect(again.fresh).toHaveLength(1); // carried on
  });

  it("events that did arrive on an unanswered page are kept", async () => {
    const fetchPage = vi.fn(async (until: number) => ({ events: [ev("late", until - 5)], answered: false }));
    const r = await pageOlder(fetchPage, newCursor(2000), 1);
    expect(r.fresh.map((e) => e.id)).toEqual(["late"]);
    expect(r.answeredAny).toBe(true);
  });

  it("reports each page as it lands, and stops when told to (the reader left)", async () => {
    const fetchPage = relay(100, 10);
    const seen: number[] = [];
    let stop = false;
    const r = await pageOlder(fetchPage, newCursor(2000), 10, { onPage: (fresh) => { seen.push(fresh.length); if (seen.length === 2) stop = true; }, shouldStop: () => stop });
    expect(seen).toEqual([10, 10]);
    expect(r.fresh).toHaveLength(20);
  });

  it("the same event served twice is counted once", async () => {
    const page = [ev("x", 900), ev("y", 899)];
    let n = 0;
    const fetchPage = vi.fn(async () => (n++ < 2 ? { events: page, answered: true } : { events: [], answered: true }));
    const cursor = newCursor(2000);
    const r = await pageOlder(fetchPage, cursor, 5);
    expect(r.fresh).toHaveLength(2);
    expect(cursor.dry).toBe(true);
  });
});

describe("olderNotShown — a later batch never repeats a listing already on the shelf", () => {
  const l = (pubkey: string, dTag: string) => ({ pubkey, dTag });
  it("drops listings whose address is already shown (an older edition of the same listing)", () => {
    const shown = [[l("a", "1"), l("a", "2")], [l("b", "1")]];
    expect(olderNotShown([l("a", "1"), l("b", "1"), l("c", "9")], shown)).toEqual([l("c", "9")]);
  });
  it("keeps everything when nothing is shown yet", () => {
    expect(olderNotShown([l("a", "1")], [])).toEqual([l("a", "1")]);
  });
});

describe("the Marketplace uses it", () => {
  it("opens with a batch, appends older ones under what is shown, and never auto-walks the catalog while filtering", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const page = readFileSync(path.resolve(import.meta.dirname, "../pages/Marketplace.tsx"), "utf8");
    expect(page).toMatch(/await pageOlder\(fetchPage, cursor, OPENING_PAGES,/);
    expect(page).toMatch(/const batch = olderNotShown\(assemble\(res\.fresh\), shownRef\.current\);/);
    expect(page).toMatch(/setOlder\(\(prev\) => \[\.\.\.prev, batch\]\)/);
    // Batches are ranked inside themselves and laid end to end: nothing above the reader reorders.
    expect(page).toMatch(/return chunks\.flatMap\(\(chunk\) => \{/);
    // The automatic refill is for browsing only.
    expect(page).toMatch(/hasMore=\{!atEndOfLoaded \|\| \(!filtering && more === "idle"\)\}/);
    expect(page).toMatch(/more === "stalled" \? "Try again" : filtering \? "Search older listings" : "Load older listings"/);
  });
});
