/**
 * Pull-to-refresh gesture math (lib/pull-to-refresh.ts).
 *
 * The DOM half (hooks/use-pull-to-refresh.ts) is deliberately thin; everything
 * that decides WHEN a pull becomes a refresh lives here, where it can be
 * pinned. The interlocks worth pinning:
 *
 *  - the damp curve must still be able to REACH the trigger — a resistance
 *    factor tuned too low with a cap below the threshold would be a
 *    pull-to-refresh that can never fire, silently (the dead-control class);
 *  - upward/zero drags produce no pull, so a plain scroll never shows the
 *    indicator;
 *  - "refreshing" owns the phase whatever the finger does — the strip must not
 *    flicker back to a pull mid-refresh.
 */
import { describe, expect, it } from "vitest";
import {
  PULL_HOLD_PX,
  PULL_MAX_PX,
  PULL_TRIGGER_PX,
  dampPull,
  indicatorHeight,
  pullArmed,
  pullPhase,
} from "./pull-to-refresh";

describe("dampPull", () => {
  it("ignores zero and upward drags (plain scrolling shows no indicator)", () => {
    expect(dampPull(0)).toBe(0);
    expect(dampPull(-40)).toBe(0);
  });

  it("resists: the indicator always trails the finger", () => {
    expect(dampPull(100)).toBeLessThan(100);
    expect(dampPull(40)).toBeGreaterThan(0);
  });

  it("is monotonic — pulling further never shrinks the indicator", () => {
    let prev = 0;
    for (let raw = 0; raw <= 400; raw += 20) {
      const next = dampPull(raw);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it("caps at PULL_MAX_PX", () => {
    expect(dampPull(5000)).toBe(PULL_MAX_PX);
  });

  it("can still reach the trigger — the gesture is not a dead control", () => {
    // A realistic thumb drag (~1/3 of a phone screen) must arm the refresh.
    // This is the interlock between the damp factor, the cap, and the
    // threshold: if a retune of any one breaks reachability, this fails.
    expect(PULL_MAX_PX).toBeGreaterThan(PULL_TRIGGER_PX);
    expect(dampPull(250)).toBeGreaterThanOrEqual(PULL_TRIGGER_PX);
  });
});

describe("pullArmed", () => {
  it("arms exactly at the threshold, not below it", () => {
    expect(pullArmed(PULL_TRIGGER_PX - 1)).toBe(false);
    expect(pullArmed(PULL_TRIGGER_PX)).toBe(true);
  });
});

describe("pullPhase", () => {
  it("maps idle / pulling / armed off the pull distance", () => {
    expect(pullPhase(0, false)).toBe("idle");
    expect(pullPhase(10, false)).toBe("pulling");
    expect(pullPhase(PULL_TRIGGER_PX, false)).toBe("armed");
  });

  it("refreshing owns the phase regardless of the finger", () => {
    expect(pullPhase(0, true)).toBe("refreshing");
    expect(pullPhase(PULL_TRIGGER_PX, true)).toBe("refreshing");
  });
});

describe("indicatorHeight", () => {
  it("tracks the finger while pulling and holds steady while refreshing", () => {
    expect(indicatorHeight(0, false)).toBe(0);
    expect(indicatorHeight(50, false)).toBe(50);
    // The hold height is fixed: the strip must not jump when the finger
    // lifts at an arbitrary distance and the refresh takes over.
    expect(indicatorHeight(999, true)).toBe(PULL_HOLD_PX);
    expect(indicatorHeight(0, true)).toBe(PULL_HOLD_PX);
  });
});
