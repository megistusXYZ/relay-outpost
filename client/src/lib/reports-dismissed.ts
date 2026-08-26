/**
 * Dismissing a report has to outlive the render that dismissed it.
 *
 * The ✕ on a report row called `removeLocally`, which filtered the item out of
 * React state and nothing else. That works until the next sweep — and the sweep
 * re-fetches from the relay, where a kind-1984 lives forever, so the row came
 * straight back. Reported as "why is this ALWAYS showing", about a three-year-old
 * report on a message the relay would not even return.
 *
 * WHY A TIMESTAMP AND NOT A BOOLEAN. "I have dealt with this" is a claim about
 * what the moderator has SEEN, not a permanent mute on a person or a message. If
 * someone is reported again tomorrow, that is new information and the row has
 * earned its way back. Storing the newest report's time at the moment of
 * dismissal gives exactly that: hidden until something newer arrives.
 *
 * LOCAL, not published. A dismissal is a private moderator note about their own
 * queue; publishing it would leak which reports an operator has looked at and
 * declined to act on. Cross-device sync is a fair follow-up, deliberately not
 * assumed here.
 */
import type { PendingReport } from "@/lib/reports-queue";

const PREFIX = "ro_reports_dismissed_";

/** Identity of the THING reported, which is what a moderator dismisses. */
export function reportKey(r: Pick<PendingReport, "relayUrl" | "groupId" | "targetEventId" | "targetPubkey">): string {
  return `${r.relayUrl}|${r.groupId}|${r.targetEventId ?? r.targetPubkey}`;
}

/** Per viewer: two moderators on one device do not share a queue. */
function storageKey(viewer: string | null | undefined): string {
  return `${PREFIX}${viewer || "anon"}`;
}

export function readDismissed(viewer: string | null | undefined): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey(viewer));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function dismissReport(viewer: string | null | undefined, r: PendingReport): void {
  try {
    const map = readDismissed(viewer);
    // The newest report we know about right now. Anything filed AFTER this
    // moment is unseen and must reappear.
    map[reportKey(r)] = Math.max(map[reportKey(r)] ?? 0, r.lastReportedAt || 0);
    localStorage.setItem(storageKey(viewer), JSON.stringify(map));
  } catch {
    // A full or blocked localStorage must not break moderation — the row simply
    // returns on the next sweep, which is the old behaviour, not a new bug.
  }
}

/**
 * Hidden only while nothing newer has happened.
 *
 * `>=` because the dismissal records the newest report the moderator saw; an
 * equal timestamp is that same report, not a new one.
 */
export function isDismissed(r: PendingReport, map: Record<string, number>): boolean {
  const at = map[reportKey(r)];
  return typeof at === "number" && (r.lastReportedAt || 0) <= at;
}

export function filterDismissed(queue: PendingReport[], map: Record<string, number>): PendingReport[] {
  return queue.filter((r) => !isDismissed(r, map));
}
