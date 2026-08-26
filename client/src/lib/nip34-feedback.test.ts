import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import type { UnwrappedRumor } from "./dm";

// node env has no localStorage; the unread helpers read/write it. Stub an
// in-memory store so the last-read map is controllable per test.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

import {
  buildStatusTemplate,
  statusFromKind,
  statusLabel,
  isFeedbackStatus,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  isRenderableComment,
  renderableComments,
  combineFeedbackIssues,
  hydratePrivateTickets,
  hydrateIssues,
  countUnread,
  markIssueRead,
  KIND_NIP34_ISSUE,
  KIND_NIP22_COMMENT,
  KIND_NIP34_STATUS_OPEN,
  KIND_NIP34_STATUS_RESOLVED,
  KIND_NIP34_STATUS_CLOSED,
  KIND_NIP34_STATUS_DRAFT,
  type FeedbackRecipient,
  CRASH_STATUSES,
  isCrashStatus,
  getAllCrashStatuses,
  getCrashStatus,
  setCrashStatus,
  nextCrashStatus,
  isInactiveCrashStatus,
  isInactiveFeedbackStatus,
  matchesAge,
  sortTriaged,
  formatFilteredHeader,
  tallyFeedbackStatuses,
  tallyByAge,
  shortBuild,
  appVersionLabel,
  APP_VERSION,
  foldStatusObservations,
  recentStatusChangeIds,
  observeIssueStatuses,
  STATUS_CHANGE_DOT_WINDOW_S,
  type CrashStatus,
  type StatusObservationMap,
} from "./nip34-feedback";

const OPERATOR = "a".repeat(64);
const REPORTER = "b".repeat(64);
const REPORTER2 = "c".repeat(64);
const RELAY = "wss://relay.example";

function issueEvent(over: Partial<NostrEvent> & { id: string; pubkey: string }): NostrEvent {
  return {
    kind: KIND_NIP34_ISSUE,
    created_at: 1000,
    content: "body",
    sig: "",
    tags: [["subject", "Title"], ["t", "feedback"]],
    ...over,
  } as NostrEvent;
}

function rumor(over: Partial<UnwrappedRumor> & { id: string; pubkey: string; kind: number }): UnwrappedRumor {
  return { created_at: 1000, content: "", tags: [], ...over } as UnwrappedRumor;
}

const noRepo: FeedbackRecipient = { label: "r", relay: RELAY, operatorPubkey: OPERATOR, repoD: null, hasInbox: false };
const withRepo: FeedbackRecipient = { label: "r", relay: RELAY, operatorPubkey: OPERATOR, repoD: "feedback-relay", hasInbox: true };

beforeEach(() => __store.clear());

