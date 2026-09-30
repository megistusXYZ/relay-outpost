/**
 * Back lands on the exact place and the page never moves under the reader.
 *
 * Measured 2026-09-30 (headless Chromium at phone width, scroll anchoring off
 * to match WebKit): returning to a profile, the block ABOVE the reader — the
 * profile header — was 1,400px when they left and 1,172px on the first frame
 * back, then regrew to 1,400px within 200ms as its async sections arrived.
 * Every arrival pushed the timeline down; the restorer scrolled it back a frame
 * later, so the reader saw the post under their thumb drop 79px and snap back,
 * then 149px and back. On iPhone there is no scroll anchoring, decoding is
 * slower, and the old restorer stopped the moment a finger touched the screen,
 * so every later arrival moved the page under it.
 *
 * The hold: measure how much shorter the content above the anchor is than when
 * the reader left, and hold that space with padding on the scroll container.
 * The first frame paints at the saved scrollTop with the anchor at its saved
 * offset. As content arrives the held space shrinks by the same amount, so
 * nothing on screen moves — and there is no scroll write to fight the reader's
 * finger, so the hold keeps working after they start scrolling.
 *
 * Node test env: the container and anchor are stand-ins that model layout the
 * way a browser does — padding pushes the content down, scrollTop offsets it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { holdGroundAboveAnchor, type SavedScrollPosition } from "./scroll-restore";

const BASE_PAD = 68;

/** A scroll container whose only row is the anchor, `naturalTop` px into the content. */
function page(opts: { scrollTop: number; naturalTop: number; anchorMounted?: boolean }) {
  const state = { scrollTop: opts.scrollTop, naturalTop: opts.naturalTop, mounted: opts.anchorMounted ?? true };
  const container = {
    style: { paddingTop: "" } as { paddingTop: string },
    scrollHeight: 80000,
    clientHeight: 812,
    get scrollTop() { return state.scrollTop; },
    set scrollTop(v: number) { state.scrollTop = Math.max(0, v); },
    scrollBy(_x: number, y: number) { this.scrollTop += y; },
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => (state.mounted ? [anchor] : []),
  };
  const extra = () => (container.style.paddingTop ? parseFloat(container.style.paddingTop) - BASE_PAD : 0);
  const anchor = {
    closest: () => null,
    // Where the row sits on screen: its place in the content, pushed by any held
    // padding, minus how far the container is scrolled.
    getBoundingClientRect: () => ({ top: state.naturalTop + extra() - state.scrollTop }),
  };
  return {
    container: container as unknown as HTMLElement,
    state,
    anchorTop: () => anchor.getBoundingClientRect().top,
    heldPx: extra,
  };
}

const saved: SavedScrollPosition = { scrollTop: 1400, anchorId: "a1", anchorOffset: 0, anchorIndex: null, intraOffset: 0, savedAt: 0 };

beforeEach(() => {
  (globalThis as any).CSS = { escape: (s: string) => s };
  (globalThis as any).getComputedStyle = () => ({ paddingTop: `${BASE_PAD}px` });
});
afterEach(() => {
  delete (globalThis as any).CSS;
  delete (globalThis as any).getComputedStyle;
});

describe("holdGroundAboveAnchor — the page never moves under the reader", () => {
  it("lands the first frame at the saved position although the block above came back 228px shorter", () => {
    const p = page({ scrollTop: 0, naturalTop: 1172 });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    hold.update({ pin: true });
    expect(p.heldPx()).toBe(228);
    expect(p.container.scrollTop).toBe(1400);
    expect(p.anchorTop()).toBe(0);
  });

  it("gives the held space back as the block above regrows, and nothing on screen moves", () => {
    const p = page({ scrollTop: 0, naturalTop: 1172 });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    hold.update({ pin: true });
    p.state.naturalTop = 1300; // a header section arrived: +128px above the reader
    hold.update({ pin: true });
    expect(p.heldPx()).toBe(100);
    expect(p.container.scrollTop).toBe(1400);
    expect(p.anchorTop()).toBe(0);
    p.state.naturalTop = 1400; // everything is back
    hold.update({ pin: true });
    expect(hold.held()).toBe(0);
    expect(p.container.style.paddingTop).toBe(""); // the class's own padding again
    expect(p.anchorTop()).toBe(0);
  });

  it("re-pins by scrolling when the block above is TALLER than before (nothing to hold), while the reader hasn't touched the page", () => {
    const p = page({ scrollTop: 1400, naturalTop: 1450 });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    hold.update({ pin: true });
    expect(p.heldPx()).toBe(0);
    expect(p.container.scrollTop).toBe(1450);
    expect(p.anchorTop()).toBe(0);
  });

  it("keeps holding after the reader scrolls, but never writes scrollTop against their finger", () => {
    const p = page({ scrollTop: 0, naturalTop: 1172 });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    hold.update({ pin: true });
    p.state.scrollTop = 1600; // the reader scrolled on
    const before = p.anchorTop();
    p.state.naturalTop = 1300;
    hold.update({ pin: false });
    expect(p.heldPx()).toBe(100);
    expect(p.container.scrollTop).toBe(1600);
    expect(p.anchorTop()).toBe(before);
  });

  it("release drops any residual held space without moving what the reader is looking at", () => {
    const p = page({ scrollTop: 0, naturalTop: 1172 });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    hold.update({ pin: true });
    p.state.scrollTop = 1600;
    p.state.naturalTop = 1300;
    hold.update({ pin: false });
    const before = p.anchorTop();
    hold.release();
    expect(p.container.style.paddingTop).toBe("");
    expect(p.container.scrollTop).toBe(1500);
    expect(p.anchorTop()).toBe(before);
  });

  it("waits for the anchor row: seeds the saved scrollTop meanwhile, then holds the moment the row is on the page", () => {
    // The row list often mounts a commit after the page itself, so the first
    // pass can run before the anchor exists.
    const p = page({ scrollTop: 0, naturalTop: 1172, anchorMounted: false });
    const hold = holdGroundAboveAnchor(p.container, saved)!;
    expect(hold.update({ pin: true })).toBe(0);
    expect(hold.ready()).toBe(false);
    expect(p.container.scrollTop).toBe(1400);
    p.state.mounted = true;
    hold.update({ pin: true });
    expect(hold.ready()).toBe(true);
    expect(p.heldPx()).toBe(228);
    expect(p.container.scrollTop).toBe(1400);
    expect(p.anchorTop()).toBe(0);
  });

  it("is not available without an anchor id (the caller keeps the plain scrollTop path)", () => {
    const p = page({ scrollTop: 0, naturalTop: 1172 });
    expect(holdGroundAboveAnchor(p.container, { ...saved, anchorId: null })).toBeNull();
  });
});
