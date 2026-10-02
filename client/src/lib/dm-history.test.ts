/**
 * Paging back through private messages, one relay at a time.
 *
 * Before this the app asked once for the newest 200 wraps and never looked
 * further back: an older conversation was not there, and could not be reached.
 */
import { describe, it, expect } from "vitest";
import {
  afterPage, freshCursor, historyFilter, historyComplete, completeBackTo, loadOlder,
  WRAP_BACKDATE_SEC, type HistoryCursors, type RelayCursor,
} from "./dm-history";

const ME = "a".repeat(64);
const at = (...ts: number[]) => ts.map((t) => ({ created_at: t }));

describe("what a relay is asked", () => {
  it("the first page asks for the newest wraps addressed to the reader", () => {
    expect(historyFilter(ME, freshCursor(), 200)).toEqual({ kinds: [1059], "#p": [ME], limit: 200 });
  });

  it("later pages ask at or before where the last one ended", () => {
    expect(historyFilter(ME, { until: 5000, done: false }, 200)).toEqual({ kinds: [1059], "#p": [ME], limit: 200, until: 5000 });
  });
});

describe("where a relay stands after a page", () => {
  it("a page of wraps moves the cursor to the oldest of them", () => {
    expect(afterPage(freshCursor(), at(900, 700, 800), true)).toEqual({ until: 700, done: false });
  });

  it("an answer with nothing at all is that relay's beginning", () => {
    expect(afterPage(freshCursor(), [], true)).toEqual({ until: null, done: true });
    expect(afterPage({ until: 700, done: false }, [], true)).toEqual({ until: 700, done: true });
  });

  it("NO answer is not an empty answer: nothing is concluded, the cursor stays", () => {
    const cursor: RelayCursor = { until: 700, done: false };
    expect(afterPage(cursor, [], false)).toEqual(cursor);
    // …even if it managed to send something before going quiet.
    expect(afterPage(cursor, at(650), false)).toEqual(cursor);
  });

  it("the boundary second is asked again (wraps share seconds); only what lies below it is progress", () => {
    expect(afterPage({ until: 700, done: false }, at(700, 700, 640, 610), true)).toEqual({ until: 610, done: false });
  });

  it("a page that brings only the boundary second again means there is nothing older", () => {
    expect(afterPage({ until: 700, done: false }, at(700, 700), true, 200)).toEqual({ until: 700, done: true });
  });

  it("…unless the page was FULL of that one second: more may hide behind the limit, so step past it", () => {
    expect(afterPage({ until: 700, done: false }, at(700, 700, 700), true, 3)).toEqual({ until: 699, done: false });
  });

  it("a relay that gives fewer than asked is NOT thereby finished (relays cap page sizes)", () => {
    expect(afterPage(freshCursor(), at(900, 800), true, 200).done).toBe(false);
  });

  it("a finished relay stays finished", () => {
    expect(afterPage({ until: 700, done: true }, at(100), true)).toEqual({ until: 700, done: true });
  });
});

describe("what can be said about the whole mailbox", () => {
  const relays = ["wss://a", "wss://b"];

  it("everything is loaded only when EVERY relay has reached its beginning", () => {
    expect(historyComplete(relays, { "wss://a": { until: 1, done: true }, "wss://b": { until: 5, done: false } })).toBe(false);
    expect(historyComplete(relays, { "wss://a": { until: 1, done: true }, "wss://b": { until: 5, done: true } })).toBe(true);
    expect(historyComplete(relays, { "wss://a": { until: 1, done: true } })).toBe(false);
    expect(historyComplete([], {})).toBe(false);
  });

  it("messages are all here back to two days AFTER the least advanced relay's oldest wrap (wraps are back-dated)", () => {
    const cursors: HistoryCursors = { "wss://a": { until: 1_000_000, done: false }, "wss://b": { until: 2_000_000, done: false } };
    expect(completeBackTo(relays, cursors)).toBe(2_000_000 + WRAP_BACKDATE_SEC);
  });

  it("a finished relay doesn't hold the claim back", () => {
    const cursors: HistoryCursors = { "wss://a": { until: 1_000_000, done: false }, "wss://b": { until: 2_000_000, done: true } };
    expect(completeBackTo(relays, cursors)).toBe(1_000_000 + WRAP_BACKDATE_SEC);
  });

  it("a relay that hasn't answered a single page says nothing: no claim is made", () => {
    expect(completeBackTo(relays, { "wss://a": { until: 1_000_000, done: false } })).toBeNull();
    expect(completeBackTo(relays, { "wss://a": { until: 1_000_000, done: false }, "wss://b": freshCursor() })).toBeNull();
  });
});

