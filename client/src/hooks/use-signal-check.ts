import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { pool, DEFAULT_RELAYS, eventStore } from "@/lib/nostr";
import { KIND_FOLLOW_LIST } from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";

export interface SignalParticipant {
  pubkey: string;
  tier: "crew" | "known" | "other";
}

export interface SignalCheckResult {
  crew: number;
  known: number;
  others: number;
  total: number;
  loading: boolean;
  fetched: boolean;
  fetch: () => void;
  participants: SignalParticipant[];
}

function getZapSenderFromEvent(ev: any): string | null {
  const descTag = ev.tags?.find((t: string[]) => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      return zapRequest.pubkey || null;
    } catch {}
  }
  return null;
}

let cachedSecondDegree: { key: string; set: Set<string> } | null = null;

function getSecondDegreeSet(follows: string[], myPubkey: string | null): Set<string> {
  const key = follows.slice(0, 50).join(",");
  if (cachedSecondDegree && cachedSecondDegree.key === key) return cachedSecondDegree.set;

  const set = new Set<string>();
  if (!follows.length) {
    cachedSecondDegree = { key, set };
    return set;
  }
  const checked = follows.slice(0, 50);
  for (const fPubkey of checked) {
    const followEvents = eventStore.getByFilters({ kinds: [KIND_FOLLOW_LIST], authors: [fPubkey] });
    if (!followEvents) continue;
    for (const ev of followEvents) {
      for (const tag of ev.tags) {
        if (tag[0] === "p" && tag[1]) {
          set.add(tag[1]);
        }
      }
    }
  }
  const followSet = new Set(follows);
  for (const f of followSet) set.delete(f);
  if (myPubkey) set.delete(myPubkey);

  cachedSecondDegree = { key, set };
  return set;
}

const signalCache = new Map<string, SignalParticipant[]>();

export function useSignalCheck(eventId: string): SignalCheckResult {
  const { follows, pubkey: myPubkey } = useNostrAuth();
  const [participants, setParticipants] = useState<SignalParticipant[]>(() => signalCache.get(eventId) || []);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(() => signalCache.has(eventId));
  const fetchedRef = useRef(signalCache.has(eventId));
  const eventIdRef = useRef(eventId);

  useEffect(() => {
    if (eventIdRef.current !== eventId) {
      eventIdRef.current = eventId;
      const cached = signalCache.get(eventId);
      if (cached) {
        setParticipants(cached);
        setFetched(true);
        fetchedRef.current = true;
      } else {
        setParticipants([]);
        setFetched(false);
        fetchedRef.current = false;
      }
      setLoading(false);
    }
  }, [eventId]);

  const followSet = useMemo(() => new Set(follows), [follows]);

  const fetch = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);

    try {
      const relays = DEFAULT_RELAYS.slice(0, 3);

      const [reactionEvents, zapEvents] = await Promise.all([
        Promise.race([
          pool.querySync(relays, { kinds: [7], "#e": [eventId], limit: 100 }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
        ]),
        Promise.race([
          pool.querySync(relays, { kinds: [9735], "#e": [eventId], limit: 50 }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
        ]),
      ]);

      const localReactions = [...(eventStore.getByFilters({ kinds: [7] }) || [])].filter(
        (e) => e.tags.some((t) => t[0] === "e" && t[1] === eventId)
      );

      const uniquePubkeys = new Set<string>();
      for (const ev of [...(reactionEvents as any[]), ...localReactions]) {
        if (ev.pubkey) uniquePubkeys.add(ev.pubkey);
      }
      for (const ev of (zapEvents as any[])) {
        const sender = getZapSenderFromEvent(ev);
        if (sender) uniquePubkeys.add(sender);
      }

      if (myPubkey) uniquePubkeys.delete(myPubkey);

      const secondDegreeSet = getSecondDegreeSet(follows, myPubkey);

      const classified: SignalParticipant[] = [];
      for (const pk of uniquePubkeys) {
        if (followSet.has(pk)) {
          classified.push({ pubkey: pk, tier: "crew" });
        } else if (secondDegreeSet.has(pk)) {
          classified.push({ pubkey: pk, tier: "known" });
        } else {
          classified.push({ pubkey: pk, tier: "other" });
        }
      }

      classified.sort((a, b) => {
        const order = { crew: 0, known: 1, other: 2 };
        return order[a.tier] - order[b.tier];
      });

      signalCache.set(eventId, classified);
      setParticipants(classified);
      setFetched(true);
    } catch (err) {
      console.error("Failed to fetch signal check:", err);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }, [eventId, followSet, follows, myPubkey]);

  const crew = useMemo(() => participants.filter(p => p.tier === "crew").length, [participants]);
  const known = useMemo(() => participants.filter(p => p.tier === "known").length, [participants]);
  const others = useMemo(() => participants.filter(p => p.tier === "other").length, [participants]);

  return {
    crew,
    known,
    others,
    total: participants.length,
    loading,
    fetched,
    fetch,
    participants,
  };
}
