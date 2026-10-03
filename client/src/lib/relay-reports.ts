/**
 * Reports about what's on a relay you run — not just in its NIP-29 groups.
 *
 * A NIP-56 report (kind 1984) is published to the reporter's own relays, so
 * these are read from the public relays by the people who post on yours
 * (lib/report-sources.ts), plus whatever your relay stores itself. One row per
 * thing reported, with everyone who reported it.
 *
 * Owner, 2026-10-03: every report is shown, ordered by trust. Reports nobody
 * in your network made fold into "From people you don't know" — never hidden,
 * so a pile-on from fresh accounts can't jump the queue.
 *
 * Pure apart from the dismissed-list storage at the bottom.
 */
import type { SignalTier } from "./graperank";
import { severityFromReportTypes, type Severity } from "./follow-flag-verdict";

export interface RelayReport {
  /** The post reported, when it's a post; absent when it's about the person. */
  targetEventId?: string;
  /** Who the report is about (a post's author, or the person). */
  targetPubkey: string;
  reporters: string[];
  types: string[];
  severity: Severity;
  firstAt: number;
  lastAt: number;
  reportIds: string[];
}

interface ReportEvent { id: string; pubkey: string; created_at: number; tags: string[][] }

export function reportKey(r: { targetEventId?: string; targetPubkey: string }): string {
  return r.targetEventId ? `e:${r.targetEventId}` : `p:${r.targetPubkey}`;
}

const RANK: Record<Severity, number> = { severe: 2, mild: 1, neutral: 0 };

export function foldRelayReports(
  reports: readonly ReportEvent[],
  ctx: { relayEventIds: ReadonlySet<string>; relayAuthors: ReadonlySet<string>; dismissed: ReadonlySet<string> },
): RelayReport[] {
  const rows = new Map<string, RelayReport>();
  for (const ev of reports) {
    const e = ev.tags.find((t) => t[0] === "e" && /^[0-9a-f]{64}$/i.test(t[1] ?? ""));
    const p = ev.tags.find((t) => t[0] === "p" && /^[0-9a-f]{64}$/i.test(t[1] ?? ""));
    if (!p) continue;
    const targetPubkey = p[1].toLowerCase();
    const targetEventId = e?.[1].toLowerCase();
    // On this relay: the post is one we've seen here, or its author posts here.
    if (!(targetEventId && ctx.relayEventIds.has(targetEventId)) && !ctx.relayAuthors.has(targetPubkey)) continue;
    const key = reportKey({ targetEventId, targetPubkey });
    if (ctx.dismissed.has(key)) continue;
    const types = [e?.[2], p[2], p[3], ...ev.tags.filter((t) => t[0] === "report").map((t) => t[1])]
      .map((t) => (t ?? "").toLowerCase().trim())
      .filter((t) => t && !/^wss?:\/\//.test(t));
    const row = rows.get(key) ?? { targetEventId, targetPubkey, reporters: [], types: [], severity: "neutral" as Severity, firstAt: ev.created_at, lastAt: ev.created_at, reportIds: [] };
    if (!row.reporters.includes(ev.pubkey)) row.reporters.push(ev.pubkey);
    for (const t of types) if (!row.types.includes(t)) row.types.push(t);
    row.firstAt = Math.min(row.firstAt, ev.created_at);
    row.lastAt = Math.max(row.lastAt, ev.created_at);
    row.reportIds.push(ev.id);
    row.severity = severityFromReportTypes(row.types);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) =>
    RANK[b.severity] - RANK[a.severity] || b.reporters.length - a.reporters.length || b.lastAt - a.lastAt);
}

const KNOWN: ReadonlySet<SignalTier> = new Set(["strong", "moderate"]);

/** Reports someone in your network made, and the rest — folded, never dropped. */
export function splitByTrust(
  rows: readonly RelayReport[],
  tierOf: (pubkey: string) => SignalTier,
  networkLoaded = true,
): { known: RelayReport[]; strangers: RelayReport[] } {
  if (!networkLoaded) return { known: [...rows], strangers: [] };
  const known: RelayReport[] = [];
  const strangers: RelayReport[] = [];
  for (const r of rows) (r.reporters.some((pk) => KNOWN.has(tierOf(pk))) ? known : strangers).push(r);
  return { known, strangers };
}

function list(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "A post reported for spam by 2 people". */
export function describeReport(r: { types: string[]; reporters: string[]; targetEventId?: string }): string {
  const what = r.targetEventId ? "A post" : "This person";
  const why = r.types.length ? ` for ${list(r.types)}` : "";
  const who = `${r.reporters.length} ${r.reporters.length === 1 ? "person" : "people"}`;
  return `${what} reported${why} by ${who}`;
}

const DISMISSED_KEY = "ro_relay_reports_dismissed_";

export function readDismissedRelayReports(relayUrl: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY + relayUrl) || "[]")); } catch { return new Set(); }
}

export function dismissRelayReport(relayUrl: string, key: string): void {
  const all = readDismissedRelayReports(relayUrl);
  all.add(key);
  try { localStorage.setItem(DISMISSED_KEY + relayUrl, JSON.stringify([...all].slice(-2000))); } catch {}
}
