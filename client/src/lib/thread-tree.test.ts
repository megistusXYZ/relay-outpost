import { describe, it, expect } from "vitest";
import {
  MOBILE_THREAD_INDENT_CAP,
  DESKTOP_THREAD_INDENT_CAP,
  SIBLING_OVERFLOW_LIMIT,
  BRANCH_CONTINUE_EXTRA,
  getThreadIndentCap,
  partitionSiblings,
  shouldContinueThread,
  rendersIndentColumn,
  isBeyondIndentCap,
} from "./thread-tree";

describe("getThreadIndentCap", () => {
  it("caps at 2 levels on narrow viewports", () => {
    expect(getThreadIndentCap(true)).toBe(MOBILE_THREAD_INDENT_CAP);
    expect(MOBILE_THREAD_INDENT_CAP).toBe(2);
  });

  it("caps at 5 levels on desktop", () => {
    expect(getThreadIndentCap(false)).toBe(DESKTOP_THREAD_INDENT_CAP);
    expect(DESKTOP_THREAD_INDENT_CAP).toBe(5);
  });
});

describe("partitionSiblings", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

  it("keeps levels at or under the limit fully visible (no overflow row)", () => {
    expect(partitionSiblings(items(8))).toEqual({ visible: items(8), overflow: [] });
    expect(partitionSiblings(items(1)).overflow).toHaveLength(0);
    expect(partitionSiblings([]).visible).toHaveLength(0);
  });

  it("folds everything past the first 8 into overflow", () => {
    const { visible, overflow } = partitionSiblings(items(9));
    expect(visible).toEqual(items(9).slice(0, 8));
    expect(overflow).toEqual(["r8"]);
  });

  it("preserves order and loses nothing", () => {
    const { visible, overflow } = partitionSiblings(items(23));
    expect(visible).toHaveLength(SIBLING_OVERFLOW_LIMIT);
    expect(overflow).toHaveLength(23 - SIBLING_OVERFLOW_LIMIT);
    expect([...visible, ...overflow]).toEqual(items(23));
  });

  it("honors a custom limit", () => {
    const { visible, overflow } = partitionSiblings(items(5), 3);
    expect(visible).toEqual(["r0", "r1", "r2"]);
    expect(overflow).toEqual(["r3", "r4"]);
  });
});

describe("shouldContinueThread (branch cutoff)", () => {
  const mobileCutoff = MOBILE_THREAD_INDENT_CAP + BRANCH_CONTINUE_EXTRA; // 6
  const desktopCutoff = DESKTOP_THREAD_INDENT_CAP + BRANCH_CONTINUE_EXTRA; // 9

  it("never cuts off a leaf", () => {
    expect(shouldContinueThread(mobileCutoff + 5, MOBILE_THREAD_INDENT_CAP, false)).toBe(false);
  });

  it("renders branches inline up to cap+4 levels", () => {
    expect(shouldContinueThread(0, MOBILE_THREAD_INDENT_CAP, true)).toBe(false);
    expect(shouldContinueThread(mobileCutoff - 1, MOBILE_THREAD_INDENT_CAP, true)).toBe(false);
    expect(shouldContinueThread(desktopCutoff - 1, DESKTOP_THREAD_INDENT_CAP, true)).toBe(false);
  });

  it("re-roots branches that extend beyond cap+4 levels", () => {
    expect(shouldContinueThread(mobileCutoff, MOBILE_THREAD_INDENT_CAP, true)).toBe(true);
    expect(shouldContinueThread(mobileCutoff + 1, MOBILE_THREAD_INDENT_CAP, true)).toBe(true);
    expect(shouldContinueThread(desktopCutoff, DESKTOP_THREAD_INDENT_CAP, true)).toBe(true);
  });
});

describe("rendersIndentColumn / isBeyondIndentCap", () => {
  it("rails exist only within the cap (max 2 stacked on mobile)", () => {
    expect(rendersIndentColumn(0, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(1, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(2, MOBILE_THREAD_INDENT_CAP)).toBe(false);
    expect(rendersIndentColumn(10, MOBILE_THREAD_INDENT_CAP)).toBe(false);
  });

  it("desktop rails stop after 5 levels", () => {
    expect(rendersIndentColumn(4, DESKTOP_THREAD_INDENT_CAP)).toBe(true);
    expect(rendersIndentColumn(5, DESKTOP_THREAD_INDENT_CAP)).toBe(false);
  });

  it("the ↳ parent cue turns on exactly where the indent clamps", () => {
    expect(isBeyondIndentCap(1, MOBILE_THREAD_INDENT_CAP)).toBe(false);
    expect(isBeyondIndentCap(2, MOBILE_THREAD_INDENT_CAP)).toBe(true);
    expect(isBeyondIndentCap(4, DESKTOP_THREAD_INDENT_CAP)).toBe(false);
    expect(isBeyondIndentCap(5, DESKTOP_THREAD_INDENT_CAP)).toBe(true);
  });
});
