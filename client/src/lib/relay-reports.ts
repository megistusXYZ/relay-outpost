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
 * Pure: what was dismissed and whose reports are ignored come in from
 * lib/report-moderation-prefs.ts.
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
  /** What each reporter wrote, when they wrote anything. */
  reasons: { by: string; text: string }[];
  /** Relays the reports said the post lives on: where to look when this relay no longer has it. */
  relayHints: string[];
}

interface ReportEvent { id: string; pubkey: string; created_at: number; tags: string[][]; content?: string }

export function reportKey(r: { targetEventId?: string; targetPubkey: string }): string {
  return r.targetEventId ? `e:${r.targetEventId}` : `p:${r.targetPubkey}`;
}

const RANK: Record<Severity, number> = { severe: 2, mild: 1, neutral: 0 };

export function foldRelayReports(
  reports: readonly ReportEvent[],
  ctx: {
    relayEventIds: ReadonlySet<string>;
    relayAuthors: ReadonlySet<string>;
    /** When the operator dismissed this row: reports up to then stay out, newer ones bring it back. */
    dismissedAt: (key: string) => number | undefined;
    /** People whose reports the operator ignores, on every relay they run. */
    ignoredReporters: ReadonlySet<string>;
  },
): RelayReport[] {
  const rows = new Map<string, RelayReport>();
  for (const ev of reports) {
    if (ctx.ignoredReporters.has(ev.pubkey)) continue;
    const e = ev.tags.find((t) => t[0] === "e" && /^[0-9a-f]{64}$/i.test(t[1] ?? ""));
    const p = ev.tags.find((t) => t[0] === "p" && /^[0-9a-f]{64}$/i.test(t[1] ?? ""));
    if (!p) continue;
    const targetPubkey = p[1].toLowerCase();
    const targetEventId = e?.[1].toLowerCase();
    // On this relay: the post is one we've seen here, or its author posts here.
    if (!(targetEventId && ctx.relayEventIds.has(targetEventId)) && !ctx.relayAuthors.has(targetPubkey)) continue;
    const key = reportKey({ targetEventId, targetPubkey });
    const dismissedAt = ctx.dismissedAt(key);
    if (dismissedAt !== undefined && ev.created_at <= dismissedAt) continue;
    const slots = [e?.[2], e?.[3], p[2], p[3]].map((t) => (t ?? "").trim());
    const hints = slots.filter((t) => /^wss?:\/\//i.test(t)).map((t) => t.replace(/\/+$/, ""));
    const types = [e?.[2], p[2], p[3], ...ev.tags.filter((t) => t[0] === "report").map((t) => t[1])]
      .map((t) => (t ?? "").toLowerCase().trim())
      .filter((t) => t && !/^wss?:\/\//.test(t));
    const row = rows.get(key) ?? { targetEventId, targetPubkey, reporters: [], types: [], severity: "neutral" as Severity, firstAt: ev.created_at, lastAt: ev.created_at, reportIds: [], reasons: [], relayHints: [] };
    if (!row.reporters.includes(ev.pubkey)) row.reporters.push(ev.pubkey);
    const text = (ev.content ?? "").trim();
    if (text && !row.reasons.some((x) => x.by === ev.pubkey)) row.reasons.push({ by: ev.pubkey, text: text.slice(0, 280) });
    for (const h of hints) if (!row.relayHints.includes(h)) row.relayHints.push(h);
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

/**
 * Reports someone in your network made, then the rest — folded, never dropped.
 * Strangers' reports about someone your network trusts (owner, 2026-10-18)
 * fold further, into "probably fine", and aren't counted in the badge.
 */
export function splitByTrust(
  rows: readonly RelayReport[],
  tierOf: (pubkey: string) => SignalTier,
  networkLoaded = true,
): { known: RelayReport[]; strangers: RelayReport[]; probablyFine: RelayReport[] } {
  if (!networkLoaded) return { known: [...rows], strangers: [], probablyFine: [] };
  const known: RelayReport[] = [];
  const strangers: RelayReport[] = [];
  const probablyFine: RelayReport[] = [];
  for (const r of rows) {
    if (r.reporters.some((pk) => KNOWN.has(tierOf(pk)))) known.push(r);
    else if (KNOWN.has(tierOf(r.targetPubkey))) probablyFine.push(r);
    else strangers.push(r);
  }
  return { known, strangers, probablyFine };
}

/** Why a report sits under "Probably fine". */
export function probablyFineExplanation(): string {
  return "Your network trusts the people these are about, and doesn't know who reported them.";
}

/** Why a report sits under "From people you don't know". */
export function strangersExplanation(): string {
  return "Reports from people your network trusts come first. These reporters aren't known to your network yet.";
}

/** "See it", honestly: where the reported post is, after asking. Empty when it is right here. */
export function seeItWords(o: { reached: boolean; here: boolean; elsewhere: boolean }): string {
  if (o.here) return "";
  if (!o.reached) return "Couldn't reach the relays to check. Try again in a moment.";
  if (o.elsewhere) return "Not on this relay any more, but still up on other relays.";
  return "Not on this relay, and no relay we asked still has it. It was probably removed.";
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