describe("loadOlder — look further back", () => {
  type Wrap = { id: string; created_at: number };
  /** A relay holding these wraps, giving at most `cap` per page, newest first. */
  const relayWith = (wraps: Wrap[], cap = 1000) => (filter: any) => {
    const until = filter.until ?? Infinity;
    return wraps.filter((w) => w.created_at <= until).sort((a, b) => b.created_at - a.created_at).slice(0, Math.min(cap, filter.limit));
  };
  const wraps = (n: number, start = 1000): Wrap[] => Array.from({ length: n }, (_, i) => ({ id: `w${start - i}`, created_at: start - i }));

  it("pages past what the app already has until something new turns up", async () => {
    const all = wraps(10); // w1000 … w991
    const known = new Set(all.slice(0, 6).map((w) => w.id)); // the newest six are already here
    const asked: any[] = [];
    const res = await loadOlder(["wss://a"], ME, {}, async (_r, f) => { asked.push(f); return { events: relayWith(all)(f), answered: true }; }, (id) => known.has(id), { limit: 3 });
    // Pages of three, each starting on the last one's oldest second:
    // 1000-998, 998-996, 996-994 — and w994 is the first one not already here.
    expect(res.wraps.map((w) => w.id)).toEqual(["w994"]);
    // Three pages: two of nothing new, then the one that crossed into the old part.
    expect(asked).toHaveLength(3);
    expect(res.complete).toBe(false);
  });

  it("reaches the beginning and says so", async () => {
    const all = wraps(4);
    let cursors: HistoryCursors = {};
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const res = await loadOlder(["wss://a"], ME, cursors, async (_r, f) => ({ events: relayWith(all)(f), answered: true }), (id) => seen.has(id), { limit: 3 });
      res.wraps.forEach((w) => seen.add(w.id));
      cursors = res.cursors;
      if (res.complete) break;
    }
    expect([...seen].sort()).toEqual(all.map((w) => w.id).sort());
    expect(historyComplete(["wss://a"], cursors)).toBe(true);
  });

  it("every wrap is found exactly once across relays that hold overlapping slices", async () => {
    const a = wraps(8, 1000), b = [...wraps(5, 996), { id: "only-b", created_at: 500 }];
    const store: Record<string, Wrap[]> = { "wss://a": a, "wss://b": b };
    let cursors: HistoryCursors = {};
    const seen: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await loadOlder(["wss://a", "wss://b"], ME, cursors, async (r, f) => ({ events: relayWith(store[r])(f), answered: true }), (id) => seen.includes(id), { limit: 4 });
      seen.push(...res.wraps.map((w) => w.id));
      cursors = res.cursors;
      if (res.complete) break;
    }
    const expected = new Set([...a, ...b].map((w) => w.id));
    expect(new Set(seen)).toEqual(expected);
    expect(seen).toHaveLength(expected.size);
  });

  it("a relay that doesn't answer is reported, keeps its place, and is NOT taken for finished", async () => {
    const all = wraps(4);
    const res = await loadOlder(["wss://a", "wss://dead"], ME, { "wss://dead": { until: 800, done: false } },
      async (r, f) => (r === "wss://dead" ? { events: [], answered: false } : { events: relayWith(all)(f), answered: true }), () => false, { limit: 10 });
    expect(res.unreached).toEqual(["wss://dead"]);
    expect(res.cursors["wss://dead"]).toEqual({ until: 800, done: false });
    expect(res.complete).toBe(false);
    expect(res.wraps).toHaveLength(4);
  });

  it("when nobody answers it stops asking — and concludes nothing", async () => {
    let calls = 0;
    const res = await loadOlder(["wss://a", "wss://b"], ME, {}, async () => { calls++; return { events: [], answered: false }; }, () => false);
    expect(calls).toBe(2);
    expect(res.unreached).toEqual(["wss://a", "wss://b"]);
    expect(res.complete).toBe(false);
  });

  it("a fetch that throws is a relay that didn't answer", async () => {
    const res = await loadOlder(["wss://a"], ME, {}, async () => { throw new Error("socket"); }, () => false);
    expect(res.unreached).toEqual(["wss://a"]);
    expect(res.complete).toBe(false);
  });

  it("finished relays are not asked again", async () => {
    const asked: string[] = [];
    await loadOlder(["wss://a", "wss://b"], ME, { "wss://a": { until: 5, done: true } }, async (r) => { asked.push(r); return { events: [], answered: true }; }, () => false);
    expect(asked).toEqual(["wss://b"]);
  });
});