// --- Bug #2: no-repo status change must round-trip on the operator's own #p ---
describe("buildStatusTemplate — status events round-trip via #p (bug #2)", () => {
  const issue = issueEvent({ id: "1".repeat(64), pubkey: REPORTER });

  it("no-repo status event is #p:[operator]-matched (self p-tag) and #p:[reporter]-matched", () => {
    const tpl = buildStatusTemplate({ issue, status: "resolved", recipient: noRepo });
    const pTags = tpl.tags.filter((t) => t[0] === "p").map((t) => t[1]);
    // The reporter's inbox AND the operator's own inbox both re-ingest it.
    expect(pTags).toContain(REPORTER);
    expect(pTags).toContain(OPERATOR);
    // No repo → no `a` coordinate, so the self p-tag is the ONLY thing that lets
    // subscribeOperatorFeedback (#p:[operator]) re-ingest the operator's change.
    expect(tpl.tags.some((t) => t[0] === "a")).toBe(false);
  });

  it("keeps the repo `a` coordinate when a kind-30617 repo exists — AND still self-p-tags", () => {
    const tpl = buildStatusTemplate({ issue, status: "closed", recipient: withRepo });
    expect(tpl.tags).toContainEqual(["a", "30617:" + OPERATOR + ":feedback-relay", RELAY]);
    const pTags = tpl.tags.filter((t) => t[0] === "p").map((t) => t[1]);
    expect(pTags).toContain(OPERATOR);
    expect(pTags).toContain(REPORTER);
  });

  it("does not double-p-tag when the operator is also the reporter", () => {
    const selfIssue = issueEvent({ id: "2".repeat(64), pubkey: OPERATOR });
    const tpl = buildStatusTemplate({ issue: selfIssue, status: "open", recipient: noRepo });
    const opTags = tpl.tags.filter((t) => t[0] === "p" && t[1] === OPERATOR);
    expect(opTags).toHaveLength(1);
  });

  it("maps each status to its NIP-34 wire kind", () => {
    expect(buildStatusTemplate({ issue, status: "open", recipient: noRepo }).kind).toBe(KIND_NIP34_STATUS_OPEN);
    expect(buildStatusTemplate({ issue, status: "resolved", recipient: noRepo }).kind).toBe(KIND_NIP34_STATUS_RESOLVED);
    expect(buildStatusTemplate({ issue, status: "closed", recipient: noRepo }).kind).toBe(KIND_NIP34_STATUS_CLOSED);
    expect(buildStatusTemplate({ issue, status: "draft", recipient: noRepo }).kind).toBe(KIND_NIP34_STATUS_DRAFT);
  });

  it("round-trips end-to-end: a no-repo status event re-ingested by #p updates the issue's status", () => {
    const tpl = buildStatusTemplate({ issue, status: "resolved", recipient: noRepo });
    const statusEvent = { ...tpl, id: "9".repeat(64), pubkey: OPERATOR, sig: "" } as NostrEvent;
    const [hydrated] = hydrateIssues([issue, statusEvent]);
    expect(hydrated.status).toBe("resolved");
  });
});

// --- Bug #6: honest, wire-faithful status labels (interop) ---
describe("status labels honour the NIP-34 wire kinds (bug #6)", () => {
  it("statusFromKind maps kinds 1630/1631/1632/1633 and rejects others", () => {
    expect(statusFromKind(KIND_NIP34_STATUS_OPEN)).toBe("open");
    expect(statusFromKind(KIND_NIP34_STATUS_RESOLVED)).toBe("resolved");
    expect(statusFromKind(KIND_NIP34_STATUS_CLOSED)).toBe("closed");
    expect(statusFromKind(KIND_NIP34_STATUS_DRAFT)).toBe("draft");
    expect(statusFromKind(1)).toBeNull();
  });

  it("resolved(1631) reads as \"Resolved\", not the old contradictory \"In progress\"", () => {
    expect(FEEDBACK_STATUS_LABEL.resolved).toBe("Resolved");
    expect(FEEDBACK_STATUS_LABEL.resolved).not.toBe("In progress");
  });

  it("every label matches its wire kind so other NIP-34 clients agree", () => {
    expect(statusLabel(statusFromKind(KIND_NIP34_STATUS_OPEN)!)).toBe("Open");
    expect(statusLabel(statusFromKind(KIND_NIP34_STATUS_RESOLVED)!)).toBe("Resolved");
    expect(statusLabel(statusFromKind(KIND_NIP34_STATUS_CLOSED)!)).toBe("Closed");
    // draft (1633) is shown "Triaged" — a product label for the draft kind, not a
    // claim of a different kind, so it stays interoperable.
    expect(statusLabel(statusFromKind(KIND_NIP34_STATUS_DRAFT)!)).toBe("Triaged");
  });
});

