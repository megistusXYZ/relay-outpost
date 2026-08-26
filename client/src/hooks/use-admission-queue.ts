import { useCallback, useEffect, useRef, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { fetchProfiles } from "@/lib/nostr";
import {
  fetchGroupMembers,
  fetchGroupsIAdministerResult,
  fetchJoinRequests,
} from "@/lib/nip29";
import { EMPTY_SWEEP, type QueueSweep } from "@/lib/queue-sweep";
import {
  admittableGroups,
  mergeQueues,
  pendingFor,
  type PendingAdmission,
} from "@/lib/admission-queue";

/**
 * Every person waiting to get into any space this account runs.
 *
 * The fetching half of the admission queue; the rules live in
 * lib/admission-queue.ts so they can be tested without a relay.
 *
 * Discovery asks the relay the question directly — "which groups name me an
 * admin?" — rather than listing its groups and checking each one. That earlier
 * shape was not just expensive, it was WRONG, and silently: a relay's bulk
 * kind-39000 listing is a public directory, and a closed room is exactly what a
 * directory withholds. Measured on 0xchat: 1265 groups returned, every one
 * tagged `open`, and the operator's own closed room — with somebody waiting in
 * it — absent from all of them. See fetchGroupsIAdminister in lib/nip29.ts.
 *
 * The rest of the shape is about cost, since answering "is anyone waiting?"
 * still costs round-trips to usually learn "nobody":
 *
 *  - relays are walked in sequence, not all at once, and each failure is
 *    swallowed — one unreachable relay must not blank the queue
 *  - a group is only asked for requests once it has passed the cheap gate
 *    (not positively open — see admittableGroups)
 *  - it runs on mount and on demand, never on a timer. An operator queue that
 *    silently re-polls every relay you belong to is a background cost nobody
 *    asked for; the Activity page refreshing when you open it is enough.
 */
export function useAdmissionQueue(): {
  queue: PendingAdmission[];
  loading: boolean;
  /**
   * What this run managed to ASK — the third outcome the loop below already
   * computes and used to discard. Without it an empty queue means "nobody is
   * waiting" and "we couldn't reach anyone to find out" in the same pixels.
   */
  sweep: QueueSweep;
  refresh: () => void;
  /** Drop one row locally after approving/denying, without a full refetch. */
  removeLocally: (relayUrl: string, groupId: string, pubkey: string) => void;
} {
  const { pubkey } = useNostrAuth();
  const [queue, setQueue] = useState<PendingAdmission[]>([]);
  const [sweep, setSweep] = useState<QueueSweep>(EMPTY_SWEEP);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const removeLocally = useCallback((relayUrl: string, groupId: string, pubkey: string) => {
    setQueue((prev) =>
      prev.filter(
        (p) => !(p.relayUrl === relayUrl && p.groupId === groupId && p.pubkey === pubkey),
      ),
    );
  }, []);

  useEffect(() => {
    if (!pubkey) {
      setQueue([]);
      setSweep(EMPTY_SWEEP);
      return;
    }
    const runId = ++runIdRef.current;
    let cancelled = false;
    const stale = () => cancelled || runId !== runIdRef.current;

    (async () => {
      setLoading(true);
      const relays = getOutpostRelays();
      const collected: PendingAdmission[][] = [];
      let unreached = 0;

      for (const relay of relays) {
        if (stale()) return;
        try {
          const mine = await fetchGroupsIAdministerResult(relay.url, pubkey);
          if (stale()) return;
          // Unreached is not "you run nothing here". Skipping leaves whatever
          // the other relays found standing, rather than reporting an empty
          // queue on the strength of a relay that never answered — and it is
          // now COUNTED, so the screen can admit the sweep was partial instead
          // of presenting it as a complete answer.
          if (!mine.reached) { unreached++; continue; }
          const { groups, adminsByGroupId } = mine.data;
          if (!groups.length) continue;

          for (const g of admittableGroups(groups, adminsByGroupId, pubkey)) {
            if (stale()) return;
            try {
              const [requests, members] = await Promise.all([
                fetchJoinRequests(relay.url, g.id),
                fetchGroupMembers(relay.url, g.id),
              ]);
              if (stale()) return;
              const pending = pendingFor(requests, members, { relayUrl: relay.url, group: g });
              // Seed profiles from THIS relay, on the socket we already have
              // open. useQueuePerson covers the common case via PROFILE_RELAYS,
              // but someone whose identity is community-scoped — joined a room,
              // never posted publicly — has their kind-0 only here. That is the
              // person a doorman most needs a name for, and the indexers have
              // never heard of them. Fire-and-forget: the row re-renders when
              // the event lands in the store.
              if (pending.length) fetchProfiles(pending.map((p) => p.pubkey), [relay.url]);
              collected.push(pending);
            } catch {
              // One group failing is not the queue failing.
            }
          }
        } catch {
          // Relay unreachable — skip it rather than blanking everything.
          unreached++;
        }
      }

      if (stale()) return;
      setQueue(mergeQueues(collected));
      setSweep({ relaysAttempted: relays.length, relaysUnreached: unreached });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [pubkey, nonce]);

  return { queue, loading, sweep, refresh, removeLocally };
}
