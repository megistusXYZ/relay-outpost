/**
 * Where each new follower stands with you (lib/follower-standing.ts): your
 * network's view of them, and which people you follow follow them too. Used by
 * the Activity page's follow rows and by the Activity badge, so both agree.
 */
import { useCallback, useMemo } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useGrapeRankScores } from "@/contexts/GrapeRankScoresContext";
import { useFollowsOfFollows } from "@/hooks/use-follows-of-follows";
import { followerStanding, type FollowerStanding } from "@/lib/follower-standing";

/** Contact lists the shared-follows check needs before it may call anyone "outside". */
const COVERAGE_NEEDED = 0.5;
const MAX_FOLLOWS_FETCHED = 150;

export function useFollowerStanding() {
  const { follows } = useNostrAuth();
  const { getAuthorTier, isAuthorFlagged, wotEnabled, wotReady } = useGrapeRankScores();
  const { fofBy, coverage } = useFollowsOfFollows(follows);
  const followSet = useMemo(() => new Set(follows ?? []), [follows]);
  const listsLoaded = coverage.total === 0 || coverage.fetched >= Math.min(coverage.total, MAX_FOLLOWS_FETCHED) * COVERAGE_NEEDED;
  const ready = listsLoaded && (!wotEnabled || wotReady);

  const sharedOf = useCallback((pk: string): string[] => fofBy.get(pk) ?? [], [fofBy]);
  const standingOf = useCallback((pk: string): FollowerStanding => followerStanding({
    tier: getAuthorTier(pk),
    flagged: isAuthorFlagged(pk),
    // Someone you follow already is tied to you, whatever else is true.
    sharedCount: sharedOf(pk).length + (followSet.has(pk) ? 1 : 0),
    ready,
  }), [getAuthorTier, isAuthorFlagged, sharedOf, followSet, ready]);

  return useMemo(() => ({ standingOf, sharedOf, ready }), [standingOf, sharedOf, ready]);
}
