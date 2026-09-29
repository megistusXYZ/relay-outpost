import type { EventStats } from "./primal-cache";

type CountField = "replies" | "reposts" | "likes" | "zaps";

/**
 * The count a post shows after your own action, before the stats server has
 * indexed it: one field moved by `delta`, floored at zero, the rest untouched.
 * A post with no counts yet starts from zeros, so your repost of a fresh post
 * reads 1, not nothing.
 */
export function adjustStats(existing: EventStats | undefined, field: CountField, delta: number): EventStats {
  const base: EventStats = existing ?? { replies: 0, reposts: 0, likes: 0, zaps: 0, zapAmount: 0 };
  return { ...base, [field]: Math.max(0, base[field] + delta) };
}
