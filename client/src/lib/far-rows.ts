import { useEffect, type RefObject } from "react";

/**
 * Posts far from what you're reading stop drawing (index.css,
 * `.feed-post-item[data-far]`, phones only).
 *
 * A profile or thread keeps every post it has loaded in the page. Measured
 * 2026-10-06 (ship/far-rows-cost.cjs), a long profile on a phone held 84
 * posts drawn at once with 89 Mpx of decoded images (~360 MB) — the moment
 * it opened. On iPhone that is far past what WebKit keeps on screen, so it
 * starts dropping tiles: blank images and videos while scrolling, and even
 * a full-screen backdrop going see-through.
 *
 * Not `content-visibility: auto`, which decides per frame at the edge of the
 * screen and left posts blank mid-fling on iPhone (posts-always-drawn.test.ts).
 * Here every post within FAR_SCREENS of the screen, above or below, is
 * drawn; only the ones beyond that are marked, and they keep their height
 * (`contain-intrinsic-size: auto`), so nothing moves under the reader.
 */
export const FAR_SCREENS = 3;

// One observer per scroller; weakly held, so a page's own scroller (a
// profile has one) is not kept alive after the page goes.
const byScroller = new WeakMap<Element, IntersectionObserver>();
let byViewport: IntersectionObserver | null = null;

function observerFor(root: Element | null): IntersectionObserver {
  let io = root ? byScroller.get(root) : byViewport;
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) e.target.removeAttribute("data-far");
          else e.target.setAttribute("data-far", "");
        }
      },
      // A margin needs the scroller as root, or <main> clips it to 0
      // (lib/scroll-root.ts).
      { root, rootMargin: `${FAR_SCREENS * 100}% 0px` },
    );
    if (root) byScroller.set(root, io);
    else byViewport = io;
  }
  return io;
}

/**
 * The box the row actually scrolls in: the nearest scrolling ancestor no
 * taller than the screen. A phone profile's own box is `overflow-y: auto` yet
 * grows to all its posts (41,000px measured) while <main> does the scrolling —
 * a margin of "three screens" of THAT box covers every post.
 */
function scrollerOf(row: Element): Element | null {
  for (let node = row.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.clientHeight <= window.innerHeight + 1) return node;
  }
  return null;
}

/** Mark the row as far whenever it is more than FAR_SCREENS screens away. */
export function useFarRow(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof IntersectionObserver === "undefined") return;
    const io = observerFor(scrollerOf(row));
    io.observe(row);
    return () => {
      io.unobserve(row);
      row.removeAttribute("data-far");
    };
  }, [ref]);
}
