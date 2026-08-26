import { describe, it, expect } from "vitest";
import { mergeSupplementIntoFeed, limitSupplementShare, interleaveSupplement, splitSupplement, spreadAuthors } from "./feed-merge";
import type { Event } from "nostr-tools";

const ev = (id: string, created_at: number, kind = 1): Event =>
  ({ id, created_at, kind, pubkey: "p", content: "", tags: [], sig: "s" }) as Event;

describe("mergeSupplementIntoFeed", () => {
  it("returns the base untouched when there is no media", () => {
    const base = [ev("a", 300), ev("b", 200)];
    expect(mergeSupplementIntoFeed(base, [])).toBe(base);
    expect(mergeSupplementIntoFeed(base, undefined as unknown as Event[])).toBe(base);
  });

  it("interleaves media by recency, newest first", () => {
    const base = [ev("a", 300), ev("c", 100)];
    const media = [ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media).map((e) => e.id)).toEqual(["a", "m", "c"]);
  });

  it("never duplicates an event already in the base", () => {
    // The timeline may start emitting these kinds one day; when it does this
    // becomes a no-op rather than showing every picture twice.
    const base = [ev("a", 300), ev("m", 200, 20)];
    const media = [ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media)).toBe(base);
  });

  it("dedupes within the media list itself", () => {
    const base = [ev("a", 300)];
    const media = [ev("m", 200, 20), ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media)).toHaveLength(2);
  });

  it("survives an empty base", () => {
    expect(mergeSupplementIntoFeed([], [ev("m", 5, 20)]).map((e) => e.id)).toEqual(["m"]);
    expect(mergeSupplementIntoFeed(undefined as unknown as Event[], [ev("m", 5, 20)])).toHaveLength(1);
  });

  it("skips malformed entries rather than throwing", () => {
    const base = [ev("a", 300)];
    const media = [null as unknown as Event, { created_at: 1 } as Event, ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media).map((e) => e.id)).toEqual(["a", "m"]);
  });

  it("applies a cap when asked, keeping the newest", () => {
    const base = [ev("a", 300), ev("b", 100)];
    const media = [ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media, 2).map((e) => e.id)).toEqual(["a", "m"]);
  });

  it("ignores a nonsense cap instead of emptying the feed", () => {
    const base = [ev("a", 300)];
    const media = [ev("m", 200, 20)];
    expect(mergeSupplementIntoFeed(base, media, 0)).toHaveLength(2);
    expect(mergeSupplementIntoFeed(base, media, -5)).toHaveLength(2);
  });
});

