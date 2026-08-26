import { describe, it, expect } from "vitest";
import { isEdgeBackSwipe, shouldAttachCustomBackSwipe } from "./edge-swipe";

/** A confident back gesture: starts on the left edge, travels right, quickly. */
const good = { startX: 8, dx: 120, dy: 10, elapsedMs: 220 };

describe("isEdgeBackSwipe", () => {
  it("accepts a swipe from the left edge toward the right", () => {
    expect(isEdgeBackSwipe(good)).toBe(true);
  });

  it("ignores the same swipe when it starts away from the edge", () => {
    // This is why the old gesture was switched off: it matched anywhere on
    // screen, so dragging a carousel or scrolling diagonally navigated away.
    expect(isEdgeBackSwipe({ ...good, startX: 160 })).toBe(false);
  });

  it("ignores a vertical scroll that begins on the edge", () => {
    expect(isEdgeBackSwipe({ startX: 6, dx: 30, dy: 200, elapsedMs: 300 })).toBe(false);
  });

  it("ignores a leftward swipe — this gesture only ever goes back", () => {
    // Never history.forward(): re-entering a thread the user deliberately left
    // is a worse failure than doing nothing.
    expect(isEdgeBackSwipe({ ...good, dx: -120 })).toBe(false);
  });

  it("ignores a slow drag", () => {
    expect(isEdgeBackSwipe({ ...good, elapsedMs: 1200 })).toBe(false);
  });

  it("ignores a short twitch", () => {
    expect(isEdgeBackSwipe({ ...good, dx: 20 })).toBe(false);
  });

  it("accepts a diagonal swipe that is still clearly horizontal", () => {
    expect(isEdgeBackSwipe({ startX: 10, dx: 140, dy: 55, elapsedMs: 260 })).toBe(true);
  });

  it("honours a custom edge width", () => {
    expect(isEdgeBackSwipe({ ...good, startX: 40 })).toBe(false);
    expect(isEdgeBackSwipe({ ...good, startX: 40 }, { edgeWidth: 64 })).toBe(true);
  });
});

describe("shouldAttachCustomBackSwipe", () => {
  it("attaches ONLY in an iOS standalone PWA — the one place with no native gesture", () => {
    expect(shouldAttachCustomBackSwipe({ standalone: true, iOS: true })).toBe(true);
  });
  it("stands down wherever the platform already owns the gesture — ours on top made one swipe go back twice", () => {
    expect(shouldAttachCustomBackSwipe({ standalone: false, iOS: true })).toBe(false);  // Safari chrome swipe
    expect(shouldAttachCustomBackSwipe({ standalone: true, iOS: false })).toBe(false);  // Android system gesture
    expect(shouldAttachCustomBackSwipe({ standalone: false, iOS: false })).toBe(false);
  });
});
