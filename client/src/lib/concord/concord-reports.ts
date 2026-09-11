/**
 * Reporting a message to a group's moderators (Relay Outpost's own; the spec
 * has no reporting). Other members never see a report: it's a NIP-56-shaped
 * rumor (kind 1984) gift-wrapped (NIP-59) to each moderator separately, the way
 * a direct invite travels (concord-report-send). The moderators are the owner
 * and anyone who can remove people (KICK, BAN), who are exactly the people who
 * see Manage's Reports section; never the person reported, never the reporter.
 *
 * Pure, with the moderator's store of received reports in localStorage.
 */
import { PERM, type Member } from "./concord-events";

export const KIND_GROUP_REPORT = 1984;

/** NIP-56's report types. */
export type ReportReason = "spam" | "profanity" | "nudity" | "illegal" | "impersonation" | "other";
const REASONS: readonly string[] = ["spam", "profanity", "nudity", "illegal", "impersonation", "other"];

export interface GroupReport {
  /** The report's rumor id. */
  id: string;
  reporter: string;
  /** When it was sent (unix seconds). */
  at: number;
  communityId: string;
  channelId: string;
  msgId: string;
  /** Who wrote the reported message. */
  author: string;
  reason: ReportReason;
  /** The reporter's own words, if any. */
  note: string;
  /** The message as the reporter saw it. */
  snippet: string;
}

/** Fired when a moderator's reports change, so counts and lists refresh. */
export const REPORTS_CHANGED_EVENT = "concord-reports-changed";

const HEX64 = /^[0-9a-f]{64}$/;
const NOTE_CAP = 500;
const SNIPPET_CAP = 280;
const STORE_CAP = 200;
/** The same bits as the Reports section's capability (concordCapabilities' manageMembers). */
const MODERATE = PERM.KICK | PERM.BAN;

/** Who a report goes to: the owner and everyone who can remove people, minus the reporter and the reported. */
export function reportRecipients(roster: Member[], ownerPubkey: string, reporter: string, author: string): string[] {
  const out = new Set<string>([ownerPubkey]);
  for (const m of roster) if ((m.permissions & MODERATE) !== 0n) out.add(m.pubkey);
  out.delete(reporter);
  out.delete(author);
  return [...out];
}

/** The rumor's tags: NIP-56's `e` and `p` with the reason, where it was, and the message as seen. */
export function reportTags(r: { communityId: string; channelId: string; msgId: string; author: string; reason: ReportReason; snippet?: string }): string[][] {
  return [
    ["e", r.msgId, r.reason],
    ["p", r.author, r.reason],
    ["concord", r.communityId, r.channelId],
    ["snippet", (r.snippet ?? "").slice(0, SNIPPET_CAP)],
  ];
}

/** A received report, or null when it doesn't name a real group, room, message and author. */
export function parseReport(u: { senderPubkey: string; content: string; timestamp: number; rumorId: string; tags?: string[][] }): GroupReport | null {
  const tags = u.tags ?? [];
  const e = tags.find((t) => t[0] === "e");
  const where = tags.find((t) => t[0] === "concord");
  if (!e || !where || !HEX64.test(e[1] ?? "") || !HEX64.test(where[1] ?? "") || !HEX64.test(where[2] ?? "")) return null;
  // The gift wrap puts the RECIPIENT's `p` first; the reported author's carries the reason.
  const p = tags.find((t) => t[0] === "p" && t[2] === e[2] && HEX64.test(t[1] ?? ""));
  if (!p) return null;
  return {
    id: u.rumorId,
    reporter: u.senderPubkey,
    at: u.timestamp,
    communityId: where[1],
    channelId: where[2],
    msgId: e[1],
    author: p[1],
    reason: REASONS.includes(e[2]) ? (e[2] as ReportReason) : "other",
    note: (u.content ?? "").trim().slice(0, NOTE_CAP),
    snippet: (tags.find((t) => t[0] === "snippet")?.[1] ?? "").slice(0, SNIPPET_CAP),
  };
}

// ── A moderator's reports, on this device ───────────────────────────────────
interface ReportStore { reports: GroupReport[]; dismissed: string[] }
const storeKey = (owner: string) => `ro_concord_reports_${owner}`;

function load(owner: string): ReportStore {
  try {
    const s = JSON.parse(localStorage.getItem(storeKey(owner)) ?? "null");
    return {
      reports: Array.isArray(s?.reports) ? s.reports : [],
      dismissed: Array.isArray(s?.dismissed) ? s.dismissed.filter((d: unknown) => typeof d === "string") : [],
    };
  } catch {
    return { reports: [], dismissed: [] };
  }
}

function save(owner: string, s: ReportStore): void {
  try { localStorage.setItem(storeKey(owner), JSON.stringify(s)); } catch { /* full or private mode */ }
  try { window.dispatchEvent(new Event(REPORTS_CHANGED_EVENT)); } catch { /* no window */ }
}

/** Keep a received report. False when it's already here or was dismissed. */
export function stashReport(owner: string, report: GroupReport): boolean {
  const s = load(owner);
  if (s.dismissed.includes(report.id) || s.reports.some((r) => r.id === report.id)) return false;
  save(owner, { ...s, reports: [report, ...s.reports].sort((a, b) => b.at - a.at).slice(0, STORE_CAP) });
  return true;
}

/** A group's open reports, newest first. */
export function listReports(owner: string, communityId: string): GroupReport[] {
  return load(owner).reports.filter((r) => r.communityId === communityId).sort((a, b) => b.at - a.at);
}

/** Done with it: it leaves the list, and stays gone if it's delivered again. */
export function dismissReport(owner: string, id: string): void {
  const s = load(owner);
  save(owner, {
    reports: s.reports.filter((r) => r.id !== id),
    dismissed: [...s.dismissed.filter((d) => d !== id), id].slice(-STORE_CAP * 2),
  });
}
