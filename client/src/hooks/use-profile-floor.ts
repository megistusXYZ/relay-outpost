/**
 * Plumbing for the three-state stranger profile gate on discovery surfaces
 * (spam-filter.ts `hideNoProfile` + discover-quality.ts `gateStrangerProfile`).
 *
 * A surface that gates profile-less strangers owes three things:
 *  1. a `profileGetter` reading the kind-0 already in the event store;
 *  2. a prefetch so held-unknown authors actually get their kind-0 REQUESTED —
 *     otherwise the grace state can never resolve and legit slow-loading
 *     authors would stay hidden forever;
 *  3. a re-run trigger (`profileVersion`) so a kind-0 arriving after the last
 *     feed flush can still un-hide its author's held posts.
 *
 * Home.tsx carries its own (older, conditional) inline version of this for the
 * For You feed; this hook packages the same contract for the global media
 * discovery surfaces (ImagesFeed / VideoFeed).
 */
import { useCallback, useEffect, useState } from "react";
import type { Event } from "nostr-tools";
import { eventStore, fetchProfilesCached, isProfileFetchSettled } from "@/lib/nostr";

const PREFETCH_WINDOW = 300;

export function useProfileFloor(events: Event[] | undefined) {
  // Re-run trigger: kind-0 arrivals land in bursts — trailing 300ms debounce.
  const [profileVersion, setProfileVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = eventStore.insert$.subscribe((e: Event) => {
      if (e.kind !== 0 || timer) return;
      timer = setTimeout(() => { timer = null; setProfileVersion((v) => v + 1); }, 300);
    });
    return () => { sub.unsubscribe(); if (timer) clearTimeout(timer); };
  }, []);

  // Prefetch the candidate window's authors (fetchProfilesCached dedupes).
  useEffect(() => {
    if (!events || events.length === 0) return;
    const pks = Array.from(new Set(events.slice(0, PREFETCH_WINDOW).map((e) => e.pubkey)));
    fetchProfilesCached(pks);
  }, [events]);

  const profileGetter = useCallback((pk: string) => {
    try {
      const event = eventStore.getEvent({ kind: 0, pubkey: pk, identifier: "" });
      if (!event) return null;
      return JSON.parse(event.content);
    } catch { return null; }
  }, []);

  return { profileGetter, profileSettledGetter: isProfileFetchSettled, profileVersion };
}
