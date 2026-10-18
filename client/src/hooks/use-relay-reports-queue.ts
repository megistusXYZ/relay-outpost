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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event as NostrEvent } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { canReachRelay } from "@/lib/relay-reach";
import { fetchReportsAbout } from "@/lib/report-sources";
import { REPORT_HORIZON_SECONDS } from "@/lib/reports-queue";
import { getOperatedRelays } from "@/lib/operated-relays";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { foldRelayReports, reportKey, type RelayReport } from "@/lib/relay-reports";
import {
  REPORT_PREFS_CHANGED, readIgnoreMap, readDismissMap, ignoredReporterSet, dismissedAtFor,
  recordDismissal, setReporterIgnored,
} from "@/lib/report-moderation-prefs";

export interface RelayReportsValue {
  byRelay: Record<string, RelayReport[]>;
  /** Relays we couldn't reach on the last sweep. */
  unreached: string[];
  loading: boolean;
  refresh: () => void;
  /** Mark one handled: gone from the list and the badge until a newer report arrives. Synced. */
  dismiss: (relayUrl: string, report: RelayReport) => void;
  /** People whose reports are ignored on every relay you run. */
  ignored: string[];
  /** Ignore (or stop ignoring) someone's reports, on every relay you run. Synced. */
  setIgnored: (reporter: string, on: boolean) => void;
}

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();

/** What one sweep found on a relay, before your decisions are applied. */
export interface RelaySweep {
  events: NostrEvent[];
  relayEventIds: Set<string>;
  relayAuthors: Set<string>;
  reached: boolean;
}

export async function sweepRelayReports(relayUrl: string): Promise<RelaySweep> {
  if (!(await canReachRelay(relayUrl))) return { events: [], relayEventIds: new Set(), relayAuthors: new Set(), reached: false };
  const since = Math.floor(Date.now() / 1000) - REPORT_HORIZON_SECONDS;
  const recent: NostrEvent[] = await pool.querySync([relayUrl], { limit: 300 }, { maxWait: 6000 } as never).catch(() => []);
  const authors = [...new Set(recent.map((e) => e.pubkey))];
  const [publicReports, storedReports] = await Promise.all([
    fetchReportsAbout(authors),
    pool.querySync([relayUrl], { kinds: [1984], since, limit: 300 }, { maxWait: 6000 } as never).catch(() => [] as NostrEvent[]),
  ]);
  const seen = new Set<string>();
  const events = [...publicReports, ...storedReports].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  return { events, relayEventIds: new Set(recent.map((e) => e.id)), relayAuthors: new Set(authors), reached: true };
}

export function useRelayReportsQueue(): RelayReportsValue {
  const { pubkey } = useNostrAuth();
  const [sweeps, setSweeps] = useState<Record<string, RelaySweep>>({});
  const [unreached, setUnreached] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Your decisions (ignore, dismiss) change here or arrive from another device.
  const [prefsVersion, setPrefsVersion] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    const bump = () => setPrefsVersion((v) => v + 1);
    window.addEventListener(REPORT_PREFS_CHANGED, bump);
    window.addEventListener("storage", bump);
    return () => { window.removeEventListener(REPORT_PREFS_CHANGED, bump); window.removeEventListener("storage", bump); };
  }, []);

  useEffect(() => {
    if (!pubkey) return;
    const relays = getOperatedRelays().map((r) => r.url);
    if (!relays.length) { setSweeps({}); setUnreached([]); return; }
    const id = ++run.current;
    setLoading(true);
    Promise.all(relays.map(async (url) => [url, await sweepRelayReports(url)] as const)).then((results) => {
      if (id !== run.current) return;
      const next: Record<string, RelaySweep> = {};
      const down: string[] = [];
      for (const [url, r] of results) { next[norm(url)] = r; if (!r.reached) down.push(url); }
      setSweeps(next);
      setUnreached(down);
      setLoading(false);
    });
  }, [pubkey, nonce]);

  const ignoreMap = useMemo(() => (pubkey ? readIgnoreMap(pubkey) : {}), [pubkey, prefsVersion]);
  const dismissMap = useMemo(() => (pubkey ? readDismissMap(pubkey) : {}), [pubkey, prefsVersion]);
  const ignoredSet = useMemo(() => ignoredReporterSet(ignoreMap), [ignoreMap]);

  const byRelay = useMemo(() => {
    const out: Record<string, RelayReport[]> = {};
    for (const [url, sw] of Object.entries(sweeps)) {
      out[url] = foldRelayReports(sw.events, {
        relayEventIds: sw.relayEventIds,
        relayAuthors: sw.relayAuthors,
        dismissedAt: (key) => dismissedAtFor(dismissMap, url, key),
        ignoredReporters: ignoredSet,
      });
    }
    return out;
  }, [sweeps, dismissMap, ignoredSet]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const dismiss = useCallback((relayUrl: string, report: RelayReport) => {
    if (!pubkey) return;
    recordDismissal(pubkey, relayUrl, reportKey(report));
  }, [pubkey]);
  const setIgnored = useCallback((reporter: string, on: boolean) => {
    if (!pubkey) return;
    setReporterIgnored(pubkey, reporter, on);
  }, [pubkey]);

  return { byRelay, unreached, loading, refresh, dismiss, ignored: useMemo(() => [...ignoredSet], [ignoredSet]), setIgnored };
}

/** One relay's rows from the sweep. */
export function reportsFor(value: RelayReportsValue | undefined, relayUrl: string): RelayReport[] {
  return value?.byRelay[norm(relayUrl)] ?? [];
}
