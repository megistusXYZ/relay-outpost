import { describe, it, expect } from "vitest";
import { circleGridCount, circleStripCount, FACE, GAP } from "./circle-fill";

describe("how many faces the Circle shows", () => {
  it("a face is 48px with a 12px gap: the row's arithmetic is fixed", () => {
    expect(FACE).toBe(48);
    expect(GAP).toBe(12);
  });

  describe("the grid (desktop rail): whole rows, up to two", () => {
    it("fills exactly one row when that is what fits", () => {
      // 300px: 5 faces (5×48 + 4×12 = 288) fit; a sixth would not.
      expect(circleGridCount(300, 5)).toBe(5);
    });

    it("never leaves a ragged last row: it rounds down to whole rows", () => {
      // 300px → 5 per row; with 8 people, 8 would leave three on a second row.
      expect(circleGridCount(300, 8)).toBe(5);
      expect(circleGridCount(300, 10)).toBe(10);
      expect(circleGridCount(300, 191)).toBe(10);
    });

    it("stops at two rows however many there are", () => {
      expect(circleGridCount(600, 191)).toBe(20); // 10 per row
    });

    it("shows everyone when they do not fill a row", () => {
      expect(circleGridCount(300, 4)).toBe(4);
    });

    it("uses the rendered face size when the page is scaled (a 51px face at 17px root)", () => {
      // 353px, faces 51 wide with a 12.75 gap: five fit, not six.
      expect(circleGridCount(353, 12, { face: 51, gap: 12.75 })).toBe(10);
      expect(circleGridCount(353, 12)).toBe(12); // the nominal 48/12 would say six per row
    });

    it("a width that is not known yet shows a plain minimum, never nothing", () => {
      expect(circleGridCount(0, 8)).toBe(8);
    });
  });

  describe("the strip (phone, tablet): fills the width, and overflows to scroll", () => {
    it("shows everyone it has, up to the strip's cap", () => {
      expect(circleStripCount(191)).toBe(24);
      expect(circleStripCount(7)).toBe(7);
    });
  });
});
