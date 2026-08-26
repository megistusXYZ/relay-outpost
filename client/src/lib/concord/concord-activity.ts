/**
 * Pure activity/timeline folds for Concord chat + governance. Extracted from the
 * ConcordChat + useConcordGovernance components so the ordering rules that drive
 * what a user actually sees (interleaved system lines, the "new" divider, the
 * admin activity feeds) are node-testable in isolation.
 */
import { effectiveTime, parseAuditRumor, KIND_AUDIT, type AuditEntry } from "./concord-events";

/** One membership event for the admin activity log + inline chat system lines. */
export interface MembershipEvent { pubkey: string; action: "join" | "leave"; t: number }

/** What a chat system line can announce: joins/leaves + neutral moderation
 *  outcomes (removed/banned). Role changes deliberately have NO system line —
 *  promote/demote stays audit-log-only. */
export type SystemAction = "join" | "leave" | "kick" | "ban";

/** One system-line event (the `pubkey` is the AFFECTED member — for kick/ban
 *  that's the target, never the acting admin; the reason is never included). */
export interface SystemEvent { pubkey: string; action: SystemAction; t: number }

/** A chat-timeline item: a real message, or a system line (join/leave/kick/ban). */
export type TimelineItem<M> =
  | { kind: "msg"; t: number; msg: M }
  | { kind: "sys"; t: number; id: string; pubkey: string; action: SystemAction };

/**
 * Interleave messages with system lines into one time-ordered list. System
 * lines are only folded in when `includeSystem` is set (callers pass false for
 * non-default channels, à la Discord's single system channel).
 */
export function buildChatTimeline<M extends { t: number }>(
  messages: M[],
  systemEvents: SystemEvent[],
  includeSystem: boolean,
): TimelineItem<M>[] {
  const items: TimelineItem<M>[] = messages.map((m) => ({ kind: "msg", t: m.t, msg: m }));
  if (includeSystem) for (const e of systemEvents) items.push({ kind: "sys", t: e.t, id: `${e.pubkey}-${e.t}-${e.action}`, pubkey: e.pubkey, action: e.action });
  return items.sort((a, b) => a.t - b.t);
}

/**
 * Map audit-log entries to the NEUTRAL system lines members see in-channel:
 * only removals and bans, attributed to the affected member ("[name] was
 * removed by an admin"), with the reason withheld (it stays admin-only in the
 * audit log, as the moderation dialogs promise). Admin role changes
 * (make_admin/remove_admin) and metadata/channel edits produce NO line.
 * Audit times are seconds; timeline times are ms.
 */
export function moderationSystemEvents(auditLog: AuditEntry[]): SystemEvent[] {
  const out: SystemEvent[] = [];
  for (const a of auditLog) {
    if ((a.action === "kick" || a.action === "ban") && a.target) {
      out.push({ pubkey: a.target, action: a.action, t: a.t * 1000 });
    }
  }
  return out;
}

/**
 * Index of the first timeline item strictly newer than the reader's last-read
 * mark — where the "new" divider sits, and the anchor for the "N new" count.
 * Returns -1 when there's no mark (fresh reader) or nothing is newer.
 */
export function firstUnreadIndex(items: { t: number }[], lastRead: number): number {
  return lastRead > 0 ? items.findIndex((i) => i.t > lastRead) : -1;
}

/**
 * Seed a group chat's last-activity clock (ms) when the unread watcher starts:
 * the max of the persisted clock, every channel's read mark, and the moment the
 * community was added locally. The watcher's live `since` window misses
 * long-quiet groups entirely, so without this floor they'd pin to epoch 0 and
 * sink to the bottom of the merged chat list. Non-finite/negative inputs count
 * as "unknown" (0).
 */
export function seedGroupActivity(persisted: number, readMarks: number[], addedAt: number): number {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  let max = Math.max(clean(persisted), clean(addedAt));
  for (const m of readMarks) { const v = clean(m); if (v > max) max = v; }
  return max;
}

// ── Chat time labels + row grouping (the Discord/Slack "5-days-vs-5-minutes"
// orientation cues) ─────────────────────────────────────────────────────────
// Pure and `now`-injected so the day-boundary math is node-testable and stable
// across renders. Timeline `t` is in ms (see effectiveTime / moderationSystemEvents).

const GROUP_WINDOW_MS = 5 * 60 * 1000; // consecutive same-author messages within 5 min tuck together
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** True when two ms timestamps fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

/** Date-divider label: "Today" / "Yesterday" / weekday (within the last week)
 *  / "Mon D" / "Mon D, YYYY" (older or a different year). */
export function chatDayLabel(t: number, now: number): string {
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(t)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(t);
  if (diffDays < 7) return WEEKDAYS[d.getDay()];
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Compact wall-clock time "2:34 PM" (12-hour, hand-rolled so it doesn't depend
 *  on the host's Intl output shape — only its timezone). */
export function chatClockTime(t: number): string {
  const d = new Date(t);
  const mins = d.getMinutes().toString().padStart(2, "0");
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${mins} ${ampm}`;
}

/** Per-row render metadata: a date divider when the calendar day changes, and
 *  whether the row groups under the previous one (same author, same day, within
 *  GROUP_WINDOW_MS — the "tuck consecutive messages" rule). System lines always
 *  break a group. */
export interface ChatRowMeta { dayDivider: string | null; grouped: boolean }
export function chatRowMeta<M extends { t: number; pubkey: string }>(
  items: TimelineItem<M>[],
  now: number,
): ChatRowMeta[] {
  return items.map((item, i) => {
    const prev = i > 0 ? items[i - 1] : null;
    const dayDivider = !prev || !sameLocalDay(prev.t, item.t) ? chatDayLabel(item.t, now) : null;
    const grouped =
      !!prev && dayDivider === null &&
      prev.kind === "msg" && item.kind === "msg" &&
      prev.msg.pubkey === item.msg.pubkey &&
      item.t - prev.t <= GROUP_WINDOW_MS;
    return { dayDivider, grouped };
  });
}

/** A raw decoded guestbook/audit rumor (the shape the stream hands us). */
export interface RawRumor { id: string; pubkey: string; created_at: number; tags: string[][] }

/**
 * Fold guestbook join/leave rumors into newest-first membership events. Dedups
 * by rumor id (the same event can arrive from several relays); any action that
 * isn't explicitly "leave" counts as a join.
 */
export function computeMembershipEvents(rumors: RawRumor[]): MembershipEvent[] {
  const byId = new Map<string, RawRumor>();
  for (const r of rumors) byId.set(r.id, r);
  return [...byId.values()]
    .map((ev) => ({
      pubkey: ev.pubkey,
      action: (ev.tags.find((t) => t[0] === "action")?.[1] === "leave" ? "leave" : "join") as "join" | "leave",
      t: effectiveTime(ev),
    }))
    .sort((a, b) => b.t - a.t);
}

/**
 * Fold audit rumors (kind 3314) into a newest-first moderation log. Dedups by
 * rumor id and drops anything that doesn't parse into a well-formed entry.
 */
export function computeAuditLog(rumors: (RawRumor & { kind?: number; content?: string })[]): AuditEntry[] {
  const byId = new Map<string, AuditEntry>();
  for (const r of rumors) {
    const entry = parseAuditRumor({ kind: KIND_AUDIT, content: "", ...r });
    if (entry) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.t - a.t);
}
