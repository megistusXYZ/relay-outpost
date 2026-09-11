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

/**
 * Take the page back to its top, as X does when you re-tap the tab you're on.
 * Scrolls the app's `<main>` and any inner page scroller that is scrolled (a
 * profile has its own). Anything inside `[inert]` is skipped: that is the
 * kept-alive Home layer, frozen at its Back position, and moving it would
 * break exactly the return it exists for.
 */
export function scrollPageToTop(root: Element | null = typeof document !== "undefined" ? document.querySelector("main") : null): void {
  if (!root) return;
  const scrollers = [root, ...root.querySelectorAll(".overflow-y-auto, .overflow-auto")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.scrollTop > 0 && !el.closest("[inert]"),
  );
  for (const el of scrollers) el.scrollTo({ top: 0, behavior: "smooth" });
}
