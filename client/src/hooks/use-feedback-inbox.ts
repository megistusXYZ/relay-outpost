import { useState, useEffect, useMemo, useCallback } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import type { UnwrappedRumor } from "@/lib/dm";
import {
  type FeedbackRecipient,
  type FeedbackIssue,
  discoverRecipientForRelay,
  invalidateRecipientCache,
  repoCoord,
  subscribeOperatorFeedback,
  subscribePrivateFeedback,
  combineFeedbackIssues,
  countUnread,
} from "@/lib/nip34-feedback";

export interface FeedbackInbox {
  recipient: FeedbackRecipient | null;
  /** Whom feedback is addressed to: the relay's NIP-11 operator, else the
   *  signed-in admin (so #p ingestion works before a kind-30617 repo exists). */
  operatorPubkey: string | null;
  /** The repo coordinate when a kind-30617 repo exists, else null. */
  coordValue: string | null;
  events: NostrEvent[];
  privateRumors: UnwrappedRumor[];
  /** The combined, deduped, newest-first inbox — public + private tickets. */
  issues: FeedbackIssue[];
  unreadCount: number;
  discovering: boolean;
  /** The operator's signer can't decrypt private (NIP-17) tickets. */
  nip44Missing: boolean;
  reload: () => void;
}

/**
 * THE operator feedback inbox — one subscription set + one unread computation
 * shared by the Feedback tab (the list) and the Relay Control tab badge (the
 * count). Both consume this so they can never diverge: it ingests the SAME
 * streams the tab shows — public feedback by #p (works with no kind-30617 repo)
 * and #a, PLUS private NIP-17 tickets — and counts unread over the combined,
 * deduped list honoring the shared last-read localStorage.
 *
 * `enabled` gates all work (discovery, subscriptions, gift-wrap decryption) to
 * the authorized operator console so it doesn't run for non-operators.
 */
export function useFeedbackInbox(
  relayUrl: string,
  signer: any,
  pubkey: string | null,
  enabled: boolean = true,
): FeedbackInbox {
  const [recipient, setRecipient] = useState<FeedbackRecipient | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [privateRumors, setPrivateRumors] = useState<UnwrappedRumor[]>([]);
  const [readTick, setReadTick] = useState(0);

  const reload = useCallback(() => {
    if (!relayUrl) return;
    invalidateRecipientCache(relayUrl);
    setDiscovering(true);
    setEvents([]);
    discoverRecipientForRelay(relayUrl).then((r) => {
      setRecipient(r);
      setDiscovering(false);
    });
  }, [relayUrl]);

  useEffect(() => {
    if (!enabled || !relayUrl) return;
    reload();
  }, [enabled, relayUrl, reload]);

  const operatorPubkey = recipient?.operatorPubkey || pubkey || null;
  const coordValue = recipient?.operatorPubkey && recipient.repoD
    ? repoCoord(recipient.operatorPubkey, recipient.repoD)
    : null;

  // Public ingestion: by #p (no repo needed) + #a (when a repo exists).
  useEffect(() => {
    if (!enabled || !operatorPubkey || !relayUrl) return;
    const sub = subscribeOperatorFeedback(operatorPubkey, relayUrl, coordValue, setEvents);
    return () => sub.close();
  }, [enabled, operatorPubkey, coordValue, relayUrl]);

  // Private (NIP-17) ingestion. subscribePrivateFeedback no-ops without nip44,
  // so the private stream is silently empty for a non-nip44 signer — surfaced
  // via nip44Missing so the tab can explain the gap.
  const nip44Missing = !!(signer && !signer.nip44);
  useEffect(() => {
    if (!enabled || !signer || !pubkey) return;
    const sub = subscribePrivateFeedback(signer, pubkey, setPrivateRumors);
    return () => sub.close();
  }, [enabled, signer, pubkey]);

  // Recount when any thread's last-read changes (mark-read fires this event).
  useEffect(() => {
    const onRead = () => setReadTick((n) => n + 1);
    window.addEventListener("relay-outpost:feedback-read", onRead);
    return () => window.removeEventListener("relay-outpost:feedback-read", onRead);
  }, []);

  const issues = useMemo(
    () => combineFeedbackIssues(events, privateRumors),
    [events, privateRumors],
  );

  const unreadCount = useMemo(
    () => countUnread("", issues),
    // readTick participates so the count refreshes after markIssueRead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues, readTick],
  );

  return {
    recipient,
    operatorPubkey,
    coordValue,
    events,
    privateRumors,
    issues,
    unreadCount,
    discovering,
    nip44Missing,
    reload,
  };
}
