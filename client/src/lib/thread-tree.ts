// Pure layout/bounding decisions for the reply-thread tree (Reddit-mobile
// pattern). Kept free of React/DOM so the rules are unit-testable:
//
// - Visual indent stops at a responsive cap (2 levels on phones, 5 on
//   desktop). Deeper replies render AT the cap's indent with a "↳ @parent"
//   cue instead of squeezing content further.
// - Replies expand by default at every depth. The only automatic folding is
//   per-LEVEL sibling overflow: a level with more than SIBLING_OVERFLOW_LIMIT
//   replies shows the first chunk plus one "Show N more replies" row.
// - A branch that would nest deeper than (cap + BRANCH_CONTINUE_EXTRA) stops
//   rendering inline and becomes a single "Continue thread →" row that
//   re-roots the thread route on that branch's top event.
//
// Together the sibling limit + branch cutoff bound how many nodes an
// expanded-by-default thread mounts, which is why this ships without
// virtualization.

/** Visual indent cap on narrow (<640px) viewports. */
export const MOBILE_THREAD_INDENT_CAP = 2;

/** Visual indent cap on >=640px viewports. */
export const DESKTOP_THREAD_INDENT_CAP = 5;

/** Max siblings shown per level before folding into one "Show N more" row. */
export const SIBLING_OVERFLOW_LIMIT = 8;

/**
 * How many levels past the indent cap a branch may nest before it is cut
 * off into a "Continue thread →" re-root row.
 */
export const BRANCH_CONTINUE_EXTRA = 4;

/** Media query matching the viewports that get the mobile indent cap. */
export const NARROW_THREAD_MEDIA_QUERY = "(max-width: 639px)";

export function getThreadIndentCap(isNarrow: boolean): number {
  return isNarrow ? MOBILE_THREAD_INDENT_CAP : DESKTOP_THREAD_INDENT_CAP;
}

export interface SiblingPartition<T> {
  visible: T[];
  overflow: T[];
}

/**
 * Per-level sibling overflow: levels with more than `limit` replies show the
 * first `limit` plus one "Show N more replies" row for the rest. Order is
 * preserved (callers sort before partitioning).
 */
export function partitionSiblings<T>(
  siblings: readonly T[],
  limit: number = SIBLING_OVERFLOW_LIMIT,
): SiblingPartition<T> {
  if (siblings.length <= limit) {
    return { visible: [...siblings], overflow: [] };
  }
  return { visible: siblings.slice(0, limit), overflow: siblings.slice(limit) };
}

/**
 * Branch cutoff: a node at `depth` with children stops rendering them inline
 * once the subtree would nest beyond (indentCap + BRANCH_CONTINUE_EXTRA)
 * levels — the children are replaced by one "Continue thread →" row that
 * re-roots the thread page on this node.
 */
export function shouldContinueThread(
  depth: number,
  indentCap: number,
  hasChildren: boolean,
): boolean {
  if (!hasChildren) return false;
  return depth >= indentCap + BRANCH_CONTINUE_EXTRA;
}

/**
 * Whether a node at `depth` renders its own rail/indent column. Rails exist
 * only within the visible indent cap; deeper nodes render flush at the cap's
 * indent (with the "↳ @parent" cue supplying context instead).
 */
export function rendersIndentColumn(depth: number, indentCap: number): boolean {
  return depth < indentCap;
}

/**
 * Whether a node at `depth` is rendered AT the clamped indent (its real depth
 * exceeds the visual cap), which is when the "↳ @parent" cue shows.
 */
export function isBeyondIndentCap(depth: number, indentCap: number): boolean {
  return depth >= indentCap;
}
