import { useState, useEffect, useCallback } from "react";
import {
  fetchProfileBadgesList,
  fetchBadgeAwardsForUser,
  fetchBadgeDefinitions,
  clearBadgeCache,
  getCachedProfileBadges,
  getCachedBadgeDef,
  type BadgeDefinition,
  type BadgeAward,
} from "@/lib/nip58-badges";

export interface ResolvedBadge {
  badgeRef: string;
  awardEventId: string;
  definition: BadgeDefinition;
  award?: BadgeAward;
  awarderPubkey: string;
  awardedAt: number;
  isAccepted: boolean;
}

export function useBadges(pubkey: string | null) {
  const [badges, setBadges] = useState<ResolvedBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (pk: string) => {
    setLoading(true);
    try {
      const [profileBadges, awards] = await Promise.all([
        fetchProfileBadgesList(pk),
        fetchBadgeAwardsForUser(pk),
      ]);

      const acceptedList = profileBadges?.badges || [];
      const acceptedKeys = new Set(
        acceptedList.map(b => `${b.badgeRef}:${b.awardEventId}`)
      );

      if (acceptedList.length === 0 && awards.length === 0) {
        setBadges([]);
        setLoaded(true);
        setLoading(false);
        return;
      }

      const aTagsToFetch = new Set<string>();
      for (const b of acceptedList) aTagsToFetch.add(b.badgeRef);
      for (const a of awards) aTagsToFetch.add(a.badgeRef);

      const defs = await fetchBadgeDefinitions(Array.from(aTagsToFetch));

      const awardById = new Map<string, BadgeAward>();
      const awardsByRef = new Map<string, BadgeAward[]>();
      for (const a of awards) {
        if (a.awardedTo.includes(pk)) {
          awardById.set(a.id, a);
          const list = awardsByRef.get(a.badgeRef) || [];
          list.push(a);
          awardsByRef.set(a.badgeRef, list);
        }
      }

      const resolved: ResolvedBadge[] = [];
      const seenKeys = new Set<string>();

      for (const ab of acceptedList) {
        const key = `${ab.badgeRef}:${ab.awardEventId}`;
        if (seenKeys.has(key)) continue;
        const def = defs.get(ab.badgeRef);
        if (!def) continue;
        seenKeys.add(key);
        const award = awardById.get(ab.awardEventId);
        resolved.push({
          badgeRef: ab.badgeRef,
          awardEventId: ab.awardEventId,
          definition: def,
          award,
          awarderPubkey: award?.pubkey || def.pubkey,
          awardedAt: award?.createdAt || def.createdAt,
          isAccepted: true,
        });
      }

      for (const [ref, refAwards] of awardsByRef) {
        const def = defs.get(ref);
        if (!def) continue;
        for (const award of refAwards) {
          const key = `${ref}:${award.id}`;
          if (seenKeys.has(key)) continue;
          if (acceptedKeys.has(key)) continue;
          seenKeys.add(key);
          resolved.push({
            badgeRef: ref,
            awardEventId: award.id,
            definition: def,
            award,
            awarderPubkey: award.pubkey,
            awardedAt: award.createdAt,
            isAccepted: false,
          });
        }
      }

      resolved.sort((a, b) => {
        if (a.isAccepted !== b.isAccepted) return a.isAccepted ? -1 : 1;
        return b.awardedAt - a.awardedAt;
      });
      setBadges(resolved);
    } catch (err) {
      console.error("[NIP-58] Failed to load badges:", err);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!pubkey) {
      setBadges([]);
      setLoaded(false);
      return;
    }
    load(pubkey);
  }, [pubkey, load]);

  const refresh = useCallback(() => {
    if (!pubkey) return;
    clearBadgeCache(pubkey);
    load(pubkey);
  }, [pubkey, load]);

  return { badges, loading, loaded, refresh };
}

