import { describe, it, expect } from "vitest";
import { moderatedGroups, reportsFor, orderQueue, mergeQueues, mergeReportEvents, applyGroupScope, groupIdOfEvent, dropHandled, describeReportQueue, REPORT_HORIZON_SECONDS, type PendingReport } from "./reports-queue";
import type { Event } from "nostr-tools";
import type { GroupAdmin, GroupMetadata } from "@/lib/nip29";

// Valid hex. "me".padEnd(64,"0") contains 'm', which is not a hex digit —
// harmless while isGroupModerator compared raw strings, and correctly refused
// once it normalizes both sides.
const ME = "de".repeat(32);
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const TARGET = "fa".repeat(32);

const report = (
  reporter: string,
  opts: { p?: string; e?: string; at?: number; types?: string[]; id?: string } = {},
): Event =>
  ({
    id: opts.id ?? `${reporter}-${opts.e ?? opts.p ?? "x"}-${opts.at ?? 1}`,
    kind: 1984,
    pubkey: reporter,
    created_at: opts.at ?? 1000,
    content: "",
    sig: "s",
    tags: [
      ["p", opts.p ?? TARGET, ...(opts.types ?? [])],
      ...(opts.e ? [["e", opts.e, ...(opts.types ?? [])]] : []),
    ],
  }) as Event;

const GROUP = { id: "g1", relayUrl: "wss://r", name: "Space" };

describe("moderatedGroups — reports watch OPEN rooms too", () => {
  const g = (id: string, isClosed: boolean): GroupMetadata => ({ id, isClosed } as GroupMetadata);
  const admins = (pk: string): GroupAdmin[] => [{ pubkey: pk } as GroupAdmin];

  it("includes a group you moderate whether it is open or closed", () => {
    // Where this parts company with admittableGroups: a closed group has nothing
    // to admit anyone to, so polling an OPEN one for join requests is wasted.
    // Reports invert that — the open room is the one anyone can post in.
    const groups = [g("open", false), g("closed", true)];
    const byId = new Map([["open", admins(ME)], ["closed", admins(ME)]]);
    expect(moderatedGroups(groups, byId, ME).map((x) => x.id)).toEqual(["open", "closed"]);
  });

  it("excludes groups you do not moderate", () => {
    const byId = new Map([["open", admins(ALICE)]]);
    expect(moderatedGroups([g("open", false)], byId, ME)).toEqual([]);
  });

  it("returns nothing when signed out", () => {
    const byId = new Map([["open", admins(ME)]]);
    expect(moderatedGroups([g("open", false)], byId, null)).toEqual([]);
  });
});

describe("reportsFor — one row per target, not per report", () => {
  it("collapses many reports of one message into a single decision", () => {
    // Ten people flagging one message is ONE decision. A flat list renders it as
    // ten rows and buries everything else.
    const evs = [
      report(ALICE, { e: "msg1", at: 100 }),
      report(BOB, { e: "msg1", at: 200 }),
      report(CAROL, { e: "msg1", at: 300 }),
    ];
    const rows = reportsFor(GROUP, evs, ME, 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0].reporters).toHaveLength(3);
    expect(rows[0].firstReportedAt).toBe(100);
    expect(rows[0].lastReportedAt).toBe(300);
    expect(rows[0].reportIds).toHaveLength(3);
  });

  it("counts one account once, however many times it files", () => {
    // Otherwise one person manufactures the appearance of a crowd, and the
    // ordering rule below is built entirely on that count.
    const evs = [
      report(ALICE, { e: "msg1", at: 100, id: "r1" }),
      report(ALICE, { e: "msg1", at: 150, id: "r2" }),
      report(ALICE, { e: "msg1", at: 200, id: "r3" }),
    ];
    expect(reportsFor(GROUP, evs, ME, 2000)[0].reporters).toEqual([ALICE]);
  });

  it("keeps a message report separate from a person report", () => {
    // Different decisions: delete one message vs remove someone from the room.
    const rows = reportsFor(GROUP, [report(ALICE, { e: "msg1" }), report(BOB, {})], ME, 2000);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.targetEventId === "msg1")).toBeTruthy();
    expect(rows.find((r) => r.targetEventId === undefined)?.targetPubkey).toBe(TARGET);
  });

  it("drops reports you filed yourself", () => {
    expect(reportsFor(GROUP, [report(ME, { e: "msg1" })], ME, 2000)).toEqual([]);
  });

  it("drops reports naming YOU", () => {
    // Being the subject is not moderating. That belongs in a personal
    // notification, not the queue of things you decide about.
    expect(reportsFor(GROUP, [report(ALICE, { p: ME })], ME, 2000)).toEqual([]);
  });

  it("drops someone reporting themselves", () => {
    expect(reportsFor(GROUP, [report(ALICE, { p: ALICE })], ME, 2000)).toEqual([]);
  });

  it("ignores events that are not reports, and reports naming nobody", () => {
    const notAReport = { ...report(ALICE, {}), kind: 1 } as Event;
    const noTarget = { ...report(ALICE, {}), tags: [] } as Event;
    expect(reportsFor(GROUP, [notAReport, noTarget], ME, 2000)).toEqual([]);
    expect(reportsFor(GROUP, [], ME, 2000)).toEqual([]);
  });

  it("carries the group's identity onto every row", () => {
    const row = reportsFor(GROUP, [report(ALICE, { e: "m" })], ME, 2000)[0];
    expect(row.groupId).toBe("g1");
    expect(row.relayUrl).toBe("wss://r");
    expect(row.groupName).toBe("Space");
  });

  it("keeps the WORST severity across reports of the same target", () => {
    // One person calling it spam and another calling it illegal is not a spam
    // decision.
    const rows = reportsFor(GROUP, [
      report(ALICE, { e: "m", types: ["spam"] }),
      report(BOB, { e: "m", types: ["illegal"] }),
    ], ME, 2000);
    expect(rows[0].severity).toBe("severe");
  });
});

