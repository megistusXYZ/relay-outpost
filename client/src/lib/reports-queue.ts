import type { Event } from "nostr-tools";
import type { GroupAdmin, GroupMetadata } from "@/lib/nip29";
import { isGroupModerator } from "@/lib/admission-queue";
import { reportTypesFromEvent, severityFromReportTypes, type Severity } from "@/lib/follow-flag-verdict";

/**
 * The reports queue: everything people have flagged in a space you run, from
 * every space you run, in one list.
 *
 * The same shape the admission queue turned out to be, and worth saying plainly
 * because the plan doc asked for the check: the pieces already existed.
 * ReportDialog writes kind-1984, follow-flag-verdict parses NIP-56 types out of
 * one, RecoverFollows and nip86 both run working `#p` report queries, and
 * admission-queue already knows which groups you moderate. What did not exist
 * was the AGGREGATE — nothing read reports ABOUT YOUR SPACES and put them
 * anywhere a moderator would look.
 *
 * Pure functions over data the caller already fetched, so the rules that decide
 * what is actionable and what order it comes in are testable without a relay.
 */

/** One thing people have flagged, in one space. */
export interface PendingReport {
  relayUrl: string;
  groupId: string;
  /** Group name when metadata resolved; the caller falls back to the id. */
  groupName?: string;
  /**
   * What was flagged. An `e` tag means a specific message; with only a `p` tag
   * the report is about the PERSON, which is a different decision for the
   * moderator and is rendered differently.
   */
  targetEventId?: string;
  targetPubkey: string;
  /** Distinct accounts that filed a report against this target. */
  reporters: string[];
  /** Worst NIP-56 severity across those reports — nudity/illegal outrank spam. */
  severity: Severity;
  /** Earliest report: how long this has sat unhandled. */
  firstReportedAt: number;
  /** Newest report: whether it is still happening. */
  lastReportedAt: number;
  /** Report event ids, so the caller can mark them handled. */
  reportIds: string[];
  /**
   * How much this row has to do with THIS room. Three different things were
   * being presented as one:
   *
   *  - `in-room`  the reported message carries `h` = this group. Proven.
   *  - `about-person`  the report names a person and no message at all, so
   *    NIP-56 gives nothing to locate it with. Real signal for "should this
   *    member stay", not evidence about anything said here.
   *  - `unverified`  a message was named but the relay would not return it, so
   *    we do not know. Said out loud rather than guessed either way.
   */
  scope: ReportScope;
}

export type ReportScope = "in-room" | "about-person" | "unverified";

/**
 * Spaces worth polling for reports: ones this account actually moderates.
 *
 * Deliberately NOT filtered to closed groups, which is where this parts company
 * with `admittableGroups`. A closed group has nothing to admit anyone to, so
 * polling an open one for join requests is wasted. Reports are the opposite —
 * an OPEN group is the one that needs watching, because anyone can post in it.
 */
export function moderatedGroups(
  groups: GroupMetadata[],
  adminsByGroupId: Map<string, GroupAdmin[]>,
  myPubkey: string | null | undefined,
): GroupMetadata[] {
  if (!myPubkey) return [];
  return groups.filter((g) => isGroupModerator(adminsByGroupId.get(g.id), myPubkey));
}

function firstTagValue(ev: Event, name: string): string | undefined {
  const t = (ev.tags ?? []).find((x) => x[0] === name && typeof x[1] === "string" && x[1]);
  return t?.[1];
}

/**
 * Fold raw kind-1984 events into one row per TARGET.
 *
 * Grouping by target rather than listing every report is the whole point. Ten
 * people flagging one message is ONE decision for a moderator, and it is a
 * stronger signal than ten separate things flagged once each — but a flat list
 * renders it as ten rows of noise and buries everything else. Collapsing also
 * makes brigading legible instead of overwhelming: one row that says ten people.
 *
 * Dropped, in each case for a reason:
 *  - reports you filed yourself — you already know
 *  - reports naming YOU — being the subject is not moderating; that belongs in
 *    a personal notification, not in the queue of things you decide about
 *  - a person reporting themselves, which is either a mistake or a probe
 *  - the same account reporting the same target twice, which would otherwise
 *    let one person manufacture the appearance of a crowd
 */
/**
 * How far back a report may reach and still claim a moderator's attention.
 *
 * The queue's own ordering note says age is the LAST key — a week-old flag must
 * not outrank eight from this morning. This is the other half of that idea:
 * past some age a report stops being a decision at all. The kind-1984 sweep is
 * a `#p` over current members with no time bound, so without a horizon a
 * three-year-old report about a long-standing member surfaced in Needs-you
 * above fresh mentions (owner screenshot, 2026-08-13), pointing at a message
 * no relay would even serve. Ninety days is generous for "harm sitting in a
 * room right now"; anything older is history, not a queue item.
 */
export const REPORT_HORIZON_SECONDS = 90 * 24 * 60 * 60;

