/**
 * How many faces the Circle shows, so it fills its box on any screen.
 *
 * The card used to show eight, whatever the width: on a tablet a row of eight
 * stopped two thirds of the way across, on a wide rail it left a ragged
 * second row. The number is a function of the width, not a number to hard
 * code: whole rows on the desktop rail, and on a phone or tablet a strip that
 * scrolls, with a fade saying so.
 */
export const FACE = 48;
export const GAP = 12;
/** More than this in a strip is a wall of heads nobody scrolls through. */
export const STRIP_CAP = 24;
const GRID_ROWS = 2;

/** Faces per row for a width. `face` and `gap` are the RENDERED sizes when
 *  known — the page scales with the root font size, so 48px is not always 48. */
export function facesPerRow(width: number, face = FACE, gap = GAP): number {
  if (!(width > 0) || !(face > 0)) return 0;
  return Math.max(1, Math.floor((width + gap) / (face + gap)));
}

/** The desktop rail: whole rows only, up to two. Everyone when they don't fill a row. */
export function circleGridCount(width: number, available: number, metrics?: { face: number; gap: number }): number {
  const perRow = facesPerRow(width, metrics?.face, metrics?.gap);
  if (perRow === 0) return available;
  if (available <= perRow) return available;
  const rows = Math.min(GRID_ROWS, Math.floor(available / perRow));
  return rows * perRow;
}

/** The scrolling strip: everyone, up to the cap. */
export function circleStripCount(available: number): number {
  return Math.min(available, STRIP_CAP);
}