// --- Bug #3: a status-only private change must not render as a blank comment ---
describe("empty status-only rumors update status but don't render (bug #3)", () => {
  it("isRenderableComment: body text renders, empty/whitespace does not", () => {
    expect(isRenderableComment({ content: "hello" })).toBe(true);
    expect(isRenderableComment({ content: "" })).toBe(false);
    expect(isRenderableComment({ content: "   \n " })).toBe(false);
    expect(isRenderableComment({})).toBe(false);
  });

  it("renderableComments strips the empty status-only rumor but keeps a real reply that also sets status", () => {
    const statusOnly = rumor({ id: "s".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, content: "", tags: [["E", "i".repeat(64)], ["status", "resolved"]] });
    const replyWithStatus = rumor({ id: "r".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, content: "fixed it", tags: [["E", "i".repeat(64)], ["status", "closed"]] });
    const rendered = renderableComments([statusOnly, replyWithStatus] as unknown as NostrEvent[]);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].content).toBe("fixed it");
  });

  it("hydratePrivateTickets: status-only rumor sets the ticket status yet leaves no renderable comment", () => {
    const issue = rumor({ id: "i".repeat(64), pubkey: REPORTER, kind: KIND_NIP34_ISSUE, content: "help", tags: [["subject", "S"], ["t", "feedback"]] });
    const statusOnly = rumor({ id: "s".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, created_at: 2000, content: "", tags: [["E", "i".repeat(64)], ["status", "resolved"]] });
    const [t] = hydratePrivateTickets([issue, statusOnly]);
    expect(t.status).toBe("resolved");            // status still reflects
    expect(t.latestActivityAt).toBe(2000);        // activity still registers (for user badge)
    expect(renderableComments(t.comments)).toHaveLength(0); // but nothing blank renders
  });
});

// --- Ops console crash: an out-of-enum private status must never reach render ---
describe("hydratePrivateTickets never widens an unknown status tag (ops console crash)", () => {
  const KNOWN = new Set(FEEDBACK_STATUSES);

  it("isFeedbackStatus accepts only the four canonical statuses", () => {
    expect(isFeedbackStatus("open")).toBe(true);
    expect(isFeedbackStatus("resolved")).toBe(true);
    expect(isFeedbackStatus("closed")).toBe(true);
    expect(isFeedbackStatus("draft")).toBe(true);
    // The values that would make STATUS_META[status] undefined and crash the tab:
    expect(isFeedbackStatus("in-progress")).toBe(false);
    expect(isFeedbackStatus("wontfix")).toBe(false);
    expect(isFeedbackStatus("")).toBe(false);
    expect(isFeedbackStatus(undefined)).toBe(false);
    expect(isFeedbackStatus(null)).toBe(false);
  });

  it("a private status-only rumor carrying an unknown status leaves issue.status valid (does not crash render)", () => {
    const issue = rumor({ id: "i".repeat(64), pubkey: REPORTER, kind: KIND_NIP34_ISSUE, content: "help", tags: [["subject", "S"], ["t", "feedback"]] });
    // A status tag value outside the enum — e.g. from another NIP-34 client or a
    // future status. Before the fix this flowed straight into issue.status via an
    // `as FeedbackStatus` cast, and STATUS_META[status] then threw at render.
    const bogus = rumor({ id: "s".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, created_at: 2000, content: "", tags: [["E", "i".repeat(64)], ["status", "in-progress"]] });
    const [t] = hydratePrivateTickets([issue, bogus]);
    // Unknown value ignored → stays the default "open" (a valid STATUS_META key).
    expect(t.status).toBe("open");
    expect(KNOWN.has(t.status)).toBe(true);
  });

  it("a later valid status still applies; a trailing unknown status does not clobber it", () => {
    const issue = rumor({ id: "i".repeat(64), pubkey: REPORTER, kind: KIND_NIP34_ISSUE, content: "help", tags: [["subject", "S"], ["t", "feedback"]] });
    const resolved = rumor({ id: "a".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, created_at: 2000, content: "", tags: [["E", "i".repeat(64)], ["status", "resolved"]] });
    const bogus = rumor({ id: "b".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, created_at: 3000, content: "", tags: [["E", "i".repeat(64)], ["status", "banana"]] });
    const [t] = hydratePrivateTickets([issue, resolved, bogus]);
    expect(t.status).toBe("resolved");
    expect(KNOWN.has(t.status)).toBe(true);
  });
});

