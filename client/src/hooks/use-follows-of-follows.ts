import { useEffect, useMemo, useRef } from "react";
import { auditTime } from "rxjs";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchContactLists } from "@/lib/nostr";

const FETCH_DEBOUNCE_MS = 6000;
const MAX_FOLLOWS_TO_FETCH = 150;

export function useFollowsOfFollows(follows: string[] | undefined) {
  const followsKey = useMemo(() => {
    if (!follows || follows.length === 0) return "";
    const sorted = [...follows].sort();
    return sorted.length + ":" + sorted.join(",");
  }, [follows]);

  const lastFetchedKeyRef = useRef<string>("");

  useEffect(() => {
    if (!follows || follows.length === 0) return;
    if (lastFetchedKeyRef.current === followsKey) return;
    const timer = setTimeout(() => {
      lastFetchedKeyRef.current = followsKey;
      fetchContactLists(follows.slice(0, MAX_FOLLOWS_TO_FETCH));
    }, FETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [follows, followsKey]);

  const contactListEvents = use$(
    () =>
      follows && follows.length > 0
        // Contact lists stream in ONE AT A TIME for ~11-20s after the fetch, and
        // the fold below is O(follows × p-tags). Without this, that fold ran on
        // every single kind-3 arrival — up to ~150 recomputes over the window.
        // auditTime collapses a burst to at most one emission per 500ms; the
        // strip's 8s latch grace makes the initial delay invisible.
        ? eventStore.timeline({ kinds: [3], authors: follows }).pipe(auditTime(500))
        : undefined,
    [followsKey],
  );

  const { fofSet, fofCounts } = useMemo(() => {
    const set = new Set<string>();
    // pubkey → how many DISTINCT follows of mine follow them. The count is the
    // ranking signal for "people to follow" (Discover strip): one overlap is
    // noise, several is a pattern. Counted per latest-kind-3-per-author so a
    // republished contact list can't double-count its author.
    const counts = new Map<string, number>();
    if (!contactListEvents || !follows || follows.length === 0) return { fofSet: set, fofCounts: counts };
    const followSet = new Set(follows);
    const latestPerAuthor = new Map<string, { created_at: number; tags: string[][] }>();
    for (const ev of contactListEvents) {
      const existing = latestPerAuthor.get(ev.pubkey);
      if (!existing || ev.created_at > existing.created_at) {
        latestPerAuthor.set(ev.pubkey, { created_at: ev.created_at, tags: ev.tags });
      }
    }
    latestPerAuthor.forEach(({ tags }) => {
      // A malformed list can repeat a p-tag; count each candidate once per list.
      const seenInList = new Set<string>();
      for (const tag of tags) {
        if (tag[0] === "p" && tag[1] && typeof tag[1] === "string") {
          if (!followSet.has(tag[1])) {
            set.add(tag[1]);
            if (!seenInList.has(tag[1])) {
              seenInList.add(tag[1]);
              counts.set(tag[1], (counts.get(tag[1]) ?? 0) + 1);
            }
          }
        }
      }
    });
    return { fofSet: set, fofCounts: counts };
  }, [contactListEvents, follows]);

  const coverage = useMemo(() => {
    if (!follows || follows.length === 0) return { fetched: 0, total: 0 };
    const seen = new Set<string>();
    if (contactListEvents) {
      for (const ev of contactListEvents) seen.add(ev.pubkey);
    }
    return { fetched: seen.size, total: follows.length };
  }, [contactListEvents, follows]);

  return { fofSet, fofCounts, coverage };
}
