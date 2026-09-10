// @vitest-environment jsdom
/**
 * Which element does this element scroll inside?
 *
 * Found 2026-09-10 on a real iPhone (iOS Simulator, WebKit): feed images were
 * meant to mount 1500px before they scroll into view (MEDIA_MOUNT_LEAD), so
 * their shape is known and settled off-screen. They actually mounted only once
 * visible. The feed scrolls inside <main>, not the window, and an
 * IntersectionObserver with the default root clips its target by every
 * scrolling ancestor BEFORE applying rootMargin, so the lead was zero.
 * Measured on WebKit: a target 1000px below the fold of a scroll container
 * reports isIntersecting=false with the default root and a 1500px margin, and
 * true with root = the container. Each late image then settled from its 160px
 * placeholder to its real height in view: with no scroll anchoring on iOS,
 * that is the scroll-up jump.
 */
import { describe, expect, it } from "vitest";
import { scrollRootFor } from "./scroll-root";

function mount(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("scrollRootFor", () => {
  it("is the nearest ancestor that scrolls vertically, the box the feed actually scrolls in", () => {
    const doc = mount(`
      <main id="scroller" style="overflow-y: auto; height: 600px">
        <article><div><div id="media"></div></div></article>
      </main>
    `);
    expect(scrollRootFor(doc.getElementById("media"))).toBe(doc.getElementById("scroller"));
  });

  it("passes over a box that clips without scrolling, like a rounded post card", () => {
    const doc = mount(`
      <main id="scroller" style="overflow-y: auto; height: 600px">
        <article style="overflow: hidden"><div id="media"></div></article>
      </main>
    `);
    expect(scrollRootFor(doc.getElementById("media"))).toBe(doc.getElementById("scroller"));
  });

  it("is null when nothing between the element and the document scrolls, so the viewport is the root", () => {
    const doc = mount(`<article><div id="media"></div></article>`);
    expect(scrollRootFor(doc.getElementById("media"))).toBeNull();
  });
});