// --- Bug #1: ONE combined inbox drives BOTH the tab list and the unread badge ---
describe("combineFeedbackIssues is the single source of truth for tab + badge (bug #1)", () => {
  // A #p-only public issue (no repo `a` coord) and a private NIP-17 ticket —
  // exactly the two streams the old #a-only badge ignored.
  const pubIssue = issueEvent({ id: "p".repeat(64), pubkey: REPORTER, created_at: 1000, tags: [["subject", "Public"], ["t", "feedback"], ["p", OPERATOR]] });
  const privTicket = rumor({ id: "v".repeat(64), pubkey: REPORTER2, kind: KIND_NIP34_ISSUE, created_at: 2000, content: "secret", tags: [["subject", "Private"], ["t", "feedback"]] });

  it("merges #p-only public issues AND private tickets into one newest-first list", () => {
    const issues = combineFeedbackIssues([pubIssue], [privTicket]);
    expect(issues.map((i) => i.title)).toEqual(["Private", "Public"]); // newest (2000) first
    expect(issues.find((i) => i.title === "Private")?.private).toBe(true);
  });

  it("counts unread across BOTH streams (the old #a-only badge counted neither)", () => {
    const issues = combineFeedbackIssues([pubIssue], [privTicket]);
    expect(countUnread("", issues)).toBe(2);

    // Reading the public one leaves exactly the private one unread — proving the
    // badge now honours last-read over the SAME combined list the tab shows.
    markIssueRead(pubIssue.id, 1000);
    expect(countUnread("", combineFeedbackIssues([pubIssue], [privTicket]))).toBe(1);
  });

  it("dedupes an optimistic private rumor against its real round-trip (same status)", () => {
    const optimistic = rumor({ id: "opt-1", pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, content: "", tags: [["E", "v".repeat(64)], ["status", "closed"]] });
    const real = rumor({ id: "z".repeat(64), pubkey: OPERATOR, kind: KIND_NIP22_COMMENT, content: "", tags: [["E", "v".repeat(64)], ["status", "closed"]] });
    const issues = combineFeedbackIssues([], [privTicket, optimistic, real]);
    const t = issues.find((i) => i.event.id === "v".repeat(64))!;
    expect(t.status).toBe("closed");
    // optimistic + real collapse to a single (non-rendered) status entry
    expect(t.comments).toHaveLength(1);
  });
});

// --- Crashes-view console upgrades (local statuses, filters, ordering) -------

describe("crash-group local statuses — localStorage-only annotation store", () => {
  it("defaults every unseen crash-sig to 'new' (nothing stored)", () => {
    expect(getCrashStatus("sig-a")).toBe("new");
    expect(getAllCrashStatuses()).toEqual({});
  });

  it("round-trips set → get and lists via getAllCrashStatuses", () => {
    setCrashStatus("sig-a", "investigating");
    setCrashStatus("sig-b", "fixed");
    expect(getCrashStatus("sig-a")).toBe("investigating");
    expect(getCrashStatus("sig-b")).toBe("fixed");
    expect(getAllCrashStatuses()).toEqual({ "sig-a": "investigating", "sig-b": "fixed" });
  });

  it("setting back to 'new' (the default) removes the stored entry — the map can't grow forever", () => {
    setCrashStatus("sig-a", "ignored");
    expect(getAllCrashStatuses()).toEqual({ "sig-a": "ignored" });
    setCrashStatus("sig-a", "new");
    expect(getAllCrashStatuses()).toEqual({});
    expect(getCrashStatus("sig-a")).toBe("new");
  });

  it("drops corrupt/unknown stored values instead of widening them into the UI", () => {
    localStorage.setItem(
      "relay-outpost:crash-statuses:v1",
      JSON.stringify({ "sig-a": "exploded", "sig-b": "fixed", "sig-c": 7 }),
    );
    expect(getAllCrashStatuses()).toEqual({ "sig-b": "fixed" });
    expect(getCrashStatus("sig-a")).toBe("new");
  });

  it("nextCrashStatus cycles new → investigating → fixed → ignored → new", () => {
    const seen: CrashStatus[] = ["new"];
    for (let i = 0; i < 4; i++) seen.push(nextCrashStatus(seen[seen.length - 1]));
    expect(seen).toEqual(["new", "investigating", "fixed", "ignored", "new"]);
  });

  it("isInactiveCrashStatus marks exactly fixed + ignored as done/dimmed", () => {
    expect(CRASH_STATUSES.filter(isInactiveCrashStatus)).toEqual(["fixed", "ignored"]);
    expect(isCrashStatus("investigating")).toBe(true);
    expect(isCrashStatus("open")).toBe(false); // feedback status, not a crash status
  });
});