describe("orderQueue — the crowd first, not the clock", () => {
  const row = (over: Partial<ReturnType<typeof reportsFor>[number]>) =>
    ({
      relayUrl: "wss://r", groupId: "g", targetPubkey: TARGET,
      reporters: [ALICE], severity: "neutral" as const,
      firstReportedAt: 1000, lastReportedAt: 1000, reportIds: ["x"],
      ...over,
    });

  it("puts the most-reported thing first", () => {
    const out = orderQueue([
      row({ targetEventId: "one", reporters: [ALICE] }),
      row({ targetEventId: "many", reporters: [ALICE, BOB, CAROL] }),
    ]);
    expect(out[0].targetEventId).toBe("many");
  });

  it("does NOT lead with the longest wait, unlike the admission queue", () => {
    // Deliberate divergence. An admission queue is people kept outside, so the
    // longest wait leads. A report queue is harm sitting in a room: eight people
    // an hour ago outranks one person last week.
    const out = orderQueue([
      row({ targetEventId: "old-lonely", reporters: [ALICE], firstReportedAt: 1 }),
      row({ targetEventId: "new-crowd", reporters: [ALICE, BOB, CAROL], firstReportedAt: 9999 }),
    ]);
    expect(out[0].targetEventId).toBe("new-crowd");
  });

  it("breaks a tie on severity before age", () => {
    const out = orderQueue([
      row({ targetEventId: "mild", severity: "mild", firstReportedAt: 1 }),
      row({ targetEventId: "severe", severity: "severe", firstReportedAt: 5000 }),
    ]);
    expect(out[0].targetEventId).toBe("severe");
  });

  it("falls back to oldest-first when count and severity match", () => {
    const out = orderQueue([
      row({ targetEventId: "newer", firstReportedAt: 5000 }),
      row({ targetEventId: "older", firstReportedAt: 100 }),
    ]);
    expect(out[0].targetEventId).toBe("older");
  });

  it("does not mutate its input", () => {
    const input = [row({ targetEventId: "a" }), row({ targetEventId: "b", reporters: [ALICE, BOB] })];
    orderQueue(input);
    expect(input[0].targetEventId).toBe("a");
  });

  it("survives empty and missing input", () => {
    expect(orderQueue([])).toEqual([]);
    expect(orderQueue(undefined as never)).toEqual([]);
  });
});

describe("mergeQueues — every space, one list", () => {
  const row = (id: string, reporters: string[]) =>
    ({
      relayUrl: "wss://r", groupId: id, targetPubkey: TARGET, targetEventId: id,
      reporters, severity: "neutral" as const,
      firstReportedAt: 1000, lastReportedAt: 1000, reportIds: [id],
    });

  it("orders across spaces, not within them", () => {
    // The point of the aggregate: a moderator with three rooms sees the worst
    // thing first regardless of which room it is in.
    const out = mergeQueues([
      [row("quiet", [ALICE])],
      [row("busy", [ALICE, BOB, CAROL])],
    ]);
    expect(out.map((r) => r.groupId)).toEqual(["busy", "quiet"]);
  });

  it("survives empty and missing input", () => {
    expect(mergeQueues([])).toEqual([]);
    expect(mergeQueues([[], []])).toEqual([]);
    expect(mergeQueues(undefined as never)).toEqual([]);
  });
});

