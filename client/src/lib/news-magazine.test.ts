import { describe, it, expect } from "vitest";
import { splitMagazine, diversifyByStride, diversifyGrid } from "./news-magazine";

// The items are opaque to splitMagazine; a plain {id, read} shape is enough to
// assert bucketing + the read-boundary index.
interface Row {
  id: string;
  read?: boolean;
}
const isRead = (r: Row) => !!r.read;
const rows = (...spec: [string, boolean?][]): Row[] => spec.map(([id, read]) => ({ id, read }));

describe("splitMagazine", () => {
  it("puts the first railCount items in the rail and the remainder in the grid", () => {
    const rest = rows(["a"], ["b"], ["c"], ["d"], ["e"]);
    const { rail, grid } = splitMagazine(rest, 3, isRead);
    expect(rail.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(grid.map((r) => r.id)).toEqual(["d", "e"]);
  });

  it("returns shallow slices (does not mutate or reorder the input)", () => {
    const rest = rows(["a"], ["b"], ["c"]);
    const snapshot = rest.map((r) => r.id);
    const { rail, grid } = splitMagazine(rest, 1, isRead);
    expect(rail[0]).toBe(rest[0]); // same reference, not a copy
    expect(grid).toEqual([rest[1], rest[2]]);
    expect(rest.map((r) => r.id)).toEqual(snapshot);
  });

  it("clamps railCount to the list length (rail is everything, grid empty)", () => {
    const rest = rows(["a"], ["b"]);
    const { rail, grid } = splitMagazine(rest, 9, isRead);
    expect(rail.map((r) => r.id)).toEqual(["a", "b"]);
    expect(grid).toEqual([]);
  });

  it("treats a zero / negative / non-finite railCount as an empty rail", () => {
    const rest = rows(["a"], ["b"]);
    for (const n of [0, -3, NaN, Infinity * 0]) {
      const { rail, grid } = splitMagazine(rest, n, isRead);
      expect(rail).toEqual([]);
      expect(grid.map((r) => r.id)).toEqual(["a", "b"]);
    }
  });

  it("reports the first read index within the grid (the caught-up boundary)", () => {
    // rail takes [a,b]; grid = [c(unread), d(read), e(read)] -> boundary at 1.
    const rest = rows(["a"], ["b"], ["c"], ["d", true], ["e", true]);
    const { grid, gridReadStart } = splitMagazine(rest, 2, isRead);
    expect(grid.map((r) => r.id)).toEqual(["c", "d", "e"]);
    expect(gridReadStart).toBe(1);
  });

  it("gridReadStart is -1 when the grid has no read items", () => {
    const rest = rows(["a"], ["b"], ["c"]);
    expect(splitMagazine(rest, 1, isRead).gridReadStart).toBe(-1);
  });

  it("gridReadStart is 0 when the whole grid is already read", () => {
    const rest = rows(["a"], ["b", true], ["c", true]);
    expect(splitMagazine(rest, 1, isRead).gridReadStart).toBe(0);
  });

  it("handles an empty rest list", () => {
    const { rail, grid, gridReadStart } = splitMagazine([], 3, isRead);
    expect(rail).toEqual([]);
    expect(grid).toEqual([]);
    expect(gridReadStart).toBe(-1);
  });
});

// Column-aware diversity. Cards are opaque; a {id, src} shape is enough to
// assert the vertical (stride) guarantee + order preservation.
interface Card {
  id: string;
  src: string;
  read?: boolean;
}
const cardKey = (c: Card) => c.src;
/** Build cards from "src:id" specs. */
const cards = (...specs: string[]): Card[] =>
  specs.map((s) => {
    const [src, id] = s.split(":");
    return { id, src };
  });
/** No two cards `stride` apart share a source (the vertical column guarantee). */
function assertNoColumnStack(out: Card[], stride: number) {
  for (let i = 0; i + stride < out.length; i++) {
    expect(out[i].src).not.toBe(out[i + stride].src);
  }
}

describe("diversifyByStride", () => {
  it("is a no-op for stride < 2 (mobile single column keeps the linear order)", () => {
    const list = cards("a:1", "a:2", "b:3");
    expect(diversifyByStride(list, 1, cardKey)).toBe(list);
    expect(diversifyByStride(list, 0, cardKey)).toBe(list);
  });

  it("is a no-op when the list is no longer than the stride", () => {
    const list = cards("a:1", "a:2");
    expect(diversifyByStride(list, 2, cardKey)).toBe(list);
  });

  it("breaks a 2-column vertical stack (item i and i+2 differ in source)", () => {
    // Row-major into 2 cols, A,B,A,B stacks A over A and B over B.
    const out = diversifyByStride(cards("a:1", "b:1", "a:2", "b:2"), 2, cardKey);
    assertNoColumnStack(out, 2);
  });

  it("breaks a 3-column vertical stack (item i and i+3 differ in source)", () => {
    // Two outlets flood; with 3 columns positions 0 and 3 would both be A.
    const out = diversifyByStride(
      cards("a:1", "b:1", "c:1", "a:2", "b:2", "c:2", "a:3", "d:1", "e:1"),
      3,
      cardKey,
    );
    assertNoColumnStack(out, 3);
  });

  it("preserves each source's relative order", () => {
    const out = diversifyByStride(
      cards("a:1", "b:1", "a:2", "b:2", "a:3", "c:1"),
      2,
      cardKey,
    );
    const idsFor = (src: string) => out.filter((c) => c.src === src).map((c) => c.id);
    expect(idsFor("a")).toEqual(["1", "2", "3"]);
    expect(idsFor("b")).toEqual(["1", "2"]);
    // No card is lost or duplicated.
    expect(out.length).toBe(6);
  });

  it("is idempotent — re-running on its own output changes nothing", () => {
    const once = diversifyByStride(
      cards("a:1", "b:1", "a:2", "b:2", "c:1", "a:3", "d:1", "b:3"),
      3,
      cardKey,
    );
    const twice = diversifyByStride(once, 3, cardKey);
    expect(twice.map((c) => c.id)).toEqual(once.map((c) => c.id));
  });

  it("leaves an already column-diverse list untouched", () => {
    const list = cards("a:1", "b:1", "c:1", "b:2", "a:2", "c:2");
    const out = diversifyByStride(list, 3, cardKey);
    expect(out.map((c) => c.id)).toEqual(list.map((c) => c.id));
  });
});

describe("diversifyGrid", () => {
  const isReadCard = (c: Card) => !!c.read;
  const grid = (...spec: [string, string, boolean?][]): Card[] =>
    spec.map(([src, id, read]) => ({ src, id, read }));

  it("is a no-op for stride < 2", () => {
    const g = grid(["a", "1"], ["a", "2"], ["b", "3"]);
    expect(diversifyGrid(g, -1, 1, cardKey)).toBe(g);
  });

  it("diversifies a grid with no read items (whole list)", () => {
    const out = diversifyGrid(cards("a:1", "b:1", "a:2", "b:2"), -1, 2, cardKey);
    assertNoColumnStack(out, 2);
  });

  it("diversifies unread and read segments independently — read never crosses the boundary", () => {
    // Unread head [a,b,a,b] (boundary at 4), read tail [c,c,d,d].
    const g = grid(
      ["a", "u1"], ["b", "u2"], ["a", "u3"], ["b", "u4"],
      ["c", "r1", true], ["c", "r2", true], ["d", "r3", true], ["d", "r4", true],
    );
    const out = diversifyGrid(g, 4, 2, cardKey);
    // Boundary preserved: first 4 unread, last 4 read.
    expect(out.slice(0, 4).every((c) => !c.read)).toBe(true);
    expect(out.slice(4).every((c) => c.read)).toBe(true);
    // Vertical guarantee holds within each half.
    assertNoColumnStack(out.slice(0, 4), 2);
    assertNoColumnStack(out.slice(4), 2);
  });

  it("keeps a fully-read grid (boundary 0) entirely read after diversifying", () => {
    const g = grid(["a", "1", true], ["b", "2", true], ["a", "3", true], ["b", "4", true]);
    const out = diversifyGrid(g, 0, 2, cardKey);
    expect(out.every((c) => c.read)).toBe(true);
    assertNoColumnStack(out, 2);
  });
});