describe("age filter predicate (shared by Feedback + Crashes views)", () => {
  const NOW = 1_000_000_000;

  it("'all' matches everything, even a zero timestamp", () => {
    expect(matchesAge(0, "all", NOW)).toBe(true);
  });

  it("24h/7d/30d are inclusive at the boundary and exclude older activity", () => {
    expect(matchesAge(NOW - 86400, "24h", NOW)).toBe(true);
    expect(matchesAge(NOW - 86400 - 1, "24h", NOW)).toBe(false);
    expect(matchesAge(NOW - 7 * 86400, "7d", NOW)).toBe(true);
    expect(matchesAge(NOW - 7 * 86400 - 1, "7d", NOW)).toBe(false);
    expect(matchesAge(NOW - 30 * 86400, "30d", NOW)).toBe(true);
    expect(matchesAge(NOW - 30 * 86400 - 1, "30d", NOW)).toBe(false);
  });
});

describe("sortTriaged — pinned first, dimmed (done) last, newest within each band", () => {
  type Row = { id: string; pinned?: boolean; done?: boolean; at: number };
  const sort = (rows: Row[]) =>
    sortTriaged(rows, { pinned: (r) => !!r.pinned, dimmed: (r) => !!r.done, activityAt: (r) => r.at }).map((r) => r.id);

  it("sinks done items below active ones even when the done item is newest", () => {
    expect(sort([
      { id: "done-newest", done: true, at: 900 },
      { id: "active-old", at: 100 },
      { id: "active-new", at: 500 },
    ])).toEqual(["active-new", "active-old", "done-newest"]);
  });

  it("pinned beats everything — a pinned done item still floats to the top", () => {
    expect(sort([
      { id: "active", at: 500 },
      { id: "pinned-done", pinned: true, done: true, at: 10 },
    ])).toEqual(["pinned-done", "active"]);
  });

  it("orders by activity desc within a band and never mutates the input", () => {
    const rows: Row[] = [
      { id: "b", at: 200 },
      { id: "a", at: 300 },
      { id: "z", done: true, at: 900 },
      { id: "y", done: true, at: 100 },
    ];
    const before = rows.map((r) => r.id);
    expect(sort(rows)).toEqual(["a", "b", "z", "y"]);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("works without a pinned accessor (the Crashes view has no pins)", () => {
    const out = sortTriaged(
      [{ id: "done", done: true, at: 900 }, { id: "active", at: 1 }] as Row[],
      { dimmed: (r) => !!r.done, activityAt: (r) => r.at },
    );
    expect(out.map((r) => r.id)).toEqual(["active", "done"]);
  });
});

describe("formatFilteredHeader — the count line stays honest under filters", () => {
  it("plain count when nothing is hidden (with pluralization)", () => {
    expect(formatFilteredHeader("error", 5, 5)).toBe("5 errors");
    expect(formatFilteredHeader("issue", 1, 1)).toBe("1 issue");
    expect(formatFilteredHeader("issue", 0, 0)).toBe("0 issues");
  });

  it("says how many items the active filters hide", () => {
    expect(formatFilteredHeader("error", 3, 5)).toBe("3 of 5 errors · 2 hidden");
    expect(formatFilteredHeader("issue", 0, 1)).toBe("0 of 1 issue · 1 hidden");
  });
});

describe("tallyFeedbackStatuses — the numbers behind the status chips", () => {
  const iss = (status: string) => ({ status } as unknown as Parameters<typeof tallyFeedbackStatuses>[0][number]);

  it("counts each lifecycle status and reports 0 for empty buckets", () => {
    expect(tallyFeedbackStatuses([iss("open"), iss("open"), iss("resolved")]))
      .toEqual({ open: 2, resolved: 1, closed: 0, draft: 0 });
  });

  it("is all-zero for an empty inbox", () => {
    expect(tallyFeedbackStatuses([])).toEqual({ open: 0, resolved: 0, closed: 0, draft: 0 });
  });
});

describe("version label — release + build hash for support/crash tickets", () => {
  it("shortBuild takes the git-sha before the timestamp", () => {
    expect(shortBuild("a3202be+2026-07-20T09:50")).toBe("a3202be");
  });

  it("shortBuild leaves the dev fallback intact", () => {
    expect(shortBuild("dev")).toBe("dev");
  });

  it("appVersionLabel is the bare release version in dev (no build stamp)", () => {
    // Tests run without VITE_APP_VERSION, so APP_BUILD === 'dev' → no suffix.
    expect(appVersionLabel()).toBe(APP_VERSION);
    expect(appVersionLabel()).not.toContain("(");
  });
});

describe("tallyByAge — why the Age chips read 24h N · 7d N · 30d N", () => {
  const NOW = 1_000_000_000;

  it("counts membership in each (nested) window, 'all' = everything", () => {
    // recent (in all windows), 8d old (30d only), 40d old (none but all)
    expect(tallyByAge([NOW - 100, NOW - 8 * 86400, NOW - 40 * 86400], NOW))
      .toEqual({ all: 3, "24h": 1, "7d": 1, "30d": 2 });
  });

  it("when everything is recent, every window equals the total (so narrowing changes nothing)", () => {
    expect(tallyByAge([NOW - 10, NOW - 20, NOW - 30], NOW))
      .toEqual({ all: 3, "24h": 3, "7d": 3, "30d": 3 });
  });
});

describe("status-change observation — the 'updated' dot state machine", () => {
  const NOW = 2_000_000;

  it("first sighting records the status but never lights the dot (backlog stays calm)", () => {
    const { map, changed } = foldStatusObservations({}, [{ id: "i1", status: "open" }], NOW);
    expect(changed).toBe(true);
    expect(map["i1"]).toEqual({ status: "open", at: 0 });
    expect(recentStatusChangeIds(map, NOW).size).toBe(0);
  });

  it("re-observing the same status changes nothing; a flip stamps the dot", () => {
    const start: StatusObservationMap = { i1: { status: "open", at: 0 } };
    const same = foldStatusObservations(start, [{ id: "i1", status: "open" }], NOW);
    expect(same.changed).toBe(false);
    expect(recentStatusChangeIds(same.map, NOW).size).toBe(0);

    const flipped = foldStatusObservations(start, [{ id: "i1", status: "resolved" }], NOW);
    expect(flipped.map["i1"]).toEqual({ status: "resolved", at: NOW });
    expect(Array.from(recentStatusChangeIds(flipped.map, NOW))).toEqual(["i1"]);
  });

  it("the dot expires after the window", () => {
    const map: StatusObservationMap = { i1: { status: "resolved", at: NOW } };
    expect(recentStatusChangeIds(map, NOW + STATUS_CHANGE_DOT_WINDOW_S - 1).size).toBe(1);
    expect(recentStatusChangeIds(map, NOW + STATUS_CHANGE_DOT_WINDOW_S).size).toBe(0);
  });

  it("prunes stale entries for vanished issues but keeps a fresh marker through list churn", () => {
    const prev: StatusObservationMap = {
      fresh: { status: "resolved", at: NOW - 10 }, // recently flipped, briefly absent from the list
      stale: { status: "closed", at: NOW - STATUS_CHANGE_DOT_WINDOW_S - 10 },
      backlog: { status: "open", at: 0 },
    };
    const { map } = foldStatusObservations(prev, [], NOW);
    expect(Object.keys(map)).toEqual(["fresh"]);
  });

  it("observeIssueStatuses persists across calls (localStorage round-trip)", () => {
    expect(observeIssueStatuses([{ id: "i1", status: "open" }], NOW).size).toBe(0);
    const recent = observeIssueStatuses([{ id: "i1", status: "closed" }], NOW + 60);
    expect(Array.from(recent)).toEqual(["i1"]);
    // A later read within the window still reports the dot without a new flip.
    expect(Array.from(observeIssueStatuses([{ id: "i1", status: "closed" }], NOW + 120))).toEqual(["i1"]);
  });

  it("isInactiveFeedbackStatus dims exactly resolved + closed", () => {
    expect(FEEDBACK_STATUSES.filter(isInactiveFeedbackStatus)).toEqual(["resolved", "closed"]);
  });
});
