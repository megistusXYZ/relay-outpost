// Pure helpers for the Thread ancestor spine (X-style conversation context).
//
// These are intentionally UI-free so they can be unit-tested in isolation and
// reused by the Thread page's `AncestorPost` / root-marker rendering. The count
// values fed in here come from the SAME source NostrPost uses in the feed
// (`usePrimalStats` → `EventStats`), so an ancestor's engagement row and the
// focused post's action bar can never disagree about the numbers.

import { formatCount } from "@/lib/format-count";

export interface SpineCounts {
  replies: number;
  reposts: number;
  likes: number;
  zaps?: number;
}

/**
 * Build the compact engagement summary shown under an ancestor post, e.g.
 * "39 replies · 26 reposts · 29 likes". Only non-zero tallies appear; zeros are
 * hidden so a quiet parent stays quiet and a busy one visibly stands out.
 * Returns "" when nothing has engagement (caller hides the row entirely).
 */
export function formatEngagementSummary(counts: SpineCounts): string {
  const parts: string[] = [];
  const push = (n: number, singular: string) => {
    if (n > 0) parts.push(`${formatCount(n)} ${n === 1 ? singular : singular + "s"}`);
  };
  push(counts.replies, "reply");
  push(counts.reposts, "repost");
  push(counts.likes, "like");
  if (counts.zaps && counts.zaps > 0) push(counts.zaps, "zap");
  // "reply" pluralizes to "replys" via the naive rule above; fix that one case.
  return parts.join(" · ").replace(/\breplys\b/g, "replies");
}

/**
 * The root marker ("Start of conversation · N replies") only makes sense when
 * the focused post actually sits inside a larger conversation — i.e. there is at
 * least one ancestor above it. Given the number of ancestors in the spine,
 * decide whether to surface the marker on the top ancestor.
 */
export function shouldShowRootMarker(ancestorCount: number): boolean {
  return ancestorCount > 0;
}

/**
 * Label for the root marker. Appends the root's reply count when known (>0),
 * e.g. "Start of conversation · 39 replies"; otherwise just the lead-in so the
 * "you're inside a branch" signal still shows before counts have loaded.
 */
export function formatRootMarkerLabel(rootReplyCount: number): string {
  const base = "Start of conversation";
  if (rootReplyCount > 0) {
    return `${base} · ${formatCount(rootReplyCount)} ${rootReplyCount === 1 ? "reply" : "replies"}`;
  }
  return base;
}
