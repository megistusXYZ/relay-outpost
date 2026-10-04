/**
 * What's new in feedback, decided once for every place that shows a count.
 *
 * Before (2026-10-03) there were four counts — the sidebar badge and the
 * Feedback chip counted every unseen crash occurrence (which opening a group
 * never cleared) and closed tickets; the list header counted something else.
 * One rule now:
 *
 *   The operator: open tickets (or "looking into it") from someone else, with
 *   activity from someone else you haven't seen. Your own replies never count,
 *   however late their copy arrives. Tickets you sent elsewhere aren't yours to
 *   answer. App errors are counted apart, once per error.
 *
 *   The person who reported it: their tickets with a reply or status change
 *   from someone else they haven't seen — a close included.
 */
import { getIssueLastRead, markIssuesRead, relayScopedRepoD, type FeedbackIssue } from "./nip34-feedback";
import { isCrashIssue } from "./crash-report";

/** The newest activity on a ticket by anyone but `me` (0 if none). */
export function newestFromOthers(t: FeedbackIssue, me: string | null): number {
  let at = t.reporter !== me ? t.createdAt : 0;
  for (const c of t.comments) if (c.pubkey !== me) at = Math.max(at, c.created_at);
  for (const s of t.statusChanges ?? []) if (s.by !== me) at = Math.max(at, s.at);
  return at;
}

export function hasNewFromOthers(t: FeedbackIssue, me: string | null): boolean {
  const newest = newestFromOthers(t, me);
  return newest > 0 && newest > getIssueLastRead(t.event.id);
}

const waiting = (t: FeedbackIssue) => t.status === "open" || t.status === "draft";

/** Tickets waiting on the operator — the one count behind badge, chip and list. */
export function feedbackNeedsYou(issues: FeedbackIssue[], me: string | null): FeedbackIssue[] {
  return issues.filter((t) => !isCrashIssue(t) && t.reporter !== me && waiting(t) && hasNewFromOthers(t, me));
}

const sigOf = (t: FeedbackIssue) => t.event.tags.find((x) => x[0] === "crash-sig")?.[1] || t.event.id;

/** App errors with an occurrence you haven't seen: one entry per error (its signature). */
export function newAppErrorGroups(issues: FeedbackIssue[]): string[] {
  const sigs = new Set<string>();
  for (const t of issues) if (isCrashIssue(t) && t.latestActivityAt > getIssueLastRead(t.event.id)) sigs.add(sigOf(t));
  return [...sigs];
}

/** Opening an error clears every occurrence of it, not just the latest. */
export function markAppErrorGroupRead(issues: FeedbackIssue[], sig: string): void {
  markIssuesRead(issues.filter((t) => isCrashIssue(t) && sigOf(t) === sig));
}

/** The reporter's side: tickets they sent with news from someone else. */
export function ticketUpdates(issues: FeedbackIssue[], me: string | null): FeedbackIssue[] {
  if (!me) return [];
  return issues.filter((t) => t.reporter === me && hasNewFromOthers(t, me));
}

const host = (u: string) => u.replace(/^wss?:\/\//, "").replace(/\/+$/, "").toLowerCase();

/**
 * Which relay a ticket is about: its ["relay", url] tag (new private tickets
 * carry one), or the relay-scoped repo in its `a` tag. Older private tickets
 * name no relay, so an operator who runs several sees them as "not tied to a
 * relay" rather than in every relay's inbox as if they belonged there.
 */
export function ticketsForRelay(issues: FeedbackIssue[], relayUrl: string): { here: FeedbackIssue[]; untied: FeedbackIssue[] } {
  const d = relayScopedRepoD(relayUrl);
  const here: FeedbackIssue[] = [];
  const untied: FeedbackIssue[] = [];
  for (const t of issues) {
    const relayTag = t.event.tags.find((x) => x[0] === "relay")?.[1];
    const repo = t.event.tags.find((x) => x[0] === "a" && x[1]?.startsWith("30617:"))?.[1];
    if (relayTag) { if (host(relayTag) === host(relayUrl)) here.push(t); }
    else if (repo) { if (repo.split(":").slice(2).join(":") === d) here.push(t); }
    else untied.push(t);
  }
  return { here, untied };
}

export type ThreadItem =
  | { kind: "reply"; event: FeedbackIssue["comments"][number]; at: number }
  | { kind: "status"; status: FeedbackIssue["status"]; by: string; at: number };

/**
 * A ticket's conversation in time order: replies with words, and each status
 * change as its own line ("Harbour Club marked this Resolved"). A private
 * status change travels as an empty message; it was shown as an empty bubble.
 */
export function threadItems(t: FeedbackIssue): ThreadItem[] {
  const items: ThreadItem[] = [];
  for (const c of t.comments) if (c.content.trim()) items.push({ kind: "reply", event: c, at: c.created_at });
  for (const s of t.statusChanges ?? []) items.push({ kind: "status", status: s.status, by: s.by, at: s.at });
  // Same second: the words first, then the status they came with.
  return items.sort((a, b) => a.at - b.at || (a.kind === b.kind ? 0 : a.kind === "reply" ? -1 : 1));
}

/** The operator's inbox: everything addressed to you — not tickets you sent to someone else. */
export function inboxTickets(issues: FeedbackIssue[], me: string | null): FeedbackIssue[] {
  return issues.filter((t) => {
    if (t.reporter !== me) return true;
    const to = t.event.tags.filter((x) => x[0] === "p").map((x) => x[1]);
    return to.length === 0 || to.includes(me!);
  });
}

/** The operator's inbox for one relay: addressed to you, about this relay (or no relay). Used by the badge and the list alike. */
export function operatorInbox(all: FeedbackIssue[], me: string | null, relayUrl: string): { issues: FeedbackIssue[]; untiedIds: Set<string> } {
  const mine = inboxTickets(all, me);
  const { here, untied } = ticketsForRelay(mine, relayUrl);
  const keep = new Set([...here, ...untied]);
  return { issues: mine.filter((t) => keep.has(t)), untiedIds: new Set(untied.map((t) => t.event.id)) };
}
