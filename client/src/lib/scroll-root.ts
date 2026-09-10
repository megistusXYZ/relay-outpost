/**
 * The element an element scrolls inside: its nearest ancestor that scrolls
 * vertically, or null when nothing below the document does (the viewport).
 *
 * Pass it as an IntersectionObserver `root` whenever the observer has a
 * rootMargin. With the default root, the target is clipped by every scrolling
 * ancestor BEFORE the margin applies, so inside <main> (where the whole app
 * scrolls) a "1500px early" margin silently becomes 0px. Measured on WebKit
 * 2026-09-10: see scroll-root.test.ts.
 */
export function scrollRootFor(el: Element | null): Element | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}
