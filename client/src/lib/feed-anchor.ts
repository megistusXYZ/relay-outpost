/**
 * Pure index-anchor math for restoring a VIRTUALIZED feed by row INDEX rather
 * than by a raw pixel offset.
 *
 * ### Why index, not pixels (the real-device bug this fixes)
 * `@tanstack/react-virtual` maps a pixel scroll offset onto a row index through
 * its measurement cache, which — on a fresh remount (back → feed) — is seeded
 * entirely from a FLAT per-row estimate (e.g. 360px). Real rows vary wildly
 * (120–600px: text vs. media vs. quoted-note cards), so a saved *pixel* offset
 * resolves to the WRONG row on return: the anchor the user actually left from is
 * not in the mounted range, the DOM anchor lookup (`[data-event-id=…]`) returns
 * null, and the restorer chases an estimated `scrollHeight` that shifts every
 * frame as rows measure — the visible "sloppy load / shake".
 *
 * Restoring by INDEX sidesteps the estimate entirely: we remember WHICH row was
 * at the top (its index in the pinned items list) plus how far it was scrolled
 * past its own top (`intraOffset`). On return, `virtualizer.scrollToIndex(index)`
 * forces that exact row to mount and measure regardless of height estimates, so
 * the DOM anchor is actually present and the existing fine-tune can finish.
 *
 * These helpers are intentionally pure (no React, no DOM, no virtual-core
 * import) so the index math is unit-testable. NOTE: jsdom/vitest cannot run
 * react-virtual's real measurement loop, so the tests cover this math — the live
 * virtualizer behaviour is gated on a real device.
 */

/** One virtualized row's position in the virtualizer's coordinate space. */
export interface RowRect {
  /** The row's index in the items list. */
  index: number;
  /** The row's top offset (px) in the scroll container's coordinate space. */
  start: number;
  /** The row's measured (or estimated) height (px). */
  size: number;
}

/** An index anchor: which row sat at the viewport top and by how much. */
export interface IndexAnchor {
  /** Index of the row at/just-above the viewport top. */
  index: number;
  /** How far the container was scrolled past that row's top (px). */
  intraOffset: number;
}

/** The saved anchor fields resolved against the (possibly changed) items list. */
export interface SavedIndexAnchor {
  /** `data-event-id` of the anchor row (identity across list changes). */
  anchorId: string | null;
  /** Row index of the anchor within the pinned items list, if known. */
  anchorIndex: number | null;
  /** Pixels scrolled past the anchor row's top. */
  intraOffset: number;
}

/**
 * Given the virtualizer's current rows (sorted ascending by `start`) and the
 * container's `scrollTop`, pick the row sitting at the viewport top and the
 * pixels scrolled past its top.
 *
 * This is the row a pixel→index estimate gets WRONG when heights vary: the flat
 * estimate places `scrollTop / estimate` while the real top row is wherever the
 * measured cumulative heights actually land.
 */
export function computeIndexAnchor(rows: RowRect[], scrollTop: number, viewportHeight?: number): IndexAnchor | null {
  if (rows.length === 0) return null;
  // When the viewport height is known, prefer the FIRST FULLY-VISIBLE row (the
  // one the user is actually reading, negative intraOffset = it sits below the
  // top edge). Anchoring on the row STRADDLING the top edge left a residual
  // drift: that row is mostly scrolled past, and when its media/embeds
  // re-measure on back-return, everything below it shifts by the delta even
  // though the anchor's own offset restores perfectly. A very tall straddling
  // row (no row starts inside the viewport) falls through to the classic pick.
  if (viewportHeight != null && viewportHeight > 0) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].start >= scrollTop) {
        if (rows[i].start < scrollTop + viewportHeight) {
          return { index: rows[i].index, intraOffset: scrollTop - rows[i].start };
        }
        break; // first at/after the top edge is already below the fold → straddle
      }
    }
  }
  // The row at the top edge is the LAST row whose top is at/above scrollTop.
  // (If scrollTop is above the first row — overscroll/top of list — fall back to
  // the first row with a negative intraOffset.)
  let chosen = rows[0];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].start <= scrollTop) chosen = rows[i];
    else break;
  }
  return { index: chosen.index, intraOffset: scrollTop - chosen.start };
}

/**
 * Resolve a saved index anchor against the current items list to the arguments
 * a `scrollToIndex`-based restore needs.
 *
 * Prefers the saved index when the id at that index still matches (the pinned
 * snapshot keeps this stable across the thread round-trip); otherwise relocates
 * the anchor by id (list shifted); returns null when the anchor row is gone
 * entirely, so the caller falls back to the pixel path.
 */
export function resolveRestoreTarget<T>(
  saved: SavedIndexAnchor,
  items: T[],
  getId: (item: T) => string,
): { index: number; intraOffset: number } | null {
  const { anchorId, anchorIndex, intraOffset } = saved;

  if (anchorIndex != null && anchorIndex >= 0 && anchorIndex < items.length) {
    if (anchorId == null || getId(items[anchorIndex]) === anchorId) {
      return { index: anchorIndex, intraOffset };
    }
  }

  if (anchorId != null) {
    for (let i = 0; i < items.length; i++) {
      if (getId(items[i]) === anchorId) return { index: i, intraOffset };
    }
  }

  return null;
}

/**
 * The pre-fix pixel→index mapping, kept ONLY so tests can demonstrate it picks
 * the wrong row on variable-height feeds. This is what a flat-estimate
 * virtualizer effectively did with a saved pixel offset. Do not use in
 * production.
 */
export function estimatePixelIndex(scrollTop: number, estimateWithGap: number): number {
  return Math.floor(scrollTop / estimateWithGap);
}