describe("limitSupplementShare — media supplements a ranked list, never replaces it", () => {
  const media = Array.from({ length: 40 }, (_, i) => ev(`m${i}`, 1000 + i, 20));

  it("scales the budget with the list it joins", () => {
    // The bug this replaced: an ABSOLUTE cap of 120 never bound on a small
    // trending page, and the first live run rendered 22 media against 9 ranked
    // posts. A ratio cannot drift out of proportion the way a constant can.
    expect(limitSupplementShare(Array.from({ length: 10 }, (_, i) => ev(`b${i}`, i)), media)).toHaveLength(5);
    expect(limitSupplementShare(Array.from({ length: 40 }, (_, i) => ev(`b${i}`, i)), media)).toHaveLength(20);
  });

  it("takes the NEWEST media, not whatever the store indexed first", () => {
    const base = Array.from({ length: 4 }, (_, i) => ev(`b${i}`, i));
    const picked = limitSupplementShare(base, media);
    expect(picked.map((e) => e.created_at)).toEqual([1039, 1038]);
  });

  it("carries nothing when there is nothing to ride along with", () => {
    expect(limitSupplementShare([], media)).toEqual([]);
    expect(limitSupplementShare([ev("b", 1)], media)).toEqual([]); // floor(1 * 0.5) = 0
  });

  it("survives empty or missing media", () => {
    const base = Array.from({ length: 10 }, (_, i) => ev(`b${i}`, i));
    expect(limitSupplementShare(base, [])).toEqual([]);
    expect(limitSupplementShare(base, undefined as unknown as Event[])).toEqual([]);
  });

  it("does not mutate the media list it was given", () => {
    const base = Array.from({ length: 10 }, (_, i) => ev(`b${i}`, i));
    const input = [ev("a", 1, 20), ev("b", 9, 20)];
    limitSupplementShare(base, input);
    expect(input.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("interleaveSupplement — spread, not stacked", () => {
  it("keeps the ranked order and drops media between posts", () => {
    // The live failure this fixes: media is all recent, so a time-sorted merge
    // put every picture at the top and the first screens were 57% media while
    // the overall ratio still "passed".
    const base = Array.from({ length: 6 }, (_, i) => ev(`b${i}`, 100 - i));
    const media = [ev("m0", 999, 20), ev("m1", 998, 20)];
    const out = interleaveSupplement(base, media).map((e) => e.id);
    expect(out.filter((id) => id.startsWith("b"))).toEqual(["b0", "b1", "b2", "b3", "b4", "b5"]);
    expect(out.indexOf("m0")).toBeGreaterThan(0);
    expect(out.indexOf("m0")).toBeLessThan(out.indexOf("m1"));
  });

  it("never puts media first — the top post stays the top post", () => {
    const base = [ev("b0", 1), ev("b1", 2), ev("b2", 3), ev("b3", 4)];
    const out = interleaveSupplement(base, [ev("m", 999, 20)]);
    expect(out[0].id).toBe("b0");
  });

  it("keeps every event — nothing is silently dropped", () => {
    const base = Array.from({ length: 3 }, (_, i) => ev(`b${i}`, i));
    const media = Array.from({ length: 5 }, (_, i) => ev(`m${i}`, 900 + i, 20));
    expect(interleaveSupplement(base, media)).toHaveLength(8);
  });

  it("does not duplicate media already present in the base", () => {
    const base = [ev("b0", 1), ev("m", 2, 20)];
    expect(interleaveSupplement(base, [ev("m", 2, 20)])).toBe(base);
  });

  it("handles empty sides", () => {
    const base = [ev("b", 1)];
    expect(interleaveSupplement(base, [])).toBe(base);
    expect(interleaveSupplement([], [ev("m", 1, 20)]).map((e) => e.id)).toEqual(["m"]);
  });
});

describe("splitSupplement — one budget, shared", () => {
  const base = Array.from({ length: 20 }, (_, i) => ev(`b${i}`, i));
  const media = Array.from({ length: 30 }, (_, i) => ev(`m${i}`, 2000 + i, 20));
  const text = Array.from({ length: 30 }, (_, i) => ev(`t${i}`, 1000 + i));

  it("never exceeds one budget, however much is on offer", () => {
    // Two independent budgets would push the unranked share past half and turn
    // a ranked feed into a chronological one. The slots are shared instead.
    expect(splitSupplement(base, media, text)).toHaveLength(10); // 20 * 0.5
  });

  it("gives media the larger share and relay text the rest", () => {
    const out = splitSupplement(base, media, text);
    expect(out.filter((e) => e.id.startsWith("m"))).toHaveLength(6);
    expect(out.filter((e) => e.id.startsWith("t"))).toHaveLength(4);
  });

  it("widens the independent share when media is quiet", () => {
    // A quiet media hour should mean MORE relay text, not a smaller supplement
    // — otherwise the feed silently narrows back toward one provider.
    const out = splitSupplement(base, [ev("m0", 9999, 20)], text);
    expect(out).toHaveLength(10);
    expect(out.filter((e) => e.id.startsWith("t"))).toHaveLength(9);
  });

  it("takes the newest of each, not whatever order it was handed", () => {
    const out = splitSupplement(base, media, text);
    expect(out[0].created_at).toBe(2029);
  });

  it("MIXES the two sources rather than stacking media then text", () => {
    // Concatenating put every relay post after every picture, so the
    // independent supply landed past the fold: 12 picked, zero visible.
    const mixed = splitSupplement(
      Array.from({ length: 8 }, (_, i) => ev(`b${i}`, i)),
      [ev("m0", 100, 20), ev("m1", 80, 20)],
      [ev("t0", 90), ev("t1", 70)],
    );
    expect(mixed.map((e) => e.id)).toEqual(["m0", "t0", "m1", "t1"]);
  });

  it("returns nothing when there is no ranked list to supplement", () => {
    expect(splitSupplement([], media, text)).toEqual([]);
    expect(splitSupplement([ev("b", 1)], media, text)).toEqual([]); // floor(1*0.5)=0
  });

  it("survives missing sides", () => {
    expect(splitSupplement(base, [], [])).toEqual([]);
    expect(splitSupplement(base, undefined as unknown as Event[], text)).toHaveLength(10);
  });
});

describe("spreadAuthors — one voice at a time", () => {
  const p = (id: string, pubkey: string): Event => ({ ...ev(id, 1), pubkey }) as Event;

  it("breaks up a run from one author", () => {
    // The live report: three posts from the same person back to back, because
    // ranking is per-event and has no memory of who you just read.
    const out = spreadAuthors([p("a1", "A"), p("a2", "A"), p("a3", "A"), p("b1", "B"), p("c1", "C")]);
    const authors = out.map((e) => e.pubkey);
    for (let i = 1; i < authors.length; i++) {
      if (authors[i] === authors[i - 1]) {
        // only permitted once the alternatives are exhausted
        expect(authors.slice(i).every((x) => x === authors[i])).toBe(true);
      }
    }
  });

  it("keeps every event — extras are deferred, never dropped", () => {
    const input = [p("a1", "A"), p("a2", "A"), p("a3", "A"), p("b1", "B")];
    expect(spreadAuthors(input)).toHaveLength(4);
  });

  it("leaves an already-varied list in its ranked order", () => {
    const input = [p("a", "A"), p("b", "B"), p("c", "C")];
    expect(spreadAuthors(input).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves each author's own relative order", () => {
    const out = spreadAuthors([p("a1", "A"), p("a2", "A"), p("b1", "B"), p("b2", "B")]);
    const aOrder = out.filter((e) => e.pubkey === "A").map((e) => e.id);
    expect(aOrder).toEqual(["a1", "a2"]);
  });

  it("handles a single-author list without hanging or losing anything", () => {
    const input = [p("a1", "A"), p("a2", "A"), p("a3", "A")];
    expect(spreadAuthors(input).map((e) => e.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("is a no-op below three items", () => {
    const input = [p("a", "A"), p("b", "A")];
    expect(spreadAuthors(input)).toBe(input);
  });
});
