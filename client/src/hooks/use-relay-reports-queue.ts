/**
 * Reports about what's on the relays you run, swept once a session (and when
 * your relays change or you come back to the tab — the needs-you engine owns
 * that). Only someone who runs a relay pays for it: no relays, no requests.
 *
 * For each relay: read its latest posts (who posts there, which posts), then
 * the reports about those people from the public relays plus any the relay
 * stores itself, folded by lib/relay-reports.ts. A relay we couldn't reach is
 * named, never counted as "no reports".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { canReachRelay } from "@/lib/relay-reach";
import { fetchReportsAbout } from "@/lib/report-sources";
import { REPORT_HORIZON_SECONDS } from "@/lib/reports-queue";
import { getOperatedRelays } from "@/lib/operated-relays";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import {
  dismissRelayReport, foldRelayReports, readDismissedRelayReports, reportKey, type RelayReport,
} from "@/lib/relay-reports";

export interface RelayReportsValue {
  byRelay: Record<string, RelayReport[]>;
  /** Relays we couldn't reach on the last sweep. */
  unreached: string[];
  loading: boolean;
  refresh: () => void;
  /** Mark one handled: gone from the list and the badge, remembered on this device. */
  dismiss: (relayUrl: string, report: RelayReport) => void;
}

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

export async function sweepRelayReports(relayUrl: string): Promise<{ reports: RelayReport[]; reached: boolean }> {
  if (!(await canReachRelay(relayUrl))) return { reports: [], reached: false };
  const since = Math.floor(Date.now() / 1000) - REPORT_HORIZON_SECONDS;
  const recent: NostrEvent[] = await pool.querySync([relayUrl], { limit: 300 }, { maxWait: 6000 } as never).catch(() => []);
  const authors = [...new Set(recent.map((e) => e.pubkey))];
  const [publicReports, storedReports] = await Promise.all([
    fetchReportsAbout(authors),
    pool.querySync([relayUrl], { kinds: [1984], since, limit: 300 }, { maxWait: 6000 } as never).catch(() => [] as NostrEvent[]),
  ]);
  const seen = new Set<string>();
  const all = [...publicReports, ...storedReports].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const reports = foldRelayReports(all, {
    relayEventIds: new Set(recent.map((e) => e.id)),
    relayAuthors: new Set(authors),
    dismissed: readDismissedRelayReports(relayUrl),
  });
  return { reports, reached: true };
}

export function useRelayReportsQueue(): RelayReportsValue {
  const { pubkey } = useNostrAuth();
  const [byRelay, setByRelay] = useState<Record<string, RelayReport[]>>({});
  const [unreached, setUnreached] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!pubkey) return;
    const relays = getOperatedRelays().map((r) => r.url);
    if (!relays.length) { setByRelay({}); setUnreached([]); return; }
    const id = ++run.current;
    setLoading(true);
    Promise.all(relays.map(async (url) => [url, await sweepRelayReports(url)] as const)).then((results) => {
      if (id !== run.current) return;
      const next: Record<string, RelayReport[]> = {};
      const down: string[] = [];
      for (const [url, r] of results) { next[norm(url)] = r.reports; if (!r.reached) down.push(url); }
      setByRelay(next);
      setUnreached(down);
      setLoading(false);
    });
  }, [pubkey, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const dismiss = useCallback((relayUrl: string, report: RelayReport) => {
    dismissRelayReport(relayUrl, reportKey(report));
    setByRelay((prev) => {
      const k = norm(relayUrl);
      return { ...prev, [k]: (prev[k] ?? []).filter((r) => reportKey(r) !== reportKey(report)) };
    });
  }, []);

  return { byRelay, unreached, loading, refresh, dismiss };
}

/** One relay's rows from the sweep. */
export function reportsFor(value: RelayReportsValue | undefined, relayUrl: string): RelayReport[] {
  return value?.byRelay[norm(relayUrl)] ?? [];
}
