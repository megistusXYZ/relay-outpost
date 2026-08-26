/**
 * Bridge between the app-level scroll-restoration logic (App.tsx `ScrollToTop` /
 * `useScrollRestore`) and the virtualized feed (`VirtualFeed`).
 *
 * Scroll restoration works by finding a saved post's `[data-event-id]` element
 * and scrolling it to the top. Under virtualization a row far from the current
 * viewport isn't in the DOM, so that lookup fails and the retry loop can never
 * succeed on its own — the row won't mount until something scrolls near its
 * offset.
 *
 * The mounted VirtualFeed registers a bridge here that lets the generic
 * restorer:
 *   1. CAPTURE an index anchor at save time — which row is at the viewport top
 *      (its index in the pinned items list) + how far it's scrolled past that
 *      row's top — so a back-return can restore by ROW INDEX instead of by a raw
 *      pixel offset (which resolves to the wrong row under flat height
 *      estimates). See lib/feed-anchor.ts.
 *   2. SCROLL a given event id's row into view via the virtualizer's
 *      `scrollToIndex`, which forces the target row to mount and measure so the
 *      DOM-based fine-tune can take over.
 */

export interface FeedScrollBridge {
  /**
   * Ask the virtualized feed to scroll a given event's row into view.
   * Returns true if this feed owns the id (it exists in the list), false
   * otherwise so the caller can fall back to the plain DOM path.
   */
  scrollToEventId: (eventId: string) => boolean;
  /**
   * Capture the current top-of-viewport row as an index anchor, or null when the
   * feed can't produce one (no rows, no scroll element yet).
   */
  captureAnchor: () => { anchorId: string | null; anchorIndex: number; intraOffset: number } | null;
}

let bridge: FeedScrollBridge | null = null;

/** Called by the mounted VirtualFeed; pass null on unmount. */
export function setFeedScrollBridge(b: FeedScrollBridge | null) {
  bridge = b;
}

/**
 * Ask the active virtualized feed to scroll a given event's row into view.
 * Returns true if a feed handled it, false if there's no virtualized feed or the
 * id isn't in it (caller falls back to the plain DOM path).
 */
export function tryVirtualScrollToEventId(eventId: string): boolean {
  return bridge ? bridge.scrollToEventId(eventId) : false;
}

/**
 * Capture an index anchor from the active virtualized feed, or null when no
 * virtualized feed is mounted (non-feed surfaces keep the pixel path).
 */
export function captureFeedIndexAnchor(): { anchorId: string | null; anchorIndex: number; intraOffset: number } | null {
  return bridge ? bridge.captureAnchor() : null;
}
