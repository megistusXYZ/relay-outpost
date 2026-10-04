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

import type { Event } from "nostr-tools";
import { replyTargetOf } from "./reply-target";

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
  /** Always shown, even past the limit: the reply you just sent. */
  keep?: (item: T) => boolean,
): SiblingPartition<T> {
  if (siblings.length <= limit) {
    return { visible: [...siblings], overflow: [] };
  }
  const rest = siblings.slice(limit);
  if (!keep) return { visible: siblings.slice(0, limit), overflow: rest };
  return {
    visible: [...siblings.slice(0, limit), ...rest.filter(keep)],
    overflow: rest.filter((x) => !keep(x)),
  };
}

/**
 * Where the reply box sits (owner, 2026-10-04: a reply to a comment landed "in
 * a funky spot"). A conversation reads post → replies → box, so what you send
 * appears right above where you wrote it; newest-first flips the replies, so
 * the box goes on top, where the new one appears.
 */
export function replyBoxPlacement(sort: "oldest" | "newest"): "before" | "after" {
  return sort === "newest" ? "before" : "after";
}

export interface ThreadNode {
  event: Event;
  children: ThreadNode[];
}

/**
 * The reply tree under `rootId`: each reply under the one it answers, oldest
 * first at every level. A reply to something not in the thread is shown as a
 * reply to the post rather than dropped.
 */
export function buildThreadTree(replies: Event[], rootId: string): ThreadNode[] {
  const dedupIds = new Set<string>();
  const dedupedReplies = replies.filter((r) => {
    if (dedupIds.has(r.id)) return false;
    dedupIds.add(r.id);
    return true;
  });
  const replyIds = new Set(dedupedReplies.map((r) => r.id));
  replyIds.add(rootId);
  const byParent = new Map<string, Event[]>();

  for (const reply of dedupedReplies) {
    let parentId = replyTargetOf(reply);
    if (parentId && !replyIds.has(parentId)) {
      parentId = rootId;
    }
    const target = parentId || rootId;
    const existing = byParent.get(target) || [];
    existing.push(reply);
    byParent.set(target, existing);
  }

  function buildChildren(parentId: string, depth: number, ancestors: Set<string>): ThreadNode[] {
    const children = byParent.get(parentId) || [];
    return children
      // Guard against reply cycles / self-replies so we never recurse forever.
      .filter((e) => !ancestors.has(e.id))
      .sort((a, b) => a.created_at - b.created_at)
      .map((event) => {
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(event.id);
        return {
          event,
          // Recurse the FULL tree — deep replies keep their children (previously
          // anything past depth 5 was discarded). A high hard cap is a backstop.
          children: depth >= 60 ? [] : buildChildren(event.id, depth + 1, nextAncestors),
        };
      });
  }

  return buildChildren(rootId, 0, new Set([rootId]));
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
