// @vitest-environment jsdom
/**
 * Feed media mounts MEDIA_MOUNT_LEAD (1500px) before it scrolls into view, so
 * an image's shape is learned and its box settled while it is still off
 * screen. On iOS, which has no scroll anchoring, a box that settles in view
 * shoves the post you are reading: the scroll-up jump.
 *
 * The lead was silently zero: the app scrolls inside <main>, and an
 * IntersectionObserver with the default root clips by <main> before applying
 * the margin (measured on WebKit, see lib/scroll-root.test.ts). jsdom has no
 * IntersectionObserver, so a recorder stands in for it: the contract under
 * test is what the observer is ASKED to measure, which is exactly what was
 * wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeNear } from "./use-near-viewport";
import { MEDIA_MOUNT_LEAD } from "@/lib/media-ratio";

type Recorded = { options: IntersectionObserverInit | undefined; fire: (isIntersecting: boolean) => void; disconnected: boolean };
let observers: Recorded[] = [];

beforeEach(() => {
  observers = [];
  class RecordingObserver {
    private rec: Recorded;
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rec = {
        options,
        disconnected: false,
        fire: (isIntersecting) => cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
      };
      observers.push(this.rec);
    }
    observe() {}
    unobserve() {}
    disconnect() { this.rec.disconnected = true; }
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", RecordingObserver);
});

afterEach(() => { vi.unstubAllGlobals(); });

function feedWithMedia() {
  document.body.innerHTML = `
    <main id="scroller" style="overflow-y: auto; height: 600px">
      <article style="overflow: hidden"><div id="media"></div></article>
    </main>
  `;
  return { scroller: document.getElementById("scroller")!, media: document.getElementById("media")! };
}

describe("observeNear — the media mount lead", () => {
  it("measures the lead against the scroller the feed scrolls in, not the clipped viewport", () => {
    const { scroller, media } = feedWithMedia();
    observeNear(media, () => {});
    expect(observers).toHaveLength(1);
    expect(observers[0].options?.root).toBe(scroller);
    expect(observers[0].options?.rootMargin).toBe(MEDIA_MOUNT_LEAD);
  });

  it("reports near once, then stops watching", () => {
    const { media } = feedWithMedia();
    const onNear = vi.fn();
    observeNear(media, onNear);
    observers[0].fire(false);
    expect(onNear).not.toHaveBeenCalled();
    observers[0].fire(true);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(observers[0].disconnected).toBe(true);
  });
});
