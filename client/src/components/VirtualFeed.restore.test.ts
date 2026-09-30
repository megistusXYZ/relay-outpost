/**
 * The virtualized feed's back-restore on a COLD rebuild (Home after a reload,
 * or a drill-in past the kept-alive depth). Measured 2026-09-30 with
 * scripts/qa/back-loop.cjs --reload: before, Back landed 133px off with 206px
 * jumps, or on the wrong post entirely; after, the reader sees no movement and
 * the feed lands on the post at its saved offset (563px vs 562px saved).
 *
 * Four decisions, each of which the loop caught the absence of; pinned here
 * so they are not undone one at a time. The loop remains the proof.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "VirtualFeed.tsx"), "utf8");

describe("VirtualFeed back-restore on a cold feed", () => {
  it("resolves the target when the rows are there, not once at mount", () => {
    expect(src).toMatch(/restoreTargetWhenLoaded\(/);
    expect(src).not.toMatch(/\bresolveRestoreTarget\(/);
  });

  it("lands by one absolute offset — scrollToIndex keeps a reconcile loop that re-scrolls to the row's top for seconds", () => {
    expect(src).toMatch(/virtualizer\.scrollToOffset\(Math\.max\(0, start \+ target\.intraOffset\)\)/);
    expect(src).not.toMatch(/scrollToIndex\(target\.index/);
  });

  it("does not let react-virtual compensate row re-measures while the app-level restorer is landing (its iOS deferral flushed 269–358px late)", () => {
    expect(src).toMatch(/virtualizer\.shouldAdjustScrollPositionOnItemSizeChange = \(item, _delta, instance\) => \{\s*if \(isRestoreActive\(\)\) return false;/);
  });

  it("settles under a veil: rows stay invisible until the anchor row holds still and the restorer has let go", () => {
    expect(src).toMatch(/visibility: veiled \? "hidden" : undefined/);
    expect(src).toMatch(/still >= COLD_VEIL_STILL_FRAMES && !isRestoreActive\(\)/);
  });

  it("re-measures the scroll margin when the space above the feed changes", () => {
    expect(src).toMatch(/new ResizeObserver\(remeasure\)/);
    expect(src).toMatch(/mo\?\.observe\(el, \{ childList: true, subtree: true \}\)/);
  });
});
