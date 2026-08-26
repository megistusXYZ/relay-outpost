import { useEffect, useMemo, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { subscribeMyTickets, subscribePrivateFeedback, hydrateIssues, hydratePrivateTickets, isIssueUnread } from "@/lib/nip34-feedback";
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
    const issues = [...hydrateIssues(events), ...hydratePrivateTickets(rumors)];
    return issues.filter((t) => {
      if (t.status === "closed") return false;
      if (t.comments.length === 0) return false;
      if (!isIssueUnread(t)) return false;
      // Don't count a ticket whose newest message is the user's own reply.
      const latest = t.comments.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      return latest.pubkey !== pubkey;
    }).length;
    // readTick participates so the count refreshes after markIssueRead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, rumors, readTick, pubkey]);
}