const feedBadgeFetchedSet = new Set<string>();
const feedBadgePendingQueue = new Set<string>();
let feedBadgeFlushTimer: ReturnType<typeof setTimeout> | null = null;
const feedBadgeListeners = new Map<string, Set<() => void>>();

function notifyFeedBadgeListeners(pubkey: string) {
  const listeners = feedBadgeListeners.get(pubkey);
  if (listeners) listeners.forEach(fn => fn());
}

function flushFeedBadgeQueue() {
  feedBadgeFlushTimer = null;
  const batch = [...feedBadgePendingQueue];
  feedBadgePendingQueue.clear();
  if (batch.length === 0) return;

  for (const pk of batch) feedBadgeFetchedSet.add(pk);

  Promise.allSettled(batch.map(async (pk) => {
    const profileBadges = await fetchProfileBadgesList(pk);
    if (!profileBadges || profileBadges.badges.length === 0) return;
    const aTagsToFetch = profileBadges.badges.map(b => b.badgeRef);
    await fetchBadgeDefinitions(aTagsToFetch);
    notifyFeedBadgeListeners(pk);
  }));
}

function enqueueFeedBadgeFetch(pubkey: string) {
  if (feedBadgeFetchedSet.has(pubkey)) return;
  feedBadgePendingQueue.add(pubkey);
  if (!feedBadgeFlushTimer) {
    feedBadgeFlushTimer = setTimeout(flushFeedBadgeQueue, 200);
  }
}

export function useAcceptedBadgesCached(pubkey: string | null): ResolvedBadge[] {
  const [badges, setBadges] = useState<ResolvedBadge[]>([]);

  useEffect(() => {
    if (!pubkey) { setBadges([]); return; }

    const resolve = () => {
      const cached = getCachedProfileBadges(pubkey);
      if (!cached || cached.badges.length === 0) { setBadges([]); return; }
      const resolved: ResolvedBadge[] = [];
      for (const ab of cached.badges) {
        const def = getCachedBadgeDef(ab.badgeRef);
        if (!def) continue;
        resolved.push({
          badgeRef: ab.badgeRef,
          awardEventId: ab.awardEventId,
          definition: def,
          awarderPubkey: def.pubkey,
          awardedAt: def.createdAt,
          isAccepted: true,
        });
      }
      setBadges(resolved);
    };

    resolve();

    if (!feedBadgeListeners.has(pubkey)) {
      feedBadgeListeners.set(pubkey, new Set());
    }
    const listenerSet = feedBadgeListeners.get(pubkey)!;
    listenerSet.add(resolve);

    enqueueFeedBadgeFetch(pubkey);

    return () => {
      listenerSet.delete(resolve);
      if (listenerSet.size === 0) feedBadgeListeners.delete(pubkey);
    };
  }, [pubkey]);

  return badges;
}

export function usePendingBadgeAwards(pubkey: string | null) {
  const [pending, setPending] = useState<Array<{ award: BadgeAward; definition?: BadgeDefinition }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pubkey) { setPending([]); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const [awards, profileBadges] = await Promise.all([
          fetchBadgeAwardsForUser(pubkey),
          fetchProfileBadgesList(pubkey),
        ]);

        const acceptedRefs = new Set(
          (profileBadges?.badges || []).map(b => b.badgeRef)
        );

        const unaccepted = awards.filter(
          a => a.awardedTo.includes(pubkey) && !acceptedRefs.has(a.badgeRef)
        );

        if (unaccepted.length === 0) {
          if (!cancelled) { setPending([]); setLoading(false); }
          return;
        }

        const aTagsToFetch = [...new Set(unaccepted.map(a => a.badgeRef))];
        const defs = await fetchBadgeDefinitions(aTagsToFetch);

        const result = unaccepted.map(award => ({
          award,
          definition: defs.get(award.badgeRef),
        }));

        if (!cancelled) setPending(result);
      } catch (err) {
        console.error("[NIP-58] Failed to load pending awards:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pubkey]);

  return { pending, loading };
}
