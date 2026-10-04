import { useEffect, useMemo, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { subscribeMyTickets, subscribePrivateFeedback, hydrateIssues, hydratePrivateTickets } from "@/lib/nip34-feedback";
import { ticketUpdates } from "@/lib/feedback-needs";
import type { UnwrappedRumor } from "@/lib/dm";
import type { Event as NostrEvent } from "nostr-tools";

/**
 * Live count of the user's feedback tickets that have unseen activity (a new
 * operator reply or status change). Drives the "Your tickets" badge so the
 * operator→user direction is actually surfaced. Recomputes when new events
 * arrive and when the user marks a ticket read.
 *
 * Kept in lockstep with the notification-bell ticket count
 * (NotificationContext): both public + private tickets, excluding closed ones,
 * and only when the newest message isn't the user's own — so Settings and the
 * bell never disagree.
 */
export function useFeedbackUnread(): number {
  const { pubkey, signer } = useNostrAuth();
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [rumors, setRumors] = useState<UnwrappedRumor[]>([]);
  const [readTick, setReadTick] = useState(0);

  useEffect(() => {
    if (!pubkey) { setEvents([]); return; }
    const sub = subscribeMyTickets(pubkey, setEvents);
    const onRead = () => setReadTick((n) => n + 1);
    window.addEventListener("relay-outpost:feedback-read", onRead);
    return () => { sub.close(); window.removeEventListener("relay-outpost:feedback-read", onRead); };
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !signer) { setRumors([]); return; }
    const sub = subscribePrivateFeedback(signer, pubkey, setRumors);
    return () => sub.close();
  }, [pubkey, signer]);

  return useMemo(() => {
    if (!pubkey) return 0;
    // A reply or status change from someone else you haven't seen — a close
    // included (lib/feedback-needs.ts; the bell uses the same rule).
    return ticketUpdates([...hydrateIssues(events), ...hydratePrivateTickets(rumors)], pubkey).length;
    // readTick participates so the count refreshes after markIssueRead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, rumors, readTick, pubkey]);
}
