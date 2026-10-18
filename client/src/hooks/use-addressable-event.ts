/**
 * Fetch an addressable event (an article, a listing, a calendar event) by its
 * coordinate: the local store first, then the coordinate's relay hints, the
 * author's write relays (NIP-65: an event lives where its author published
 * it), then a broad default set. Keeps the newest version. "Nobody answered"
 * is its own settled state (`unreached`), never "this doesn't exist".
 */
import { useEffect, useState } from "react";
import type { Event } from "nostr-tools";
import { eventStore, DEFAULT_RELAYS, FAST_RELAYS } from "@/lib/nostr";
import { queryAnswered } from "@/lib/relay-reach";
import { orderedRelayCandidates } from "@/lib/parent-resolve";
import { KIND_CLASSIFIED_LISTING, LISTING_RELAYS } from "@/lib/listing";
import { getWriteRelays } from "@/lib/outbox";

export function useAddressableEvent(kind: number, authorPk: string, identifier: string, relays?: string[]) {
  const [resolved, setResolved] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreached, setUnreached] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setResolved(null);
    setLoading(true);
    setUnreached(false);
    const existing = eventStore.getByFilters({ kinds: [kind], authors: [authorPk], "#d": [identifier] });
    const found = existing ? [...existing].sort((a, b) => b.created_at - a.created_at)[0] : null;
    if (found) { setResolved(found); setLoading(false); return; }
    const relaySet = orderedRelayCandidates([
      relays ?? [],
      // Listings cluster on the marketplace's own relay.
      kind === KIND_CLASSIFIED_LISTING ? LISTING_RELAYS : [],
      getWriteRelays(authorPk, []),
      FAST_RELAYS,
      DEFAULT_RELAYS.slice(0, 6),
    ]);
    let cancelled = false;
    queryAnswered(relaySet, { kinds: [kind], authors: [authorPk], "#d": [identifier], limit: 1 }, 8_000).then((res) => {
      if (cancelled) return;
      // Addressable events are replaceable: relays may hold different versions.
      const newest = [...res.events].sort((a, b) => b.created_at - a.created_at)[0] as Event | undefined;
      if (newest) {
        eventStore.add(newest);
        setResolved(newest);
      } else if (!res.answered) {
        setUnreached(true);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, authorPk, identifier, relays?.join(","), retryNonce]);

  return { resolved, loading, unreached, retry: () => setRetryNonce((n) => n + 1) };
}
