// Pure, testable layout math for the DESKTOP News "magazine" (front-page) view.
//
// The mobile News reader is a single centered column. On desktop (≥ lg) the same
// merged/ordered/clustered item list is re-laid-out as an editorial front page:
// a lead HERO, a small SECONDARY rail beside it, then the remaining stories in a
// responsive card GRID. This module owns the one non-trivial decision in that
// re-layout — how the already-ordered "rest" list (everything below the hero) is
// split into the rail and the grid, and where the grid's read boundary falls —
// so the component stays a thin renderer and the buckets are unit-tested.
//
// It is source-agnostic (operates on an opaque item type + an isRead predicate),
// mirroring lib/rss-merge so it composes with the same MergedItem<RSSItem> list.

export interface MagazineSplit<T> {
  /** The secondary column beside the hero — the first `railCount` rest items. */
  rail: T[];
  /** Everything after the rail, in order — flows into the responsive card grid. */
  grid: T[];
  /**
   * Index within `grid` of the first READ item, or -1 when the grid has none.
   * Drives the "Caught up" divider between fresh and already-read grid cards.
   * Only meaningful for unread-first ordering (a chronological list has no
   * read/unread boundary); the caller decides whether to render the divider.
   */
  gridReadStart: number;
}

/**
 * Split the ordered below-hero list into the rail (secondary column) and the
 * grid. The `rest` list is assumed already ordered by the caller (unread-first
 * or latest) AND already story-cluster-collapsed + hero-removed — this function
 * does no sorting, it only partitions.
 *
 * The rail takes the first `railCount` items verbatim (in unread-first order
 * these are the freshest stories, so the lead block stays fresh). The grid takes
 * the remainder. `railCount` is clamped to [0, rest.length]; a non-finite or
 * negative count yields an empty rail (grid gets everything).
 *
 * Pure and allocation-light: returns shallow slices of the input, so memoized
 * re-renders that pass the same list produce structurally stable buckets.
 */
export function splitMagazine<T>(
  rest: T[],
  railCount: number,
  isRead: (item: T) => boolean,
): MagazineSplit<T> {
  const n = Number.isFinite(railCount) ? Math.max(0, Math.min(railCount, rest.length)) : 0;
  const rail = rest.slice(0, n);
  const grid = rest.slice(n);
  const gridReadStart = grid.findIndex((item) => isRead(item));
  return { rail, grid, gridReadStart };
}

// ── Column-aware diversity ───────────────────────────────────────────────────
// The card grid is filled ROW-MAJOR into an N-column CSS grid, so the cards at
// list positions i and i+N land in the SAME column, stacked vertically. The
// linear diversity pass (lib/rss-merge) only guarantees horizontal neighbours
// differ; it says nothing about vertical ones, so a column can still stack two
// cards from the same outlet. These helpers add the missing guarantee: reorder
// the grid so item i and item i+stride differ in source, where `stride` is the
// live column count (2/3/4 by breakpoint). The mobile single column is stride 1
// — the linear guarantee already covers it — so callers pass 1 (or <2) for a
// no-op. Pure, allocation-light, and idempotent on their own output.

/**
 * Reorder `items` so that, wherever possible, no two items `stride` positions
 * apart share a key (their grid column won't stack the same source). Greedy
 * pull-forward, mirroring lib/rss-merge's linear pass but with a lookback of
 * `stride` instead of 1: when the next item would clash with the one `stride`
 * back, the nearest later item with a different key is pulled in front. Relative
 * order is otherwise preserved. `stride < 2` or a too-short list is returned
 * unchanged.
 */
export function diversifyByStride<T>(
  items: T[],
  stride: number,
  keyOf: (item: T) => string,
): T[] {
  if (stride < 2 || items.length <= stride) return items;

  const queue = [...items];
  const result: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    // The already-placed item in the same column (stride slots back).
    const clashKey = result.length >= stride ? keyOf(result[result.length - stride]) : null;
    if (clashKey !== null && keyOf(cur) === clashKey) {
      const altIdx = queue.findIndex((m, j) => j > i && keyOf(m) !== clashKey);
      if (altIdx !== -1) {
        const [alt] = queue.splice(altIdx, 1);
        queue.splice(i, 0, alt);
        result.push(alt);
        continue;
      }
    }
    result.push(cur);
  }
  return result;
}

/**
 * Column-diversify a magazine grid while respecting its read boundary: the
 * unread head (before `gridReadStart`) and the read tail are diversified
 * INDEPENDENTLY, so no read card is ever pulled above the "Caught up" divider.
 * The boundary index is unchanged (each segment keeps its length), so the
 * caller reuses the original `gridReadStart`. `stride < 2` returns the grid
 * untouched (mobile / single column).
 */
export function diversifyGrid<T>(
  grid: T[],
  gridReadStart: number,
  stride: number,
  keyOf: (item: T) => string,
): T[] {
  if (stride < 2 || grid.length <= stride) return grid;
  if (gridReadStart < 0) return diversifyByStride(grid, stride, keyOf);
  const unread = diversifyByStride(grid.slice(0, gridReadStart), stride, keyOf);
  const read = diversifyByStride(grid.slice(gridReadStart), stride, keyOf);
  return [...unread, ...read];
}
