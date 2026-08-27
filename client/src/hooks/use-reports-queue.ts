import { useCallback, useEffect, useRef, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { dismissReport, filterDismissed, readDismissed } from "@/lib/reports-dismissed";
import { getOutpostRelays, getDisabledRelays } from "@/lib/outpost-relays";
import { fetchProfiles } from "@/lib/nostr";
import {
  fetchGroupMembers,
  fetchGroupsIAdministerResult,
  fetchGroupReports,
  fetchEventsByIds,
  fetchDeletedEventIds,
} from "@/lib/nip29";
import { EMPTY_SWEEP, type QueueSweep } from "@/lib/queue-sweep";
import { fetchReportsAbout } from "@/lib/report-sources";
import {
  applyGroupScope,
  dropHandled,
  mergeQueues,
  mergeReportEvents,
  moderatedGroups,
  reportsFor,
  type PendingReport,
} from "@/lib/reports-queue";

/**
 * Everything flagged in a space you run, from every space you run.
 *
 * Deliberately the same shape as useAdmissionQueue — same relay walk, same
 * stale-run guard, same "one group failing is not the queue failing" posture —
 * because a moderator should not have to learn two different surfaces for the
 * two things that land in Needs-you.
 *
 * The one step it adds is the SECOND fetch: reports are found by `#p` over the
 * member list (NIP-56 has no notion of a group), so the reported messages are
 * then resolved by id and their `h` tag read. That is what separates "a message
 * in this room" from "this member was reported for something elsewhere", and
 * without it the queue quietly mixes the two.
 *
 * TWO QUESTIONS, TWO PLACES. Reports are read from the PUBLIC relays; which
 * room a report is about is resolved against the GROUP's relay. That split is
 * the correction of a measured bug: this queue used to ask the group's own
 * relay for kind-1984, and a NIP-29 relay stores group-tagged events and
 * nothing else — newlay accepts a report and silently drops it, relay29 refuses
 * it outright. So the queue could never populate, for reports written by this
 * app or any other. See lib/report-sources.ts for the measurements.
 *
 * The group relay is still ASKED, merged and deduped by event id, because a
 * host that does store 1984s costs one query to support and would otherwise be
 * silently unsupported.
 */
export function useReportsQueue(): {
  queue: PendingReport[];
  loading: boolean;
  /** What this run managed to ASK — see the admission queue's twin. */
  sweep: QueueSweep;
  refresh: () => void;
  /** Drop one row locally after acting, without a full refetch. */
  removeLocally: (relayUrl: string, groupId: string, key: string) => void;
} {
  const { pubkey } = useNostrAuth();
  const [queue, setQueue] = useState<PendingReport[]>([]);
  const [sweep, setSweep] = useState<QueueSweep>(EMPTY_SWEEP);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const runIdRef = useRef(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * Drop the row AND remember it, or the next sweep brings it straight back.
   *
   * This used to filter React state and stop there. A kind-1984 lives forever
   * on the relay, so the very next refresh re-fetched it — which is why a
   * three-year-old report on a message the relay would not even return was
   * still on screen every single time. The ✕ looked like it worked and never
   * did. See lib/reports-dismissed.ts for why the record is a TIMESTAMP: a
   * fresh report about the same target has earned its way back.
   */
  const removeLocally = useCallback((relayUrl: string, groupId: string, key: string) => {
    setQueue((prev) => {
      const hit = prev.find(
        (r) => r.relayUrl === relayUrl && r.groupId === groupId && (r.targetEventId ?? r.targetPubkey) === key,
      );
      if (hit) dismissReport(pubkey, hit);
      return prev.filter((r) => r !== hit);
    });
  }, [pubkey]);

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
      const collected: PendingReport[][] = [];

      // A relay the user turned OFF is not asked — so "Turn off" on the
      // sweep notice genuinely silences it rather than re-flagging next sweep.
      const disabled = getDisabledRelays();
      const relays = getOutpostRelays().filter((r) => !disabled.has(r.url));
      let unreached = 0;
      const unreachedUrls: string[] = [];

      for (const relay of relays) {
        if (stale()) return;
        try {
          // One question — "which groups name me an admin?" — in place of
          // listing the relay's groups and fetching admins for each in turn.
          // That walk was unbounded by anything the operator controls: on
          // 0xchat it is 1265 sequential round-trips on every Activity open,
          // and it still could not see a closed room, because the listing it
          // walked is a public directory. See lib/nip29.ts.
          const mine = await fetchGroupsIAdministerResult(relay.url, pubkey);
          if (stale()) return;
          if (!mine.reached) { unreached++; unreachedUrls.push(relay.url); continue; }
          const { groups, adminsByGroupId } = mine.data;
          if (!groups.length) continue;

          for (const g of moderatedGroups(groups, adminsByGroupId, pubkey)) {
            if (stale()) return;
            try {
              const members = await fetchGroupMembers(relay.url, g.id);
              if (stale()) return;
              if (!members.length) continue;

              // Both stores, in parallel. The public set is where reports
              // actually are; the group relay is asked too so a host that does
              // keep them is not silently excluded. Deduped by id — six public
              // relays holding one report must not read as six reporters, since
              // the queue's whole ordering rests on distinct-reporter counts.
              const [groupRelayReports, publicReports] = await Promise.all([
                fetchGroupReports(relay.url, members),
                fetchReportsAbout(members),
              ]);
              if (stale()) return;
              const reports = mergeReportEvents(groupRelayReports, publicReports);

              const rows = reportsFor(
                { id: g.id, relayUrl: relay.url, name: g.name },
                reports,
                pubkey,
              );
              if (!rows.length) continue;

              // Resolve the reported messages so their room can be read rather
              // than assumed. Ids the relay will not serve stay absent from the
              // map, and applyGroupScope marks those unverified instead of
              // guessing in either direction.
              const ids = rows.map((r) => r.targetEventId).filter(Boolean) as string[];
              const resolved = ids.length
                ? await fetchEventsByIds(relay.url, ids)
                : new Map<string, never>();
              if (stale()) return;

              // Messages a moderator already removed. Without this the queue
              // re-raises finished work AND mislabels it: deleting the message
              // is what makes it unresolvable above, so it returns as
              // "Message could not be loaded from this relay" — telling the
              // moderator their own action might not have happened.
              const deleted = ids.length
                ? await fetchDeletedEventIds(relay.url, g.id)
                : new Set<string>();
              if (stale()) return;

              const scoped = dropHandled(applyGroupScope(rows, resolved, g.id), deleted);
              // Same reason as the admission queue: seed profiles from THIS
              // relay while its socket is open, because a community-scoped
              // identity's kind-0 exists nowhere the profile indexers look.
              if (scoped.length) fetchProfiles(scoped.map((r) => r.targetPubkey), [relay.url]);
              collected.push(scoped);
            } catch {
              // One group failing is not the queue failing.
            }
          }
        } catch {
          // Relay unreachable — skip it rather than blanking everything.
          unreached++;
          unreachedUrls.push(relay.url);
        }
      }

      if (stale()) return;
      // Filtered on the way IN, so the nav badge, the heading count and the
      // rows all agree — three consumers reading one already-filtered list
      // rather than each remembering to apply the same rule.
      setQueue(filterDismissed(mergeQueues(collected), readDismissed(pubkey)));
      setSweep({ relaysAttempted: relays.length, relaysUnreached: unreached, unreachedUrls });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [pubkey, nonce]);

  return { queue, loading, sweep, refresh, removeLocally };
}
