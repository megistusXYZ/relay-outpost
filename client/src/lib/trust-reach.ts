import type { ReachDepth } from "@/lib/spam-filter";

/**
 * Whether the For You feed's reach setting lets an author through.
 *
 * "No score" means unknown, not untrusted (owner decision, 2026-09-28): under
 * Balanced/Open ("global") an author with no score is shown, and the spam and
 * stranger-quality floors downstream decide. A score of 0 or below is a known
 * "no trust" and stays out. The narrow reaches (1/2/3 hops) are explicit
 * choices to see less, and keep leaving unknown authors out.
 */
export function reachAdmits(
  depth: ReachDepth,
  author: { followed: boolean; followOfFollow: boolean; score: number | undefined },
): boolean {
  if (depth === "off" || author.followed) return true;
  if (depth === "1hop") return false;
  if (author.followOfFollow) return true;
  if (depth === "2hops") return false;
  if (depth === "3hops") return author.score !== undefined;
  return author.score === undefined || author.score > 0;
}
