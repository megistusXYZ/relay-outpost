/**
 * Anchor capture must never land on a hidden, kept-alive surface.
 *
 * The Home keep-alive layer (components/HomeKeepAlive.tsx) keeps the feed's
 * rows mounted — `inert`, invisible, zero-height — underneath a thread or
 * profile that shares the same `<main>` scroller. Those rows still have
 * layout boxes, so a position-based anchor pick can see them. An anchor saved
 * for the THREAD's history entry that names a hidden Home row would restore
 * the thread to a row that isn't on screen.
 */
import { describe, expect, it } from "vitest";
import { captureScrollAnchor } from "./scroll-restore";

// Node test env (no DOM): only the surface captureScrollAnchor touches.
function row(id: string, top: number, insideInertLayer = false) {
  return {
    getBoundingClientRect: () => ({ top }),
    getAttribute: (name: string) => (name === "data-event-id" ? id : null),
    closest: (selector: string) => (insideInertLayer && selector.includes("inert") ? {} : null),
  };
}
function container(rows: ReturnType<typeof row>[]) {
  return { getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => rows } as unknown as HTMLElement;
}

describe("captureScrollAnchor — never anchors on a hidden, kept-alive surface", () => {
  it("skips rows inside an inert layer even when they sit inside the anchor band", () => {
    const anchor = captureScrollAnchor(container([row("thread-row", 30), row("hidden-home-row", 50, true)]));
    expect(anchor?.id).toBe("thread-row");
  });
});
