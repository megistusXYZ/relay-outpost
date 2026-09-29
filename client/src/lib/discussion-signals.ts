import type { Event } from "nostr-tools";
import { getFirstSeen } from "@/lib/account-age";
import { getCachedFollowerCount, primalStatsCache } from "@/lib/primal-cache";
import { computeEngagementScore } from "@/lib/engagement";

/**
 * The stranger-quality floor's real signals (account age, follower count,
 * engagement), for the discussion trust gate. Comment notifications and news
 * discussions passed it only a trust score, so with scores missing an
 * unscored stranger had nothing else to show and was dropped unless they did
 * proof-of-work. "No score" means unknown (owner decision, 2026-09-28): judge
 * them on what else is known.
 */
export function discussionSignals() {
  return {
    firstSeenGetter: (pk: string) => getFirstSeen(pk),
    followerCountGetter: (pk: string) => getCachedFollowerCount(pk),
    engagementScoreGetter: (e: Event) => computeEngagementScore(primalStatsCache.get(e.id) ?? null),
  };
}