describe("applyGroupScope — proving which room a report is about", () => {
  const base = (over: Partial<PendingReport> = {}): PendingReport =>
    ({
      relayUrl: "wss://r", groupId: "g1", targetPubkey: TARGET,
      reporters: [ALICE], severity: "neutral", firstReportedAt: 1,
      lastReportedAt: 1, reportIds: ["r"], scope: "unverified", ...over,
    }) as PendingReport;
  const msg = (h?: string) => ({ tags: h ? [["h", h]] : [] });

  it("proves a report belongs to this room via the message's h tag", () => {
    // The fix for the #p-scoped query's blind spot: NIP-56 cannot say which
    // room, but the reported MESSAGE can, and every report this app writes
    // names one.
    const rows = [base({ targetEventId: "m1" })];
    const out = applyGroupScope(rows, new Map([["m1", msg("g1")]]), "g1");
    expect(out).toHaveLength(1);
    expect(out[0].scope).toBe("in-room");
  });

  it("DROPS a report whose message provably belongs to another room", () => {
    // This is the noise the caveat described. A moderator here cannot act on it
    // and did not ask to see it.
    const out = applyGroupScope([base({ targetEventId: "m1" })], new Map([["m1", msg("other")]]), "g1");
    expect(out).toEqual([]);
  });

  it("keeps an unresolvable message and says so, rather than guessing", () => {
    // A relay declining to serve an event is not evidence the event was fine.
    const out = applyGroupScope([base({ targetEventId: "m1" })], new Map(), "g1");
    expect(out[0].scope).toBe("unverified");
  });

  it("treats a person-only report as about the person, not the room", () => {
    const out = applyGroupScope([base({ targetEventId: undefined })], new Map(), "g1");
    expect(out[0].scope).toBe("about-person");
  });

  it("treats a resolved non-group message as about the person", () => {
    // Reported content from the open network, by someone who is also a member.
    const out = applyGroupScope([base({ targetEventId: "m1" })], new Map([["m1", msg(undefined)]]), "g1");
    expect(out[0].scope).toBe("about-person");
  });

  it("survives a null resolution without dropping the row silently", () => {
    const out = applyGroupScope([base({ targetEventId: "m1" })], new Map([["m1", null]]), "g1");
    expect(out[0].scope).toBe("about-person");
  });

  it("does not mutate its input", () => {
    const rows = [base({ targetEventId: "m1" })];
    applyGroupScope(rows, new Map([["m1", msg("g1")]]), "g1");
    expect(rows[0].scope).toBe("unverified");
  });
});

describe("orderQueue — scope outranks the crowd", () => {
  const row = (over: Partial<PendingReport>): PendingReport =>
    ({
      relayUrl: "wss://r", groupId: "g", targetPubkey: TARGET,
      reporters: [ALICE], severity: "neutral", firstReportedAt: 1000,
      lastReportedAt: 1000, reportIds: ["x"], scope: "in-room", ...over,
    }) as PendingReport;

  it("puts one in-room report above a bigger crowd from elsewhere", () => {
    // Five people objecting to somebody's conduct on the open network is
    // context; one message sitting in this room right now is a decision.
    const out = orderQueue([
      row({ targetEventId: "elsewhere", scope: "about-person", reporters: [ALICE, BOB, CAROL] }),
      row({ targetEventId: "here", scope: "in-room", reporters: [ALICE] }),
    ]);
    expect(out[0].targetEventId).toBe("here");
  });

  it("still ranks by crowd size within the same scope", () => {
    const out = orderQueue([
      row({ targetEventId: "one", reporters: [ALICE] }),
      row({ targetEventId: "many", reporters: [ALICE, BOB, CAROL] }),
    ]);
    expect(out[0].targetEventId).toBe("many");
  });

  it("ranks unverified between proven and person-level", () => {
    const out = orderQueue([
      row({ targetEventId: "person", scope: "about-person" }),
      row({ targetEventId: "unknown", scope: "unverified" }),
      row({ targetEventId: "proven", scope: "in-room" }),
    ]);
    expect(out.map((r) => r.targetEventId)).toEqual(["proven", "unknown", "person"]);
  });
});

