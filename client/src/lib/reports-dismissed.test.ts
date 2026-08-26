/**
 * "Why is this always showing?" — a three-year-old report on a message the
 * relay would not even return, back on screen after every dismissal.
 *
 * The ✕ filtered React state and nothing else. A kind-1984 is permanent and
 * public, so the next sweep re-fetched it and the row returned. The control
 * looked like it worked and never did.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import { dismissReport, readDismissed, isDismissed, filterDismissed, reportKey } from "./reports-dismissed";
import type { PendingReport } from "./reports-queue";

const ME = "aa".repeat(32);
const OTHER = "bb".repeat(32);

function report(o: Partial<PendingReport> & { lastReportedAt: number }): PendingReport {
  return {
    relayUrl: "wss://relay.test",
    groupId: "room1",
    targetPubkey: "cc".repeat(32),
    targetEventId: "ee".repeat(32),
    reporters: ["dd".repeat(32)],
    severity: "spam",
    firstReportedAt: o.lastReportedAt,
    reportIds: ["ff".repeat(32)],
    scope: "in-room",
    ...o,
  } as PendingReport;
}

describe("dismissing a report", () => {
  beforeEach(() => backing.clear());

  it("survives the next sweep — the whole bug", () => {
    const r = report({ lastReportedAt: 1000 });
    dismissReport(ME, r);
    // A sweep re-fetches the same permanent event and hands it back.
    expect(filterDismissed([r], readDismissed(ME))).toEqual([]);
  });

  it("comes back when the target is reported AGAIN", () => {
    // Dismissal is "I have seen this", not a permanent mute on a person. New
    // evidence has earned its way back onto the queue.
    const seen = report({ lastReportedAt: 1000 });
    dismissReport(ME, seen);
    const reportedAgain = report({ lastReportedAt: 2000 });
    expect(isDismissed(reportedAgain, readDismissed(ME))).toBe(false);
  });

  it("stays dismissed for the same report arriving twice", () => {
    const r = report({ lastReportedAt: 1000 });
    dismissReport(ME, r);
    expect(isDismissed(report({ lastReportedAt: 1000 }), readDismissed(ME))).toBe(true);
  });

  it("does not leak between moderators on one device", () => {
    const r = report({ lastReportedAt: 1000 });
    dismissReport(ME, r);
    expect(isDismissed(r, readDismissed(OTHER))).toBe(false);
  });

  it("keeps rooms and relays apart", () => {
    dismissReport(ME, report({ lastReportedAt: 1000 }));
    const map = readDismissed(ME);
    expect(isDismissed(report({ lastReportedAt: 1000, groupId: "room2" }), map)).toBe(false);
    expect(isDismissed(report({ lastReportedAt: 1000, relayUrl: "wss://other.test" }), map)).toBe(false);
  });

  it("keys a person-only report on the person, since there is no message", () => {
    const personOnly = report({ lastReportedAt: 5, targetEventId: undefined, scope: "about-person" });
    expect(reportKey(personOnly)).toContain(personOnly.targetPubkey);
    dismissReport(ME, personOnly);
    expect(isDismissed(personOnly, readDismissed(ME))).toBe(true);
  });

  it("survives corrupt storage rather than taking the queue down", () => {
    backing.set("ro_reports_dismissed_" + ME, "{not json");
    expect(readDismissed(ME)).toEqual({});
    expect(filterDismissed([report({ lastReportedAt: 1 })], readDismissed(ME))).toHaveLength(1);
  });
});