export function reportsFor(
  group: { id: string; relayUrl: string; name?: string },
  reportEvents: Event[],
  myPubkey: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PendingReport[] {
  const byTarget = new Map<string, PendingReport>();

  for (const ev of reportEvents ?? []) {
    if (!ev || ev.kind !== 1984) continue;
    // Outside the horizon a report neither creates a row nor pads a fresh
    // target's reporter count — the count leads the ordering, so a stale
    // report inflating it would let ancient history outrank fresh harm.
    if (nowSeconds - ev.created_at > REPORT_HORIZON_SECONDS) continue;
    if (myPubkey && ev.pubkey === myPubkey) continue;

    const targetPubkey = firstTagValue(ev, "p");
    if (!targetPubkey) continue;
    if (myPubkey && targetPubkey === myPubkey) continue;
    if (targetPubkey === ev.pubkey) continue;

    const targetEventId = firstTagValue(ev, "e");
    const key = targetEventId ? `e:${targetEventId}` : `p:${targetPubkey}`;
    // The second argument is not optional: reportTypesFromEvent only reads a
    // type off the `p` tag that names THIS target, so calling it without one
    // silently returns just the bare ["report", type] tags and every severity
    // collapses to neutral. The test for "keep the worst severity" caught it.
    const severity = severityFromReportTypes(reportTypesFromEvent(ev, targetPubkey));

    const existing = byTarget.get(key);
    if (!existing) {
      byTarget.set(key, {
        relayUrl: group.relayUrl,
        groupId: group.id,
        groupName: group.name,
        targetEventId,
        targetPubkey,
        reporters: [ev.pubkey],
        severity,
        firstReportedAt: ev.created_at,
        lastReportedAt: ev.created_at,
        reportIds: [ev.id],
        // Nothing is resolved yet. A person-only report can be classified
        // immediately — there is no message to check — while a message report
        // stays unverified until applyGroupScope sees the event itself.
        scope: targetEventId ? "unverified" : "about-person",
      });
      continue;
    }
    if (!existing.reporters.includes(ev.pubkey)) existing.reporters.push(ev.pubkey);
    if (!existing.reportIds.includes(ev.id)) existing.reportIds.push(ev.id);
    existing.firstReportedAt = Math.min(existing.firstReportedAt, ev.created_at);
    existing.lastReportedAt = Math.max(existing.lastReportedAt, ev.created_at);
    existing.severity = worstOf(existing.severity, severity);
  }

  return [...byTarget.values()];
}

const SEVERITY_RANK: Record<Severity, number> = { severe: 2, mild: 1, neutral: 0 };

function worstOf(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/**
 * Most-reported first, then most severe, then oldest.
 *
 * The admission queue leads with the LONGEST WAIT, because there the queue is
 * people and the cost of delay falls on the person kept outside. A report queue
 * is not people waiting, it is harm sitting in a room — so it leads with how
 * many independent accounts objected, which is the one signal here that is
 * expensive to fake. Severity breaks ties, because a single nudity report and a
 * single spam report are not the same call.
 *
 * Age is the LAST key rather than the first, and that is the deliberate part: a
 * thing one person flagged a week ago should not outrank a thing eight people
 * flagged an hour ago.
 */
export function orderQueue(items: PendingReport[]): PendingReport[] {
  return [...(items ?? [])].sort(
    (a, b) =>
      // Scope FIRST. Something said in this room is a decision this moderator
      // can actually make; a member reported elsewhere is context. Five reports
      // about somebody's conduct on the open network should not outrank one
      // about a message sitting in the room right now.
      // `?? 0` rather than a bare lookup: a row without a scope would make this
      // NaN, and NaN is falsy, so the comparison would silently fall through to
      // the next key. Passing by accident is not passing.
      ((SCOPE_RANK[b.scope] ?? 0) - (SCOPE_RANK[a.scope] ?? 0)) ||
      b.reporters.length - a.reporters.length ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.firstReportedAt - b.firstReportedAt,
  );
}

/** The `h` tag is the only thing NIP-29 gives us that names a message's room. */
export function groupIdOfEvent(ev: { tags?: string[][] } | null | undefined): string | undefined {
  return (ev?.tags ?? []).find((t) => t[0] === "h" && t[1])?.[1];
}

/**
 * Decide, per row, whether the reported message actually belongs to this room.
 *
 * This is the fix for the honest-approximation caveat the query carries. Reports
 * are found by `#p` over the member list, because NIP-56 has no notion of a
 * group — so a member reported for something they said SOMEWHERE ELSE comes
 * back too. But every report this app writes names a specific message
 * (ReportDialog always tags `e`), and every NIP-29 message names its room (`h`).
 * Resolve the one and read the other and the question stops being a guess.
 *
 * Rows whose message provably belongs to a DIFFERENT room are dropped: a
 * moderator here cannot act on them and did not ask to see them. Rows that
 * cannot be resolved are kept and marked, because a relay declining to serve an
 * event is not evidence that the event was innocent.
 */
export function applyGroupScope(
  rows: PendingReport[],
  resolvedById: ReadonlyMap<string, { tags?: string[][] } | null>,
  groupId: string,
): PendingReport[] {
  const out: PendingReport[] = [];
  for (const row of rows ?? []) {
    if (!row.targetEventId) {
      out.push({ ...row, scope: "about-person" });
      continue;
    }
    if (!resolvedById.has(row.targetEventId)) {
      out.push({ ...row, scope: "unverified" });
      continue;
    }
    const ev = resolvedById.get(row.targetEventId);
    const h = groupIdOfEvent(ev);
    if (h === groupId) {
      out.push({ ...row, scope: "in-room" });
    } else if (h) {
      continue; // provably another room — not this moderator's call
    } else {
      // Resolved, but carries no `h` at all: not a group message. Reported
      // content from the open network about someone who is also a member here.
      out.push({ ...row, scope: "about-person" });
    }
  }
  return out;
}

const SCOPE_RANK: Record<ReportScope, number> = { "in-room": 2, unverified: 1, "about-person": 0 };

/**
 * Drop reports whose message has already been removed from the room.
 *
 * A NIP-29 delete removes the MESSAGE, not the report about it. The kind-1984
 * stays on the relay forever, so without this the queue re-raises work that is
 * already done — and does it wearing the wrong label: `fetchEventsByIds` cannot
 * resolve an event that no longer exists, so the row comes back as `unverified`
 * reading "Message could not be loaded from this relay". The moderator deleted
 * it; the queue tells them it might not have happened. Seen live, immediately
 * after the first successful Remove.
 *
 * Keyed on the relay's own kind-9005 record rather than local state, so it also
 * covers the case that matters more: a CO-MODERATOR removed it, on another
 * device, and this moderator should never see the row at all.
 *
 * Deliberately one-directional — presence of a delete means handled, absence
 * means nothing. Not every relay retains 9005, and treating "no delete found"
 * as "still outstanding" is the safe way round: the cost is re-showing a handled
 * report, never hiding a live one.
 */
export function dropHandled(
  rows: PendingReport[],
  deletedEventIds: ReadonlySet<string>,
): PendingReport[] {
  if (!deletedEventIds?.size) return rows ?? [];
  // A person-report has no message to have been deleted, so it can never be
  // resolved this way and must survive untouched.
  return (rows ?? []).filter((r) => !r.targetEventId || !deletedEventIds.has(r.targetEventId));
}

/**
 * The heading above the queue — naming what was actually reported.
 *
 * This queue holds two genuinely different decisions, and the rows already know
 * which is which: a `targetEventId` means somebody flagged a MESSAGE (Remove
 * deletes that message), its absence means somebody flagged the ACCOUNT (there
 * is nothing to delete, the question is whether this member stays).
 *
 * The heading used to say "1 thing was reported" for both. Vague, but honestly
 * vague — and calling them all "accounts" would be worse than vague, it would be
 * wrong: it tells a moderator that someone flagged a person when they flagged a
 * post. That is the difference between "review this message" and "should this
 * member stay", decided before the moderator has read a row.
 *
 * So: say which, because we know. Mixed queues fall back to a neutral count
 * rather than inventing a noun that covers both — "3 reports" is honest, and the
 * rows themselves carry the distinction from there.
 */
export function describeReportQueue(rows: PendingReport[] | null | undefined): string {
  const list = rows ?? [];
  const n = list.length;
  if (n === 0) return "";

  const messages = list.filter((r) => !!r.targetEventId).length;
  // All one kind → name that kind. Mixed → count reports, not subjects.
  if (messages === n) return n === 1 ? "1 message was reported" : `${n} messages were reported`;
  if (messages === 0) return n === 1 ? "1 account was reported" : `${n} accounts were reported`;
  return `${n} reports need you`;
}

/** One queue across every space, ordered by the rule above. */
export function mergeQueues(queues: PendingReport[][]): PendingReport[] {
  return orderQueue((queues ?? []).flat());
}

/**
 * One set of report EVENTS from several relays, deduped by id.
 *
 * Reports are now read from two places that answer the same question — the
 * group's relay (for the rare host that stores kind-1984) and the public
 * relays, where they actually live. Six relays holding the same report is the
 * normal case, not the exception.
 *
 * HONEST SCOPE, because the first version of this comment overclaimed: this is
 * NOT what stops one complaint from outranking a genuine pile-on. `reportsFor`
 * already guards that itself — it pushes a reporter only `if
 * (!existing.reporters.includes(...))` and a report id only `if
 * (!existing.reportIds.includes(...))`, so the ordering is safe with or without
 * this function. A sabotage run proved it: replacing this body with a plain
 * concat left the ordering tests green.
 *
 * What it actually buys is smaller and still worth having — one pass instead of
 * six over the same event, and a clean event set for any future consumer that
 * is not `reportsFor` and therefore does not carry its own dedupe. Defence in
 * depth, named as such rather than dressed up as the load-bearing guard.
 *
 * Keyed on event id, so the same report relayed by six hosts collapses to one
 * while two genuinely different reports from the same person do not.
 */
export function mergeReportEvents(...lists: (Event[] | null | undefined)[]): Event[] {
  const byId = new Map<string, Event>();
  for (const list of lists) {
    for (const ev of list ?? []) {
      if (!ev?.id || byId.has(ev.id)) continue;
      byId.set(ev.id, ev);
    }
  }
  return [...byId.values()];
}