describe("dropHandled — a removed message is not still your problem", () => {
  const row = (over: Partial<PendingReport>): PendingReport =>
    ({
      relayUrl: "wss://r", groupId: "g", targetPubkey: TARGET,
      reporters: [ALICE], severity: "neutral", scope: "unverified",
      firstReportedAt: 1000, lastReportedAt: 1000, reportIds: ["x"],
      ...over,
    }) as PendingReport;

  it("drops a report whose message has been deleted", () => {
    // The exact live regression: Remove succeeds, the kind-1984 survives, and on
    // refetch the deleted message is unresolvable — so the row returned reading
    // "Message could not be loaded from this relay". Work already done, labelled
    // as work that might not have happened.
    const rows = [row({ targetEventId: "gone" }), row({ targetEventId: "still-here" })];
    const out = dropHandled(rows, new Set(["gone"]));
    expect(out.map((r) => r.targetEventId)).toEqual(["still-here"]);
  });

  it("keeps person-reports, which have no message to delete", () => {
    // targetEventId undefined must never be swept up by an id lookup.
    const rows = [row({ targetEventId: undefined })];
    expect(dropHandled(rows, new Set(["gone"]))).toHaveLength(1);
  });

  it("does nothing when the relay reports no deletions", () => {
    // One-directional on purpose: absence of a 9005 is not evidence of anything,
    // because not every relay retains them. Re-showing a handled report is a far
    // cheaper mistake than hiding a live one.
    const rows = [row({ targetEventId: "a" }), row({ targetEventId: "b" })];
    expect(dropHandled(rows, new Set())).toHaveLength(2);
  });

  it("survives empty and missing input", () => {
    expect(dropHandled([], new Set(["x"]))).toEqual([]);
    expect(dropHandled(undefined as never, new Set(["x"]))).toEqual([]);
  });

  it("does not mutate its input", () => {
    const rows = [row({ targetEventId: "gone" })];
    dropHandled(rows, new Set(["gone"]));
    expect(rows).toHaveLength(1);
  });
});

describe("describeReportQueue — name what was actually reported", () => {
  const row = (over: Partial<PendingReport>): PendingReport =>
    ({
      relayUrl: "wss://r", groupId: "g", targetPubkey: TARGET,
      reporters: [ALICE], severity: "neutral", scope: "in-room",
      firstReportedAt: 1000, lastReportedAt: 1000, reportIds: ["x"],
      ...over,
    }) as PendingReport;

  const message = (id = "m1") => row({ targetEventId: id });
  const account = () => row({ targetEventId: undefined });

  it("says MESSAGE when a message was flagged", () => {
    // The live case: a post was reported, and Remove deletes that post. Calling
    // it an account report would tell the moderator someone flagged a person.
    expect(describeReportQueue([message()])).toBe("1 message was reported");
    expect(describeReportQueue([message("a"), message("b")])).toBe("2 messages were reported");
  });

  it("says ACCOUNT when the person was flagged", () => {
    // No targetEventId — nothing to delete. The question is whether this member
    // stays, which is a different decision from removing a post.
    expect(describeReportQueue([account()])).toBe("1 account was reported");
    expect(describeReportQueue([account(), account()])).toBe("2 accounts were reported");
  });

  it("refuses to pick a noun for a mixed queue", () => {
    // Neither "messages" nor "accounts" is true here. Counting reports is, and
    // the rows carry the distinction from there. Inventing a word that covers
    // both would be the same mistake as calling them all accounts.
    expect(describeReportQueue([message(), account()])).toBe("2 reports need you");
    expect(describeReportQueue([message("a"), message("b"), account()])).toBe("3 reports need you");
  });

  it("returns nothing for an empty queue", () => {
    // The component self-hides, but a heading rendered over nothing is exactly
    // the "Needs you over an empty box" problem the queue was built to avoid.
    expect(describeReportQueue([])).toBe("");
    expect(describeReportQueue(null)).toBe("");
    expect(describeReportQueue(undefined)).toBe("");
  });

  it("never says 'thing', and never says 'person' for a message", () => {
    // Pins both halves of the decision: 'thing' was the vague original, and
    // 'person' would be the confident-but-wrong replacement.
    for (const q of [[message()], [account()], [message(), account()]]) {
      const out = describeReportQueue(q);
      expect(out).not.toMatch(/thing/i);
      expect(out).not.toMatch(/person|people/i);
    }
  });
});

