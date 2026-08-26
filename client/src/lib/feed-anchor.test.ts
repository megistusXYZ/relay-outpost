import { describe, it, expect } from "vitest";
import {
  computeIndexAnchor,
  resolveRestoreTarget,
  estimatePixelIndex,
  type RowRect,
  type SavedIndexAnchor,
} from "./feed-anchor";

// A deliberately VARIABLE-height feed: three tall media rows (600px) followed by
// short text rows (120px). This is where a flat 360px estimate diverges hardest
// from reality — exactly the shape that broke pixel-based restore on device.
//
//   idx:   0     1     2     3     4     5     6     7
//   size: 600   600   600   120   120   120   120   120
//   start:  0   600  1200  1800  1920  2040  2160  2280
const SIZES = [600, 600, 600, 120, 120, 120, 120, 120];
function buildRows(sizes: number[]): RowRect[] {
  const rows: RowRect[] = [];
  let start = 0;
  for (let i = 0; i < sizes.length; i++) {
    rows.push({ index: i, start, size: sizes[i] });
    start += sizes[i];
  }
  return rows;
}
const ROWS = buildRows(SIZES);

describe("computeIndexAnchor vs. the old pixel→index estimate", () => {
  // RED (the bug): a flat estimate maps a saved pixel offset onto the WRONG row
  // when heights vary. At scrollTop 1900 the real top row is index 3 (its top is
  // 1800, it spans 1800–1920), but the flat 360px estimate says 1900/360 ≈ 5.
  it("the flat pixel estimate picks the WRONG row on a variable-height feed", () => {
    const scrollTop = 1900;
    const flatEstimate = 360; // Home.tsx's estimateSize for mobile
    const wrongIndex = estimatePixelIndex(scrollTop, flatEstimate);
    expect(wrongIndex).toBe(5); // off by two full rows
    // Ground truth: index 3 is the row actually at the top edge.
    const trueIndex = 3;
    expect(wrongIndex).not.toBe(trueIndex);
  });

  // GREEN: the index math picks the correct row from real (measured) rects, and
  // records how far past its top the container was scrolled.
  it("computeIndexAnchor picks the correct row and its intra-row offset", () => {
    const anchor = computeIndexAnchor(ROWS, 1900);
    expect(anchor).toEqual({ index: 3, intraOffset: 100 }); // 1900 - 1800
  });

  it("picks the row straddling the top edge (scrollTop inside a tall row)", () => {
    // 1000 is inside row 1 (600–1200).
    expect(computeIndexAnchor(ROWS, 1000)).toEqual({ index: 1, intraOffset: 400 });
  });

  it("clamps to the first row with a negative offset when scrolled above the top", () => {
    expect(computeIndexAnchor(ROWS, -30)).toEqual({ index: 0, intraOffset: -30 });
  });

  it("clamps to the last row when scrolled past the end", () => {
    // last row: index 7, start 2280.
    expect(computeIndexAnchor(ROWS, 5000)).toEqual({ index: 7, intraOffset: 2720 });
  });

  it("returns null for an empty feed", () => {
    expect(computeIndexAnchor([], 500)).toBeNull();
  });
});

describe("computeIndexAnchor → resolveRestoreTarget round-trip", () => {
  const items = SIZES.map((_, i) => ({ id: `post-${i}` }));
  const getId = (it: { id: string }) => it.id;

  it("round-trips {index,intraOffset} through a saved anchor", () => {
    const anchor = computeIndexAnchor(ROWS, 1900)!; // { index: 3, intraOffset: 100 }
    const saved: SavedIndexAnchor = {
      anchorId: items[anchor.index].id,
      anchorIndex: anchor.index,
      intraOffset: anchor.intraOffset,
    };
    expect(resolveRestoreTarget(saved, items, getId)).toEqual({ index: 3, intraOffset: 100 });
  });

  it("prefers the saved index when its id still matches", () => {
    const saved: SavedIndexAnchor = { anchorId: "post-4", anchorIndex: 4, intraOffset: 12 };
    expect(resolveRestoreTarget(saved, items, getId)).toEqual({ index: 4, intraOffset: 12 });
  });

  it("relocates by id when the list shifted the anchor to a new index", () => {
    // A newer post was prepended: every id moved down one slot.
    const shifted = [{ id: "post-new" }, ...items];
    const saved: SavedIndexAnchor = { anchorId: "post-4", anchorIndex: 4, intraOffset: 12 };
    expect(resolveRestoreTarget(saved, shifted, getId)).toEqual({ index: 5, intraOffset: 12 });
  });

  it("falls back to null when the saved anchor id was evicted from the list", () => {
    const saved: SavedIndexAnchor = { anchorId: "gone", anchorIndex: 99, intraOffset: 5 };
    expect(resolveRestoreTarget(saved, items, getId)).toBeNull();
  });

  it("uses the index alone when no id was captured (index within range)", () => {
    const saved: SavedIndexAnchor = { anchorId: null, anchorIndex: 2, intraOffset: 40 };
    expect(resolveRestoreTarget(saved, items, getId)).toEqual({ index: 2, intraOffset: 40 });
  });
});

// Regression: anchoring on the row STRADDLING the top edge left a residual
// drift — that row is mostly scrolled past, and when its media/embeds
// re-measure on back-return (±100px is typical), everything the user was
// actually READING below it shifts by that delta even though the anchor's own
// offset was restored perfectly. When the viewport height is known, anchor on
// the FIRST FULLY-VISIBLE row instead: above-the-fold re-measures then can't
// move the reading area.
describe("computeIndexAnchor — fully-visible anchor (viewport known)", () => {
  // rows: 0:[0,500) 1:[500,800) 2:[800,1600) 3:[1600,1900)
  const rows = [
    { index: 0, start: 0, size: 500 },
    { index: 1, start: 500, size: 300 },
    { index: 2, start: 800, size: 800 },
    { index: 3, start: 1600, size: 300 },
  ];

  it("prefers the first row starting at/below the top edge over the straddling row", () => {
    // scrollTop 600 → row 1 straddles; row 2 (start 800) is the first fully
    // visible in a 900px viewport. Anchor = row 2, sitting 200px below the top.
    expect(computeIndexAnchor(rows, 600, 900)).toEqual({ index: 2, intraOffset: -200 });
  });

  it("falls back to the straddling row when no row starts inside the viewport (very tall row)", () => {
    // scrollTop 900 inside row 2 [800,1600); next row starts at 1600, beyond a
    // 500px viewport (top edge window 900..1400) → keep the straddling row.
    expect(computeIndexAnchor(rows, 900, 500)).toEqual({ index: 2, intraOffset: 100 });
  });

  it("without a viewport height, keeps the classic straddling behavior", () => {
    expect(computeIndexAnchor(rows, 600)).toEqual({ index: 1, intraOffset: 100 });
  });
});
