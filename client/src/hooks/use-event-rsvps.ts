import { useCallback, useEffect, useRef, useState } from "react";
import type { Event } from "nostr-tools";
import { pool, DEFAULT_RELAYS, FAST_RELAYS, filterBlockedRelays, fetchProfilesCached } from "@/lib/nostr";
import { getOutpostRelays, getActiveDefaultRelays } from "@/lib/outpost-relays";
import { getHealthyRelays, sortRelaysByScore } from "@/lib/relay-health";
import {
  KIND_CALENDAR_RSVP,
  getEventCoordinate,
  aggregateRsvps,
  type CalendarEventData,
  type RsvpAggregate,
  type RsvpStatus,
} from "@/lib/calendar-events";

function rsvpRelays(): string[] {
  const outpost = getOutpostRelays().map((r) => r.url);
  const active = getActiveDefaultRelays();
  const combined = [...new Set([...outpost, ...active, ...DEFAULT_RELAYS, ...FAST_RELAYS])];
  return filterBlockedRelays(sortRelaysByScore(getHealthyRelays(combined))).slice(0, 5);
}

const EMPTY: RsvpAggregate = {
  goingCount: 0,
  tentativeCount: 0,
  goingPubkeys: [],
  tentativePubkeys: [],
  myStatus: null,
};

// Subscribe to kind-31925 RSVPs for one calendar event (by its `#a` coordinate),
// fold them to the latest-per-author aggregate, and expose an optimistic
// applyLocal() the card calls right after publishing so the UI reflects the new
// state before the relay round-trips back.
export function useEventRsvps(ce: CalendarEventData, viewerPubkey: string | null) {
  const coordinate = getEventCoordinate(ce);
  const [agg, setAgg] = useState<RsvpAggregate>(EMPTY);
  const eventsRef = useRef<Map<string, Event>>(new Map());

  const recompute = useCallback(() => {
    setAgg(aggregateRsvps([...eventsRef.current.values()], viewerPubkey));
  }, [viewerPubkey]);

  useEffect(() => {
    eventsRef.current = new Map();
    setAgg(EMPTY);
    const relays = rsvpRelays();
    if (relays.length === 0) return;

    let closed = false;
    const seenAuthors = new Set<string>();

    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_CALENDAR_RSVP], "#a": [coordinate], limit: 500 },
      {
        onevent(ev: Event) {
          if (closed) return;
          eventsRef.current.set(ev.id, ev);
          if (!seenAuthors.has(ev.pubkey)) {
            seenAuthors.add(ev.pubkey);
            fetchProfilesCached([ev.pubkey]);
          }
          recompute();
        },
      },
    );

    return () => {
      closed = true;
      try { sub.close(); } catch { /* noop */ }
    };
  }, [coordinate, recompute]);

  // Optimistic local update: synthesize the viewer's own RSVP so counts/state
  // move immediately. `null` = the viewer cleared their RSVP (declined).
  const applyLocal = useCallback((status: RsvpStatus | null) => {
    if (!viewerPubkey) return;
    const now = Math.floor(Date.now() / 1000) + 1; // beat any concurrent relay echo
    const synthetic: Event = {
      id: `local-${viewerPubkey}-${now}`,
      pubkey: viewerPubkey,
      created_at: now,
      kind: KIND_CALENDAR_RSVP,
      tags: [["a", coordinate], ["status", status ?? "declined"]],
      content: "",
      sig: "",
    };
    eventsRef.current.set(synthetic.id, synthetic);
    setAgg(aggregateRsvps([...eventsRef.current.values()], viewerPubkey));
  }, [viewerPubkey, coordinate]);

  return { ...agg, applyLocal };
}