/**
 * Reports are now read from two stores at once — the group's relay and the
 * public set — because a NIP-29 relay will not hold a kind-1984 at all
 * (measured; see lib/report-sources.ts). Six relays holding one report is the
 * NORMAL case.
 *
 * These test mergeReportEvents' OWN behaviour and nothing more. The ordering is
 * independently safe: reportsFor dedupes reporters and reportIds itself, which
 * a sabotage run confirmed — swapping this function for a plain concat left
 * every ordering test green. The last case below pins that second guarantee
 * deliberately, so a future edit to reportsFor cannot quietly remove it on the
 * assumption that this function is covering for it.
 */
describe("mergeReportEvents — two stores, one truth", () => {
  it("collapses the same report arriving from several relays", () => {
    const one = report(ALICE, { id: "r1" });
    expect(mergeReportEvents([one], [{ ...one }], [{ ...one }])).toHaveLength(1);
  });

  it("keeps genuinely different reports from the same reporter", () => {
    const a = report(ALICE, { id: "r1", e: "m1" });
    const b = report(ALICE, { id: "r2", e: "m2" });
    expect(mergeReportEvents([a], [b]).map((e) => e.id).sort()).toEqual(["r1", "r2"]);
  });

  it("keeps reports from different people about one target", () => {
    // The pile-on this queue exists to surface.
    const rows = mergeReportEvents(
      [report(ALICE, { id: "r1" })],
      [report(BOB, { id: "r2" }), report(CAROL, { id: "r3" })],
    );
    expect(rows).toHaveLength(3);
  });

  it("leaves reportsFor safe against duplicates even when handed them raw", () => {
    // Belt AND braces, pinned separately: reportsFor must stay duplicate-proof
    // on its own, because that — not mergeReportEvents — is what actually
    // protects the ordering. Fed six copies WITHOUT merging first, one
    // complaint must still read as one.
    const dupes = Array.from({ length: 6 }, () => report(ALICE, { id: "dup" }));
    const rows = reportsFor(GROUP, dupes, ME, 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0].reporters).toEqual([ALICE]);
    expect(rows[0].reportIds).toEqual(["dup"]);
  });

  it("survives empty, null and undefined inputs", () => {
    expect(mergeReportEvents([], null, undefined)).toEqual([]);
    expect(mergeReportEvents(null, [report(ALICE, { id: "r1" })])).toHaveLength(1);
  });

  it("ignores entries with no id rather than throwing", () => {
    const broken = { kind: 1984, pubkey: ALICE, tags: [] } as unknown as Event;
    expect(mergeReportEvents([broken], [report(ALICE, { id: "r1" })])).toHaveLength(1);
  });
});

describe("reportsFor — the 90-day horizon", () => {
  // Owner screenshot, 2026-08-13: "1 person reported this · about 3 years ago
  // · Message could not be loaded from this relay" sitting in Needs-you above
  // fresh mentions. The member-report query is time-unbounded, so an ancient
  // report about a CURRENT member surfaced as if it needed a decision today —
  // about a message no relay will even serve anymore. Age is deliberately the
  // LAST ranking key WITHIN the queue; the horizon decides what enters it.
  const NOW = 1_800_000_000;

  it("a three-year-old report does not enter the queue at all", () => {
    const threeYearsAgo = NOW - 3 * 365 * 24 * 60 * 60;
    const rows = reportsFor(GROUP, [report(ALICE, { at: threeYearsAgo })], ME, NOW);
    expect(rows).toEqual([]);
  });

  it("a report inside the horizon enters normally", () => {
    const lastWeek = NOW - 7 * 24 * 60 * 60;
    const rows = reportsFor(GROUP, [report(ALICE, { at: lastWeek })], ME, NOW);
    expect(rows).toHaveLength(1);
  });

  it("the boundary is the horizon itself, not a day less", () => {
    const justInside = NOW - REPORT_HORIZON_SECONDS + 60;
    const justOutside = NOW - REPORT_HORIZON_SECONDS - 60;
    expect(reportsFor(GROUP, [report(ALICE, { at: justInside })], ME, NOW)).toHaveLength(1);
    expect(reportsFor(GROUP, [report(ALICE, { at: justOutside })], ME, NOW)).toEqual([]);
  });

  it("stale reports do not pad a fresh target's crowd count", () => {
    // Ordering leads with reporter count — the one expensive-to-fake signal —
    // so a stale report inflating it would let ancient history outrank fresh
    // harm. Only in-horizon reports count.
    const fresh = report(ALICE, { at: NOW - 3600, id: "fresh" });
    const stale = report("carol", { at: NOW - REPORT_HORIZON_SECONDS - 3600, id: "stale" });
    const rows = reportsFor(GROUP, [fresh, stale], ME, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].reporters).toEqual([ALICE]);
  });
});
