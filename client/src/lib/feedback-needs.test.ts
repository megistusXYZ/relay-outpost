import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";

const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});

import { markIssueRead, relayScopedRepoD, type FeedbackIssue, type FeedbackStatus } from "./nip34-feedback";
import { feedbackNeedsYou, newAppErrorGroups, markAppErrorGroupRead, ticketUpdates, ticketsForRelay, threadItems, inboxTickets, hasNewForReporter, feedbackView } from "./feedback-needs";

const ME = "a".repeat(64), BOB = "b".repeat(64), AMY = "c".repeat(64);
let n = 0;
function ticket(o: { by: string; at?: number; status?: FeedbackStatus; comments?: { by: string; at: number; content?: string }[]; changes?: { status: FeedbackStatus; by: string; at: number }[]; crash?: string }): FeedbackIssue {
  const id = String(++n).padStart(64, "0");
  const at = o.at ?? 1000;
  const comments = (o.comments ?? []).map((c, i) => ({ id: `${id.slice(0, 60)}c${i}00`, pubkey: c.by, created_at: c.at, kind: 1111, content: c.content ?? "hi", tags: [], sig: "" }) as NostrEvent);
  const changes = o.changes ?? [];
  const latest = Math.max(at, ...comments.map((c) => c.created_at), ...changes.map((c) => c.at));
  return {
    event: { id, pubkey: o.by, created_at: at, kind: 1621, content: "", sig: "", tags: o.crash ? [["t", "crash"], ["crash-sig", o.crash]] : [["t", "feedback"]] } as NostrEvent,
    title: "T", type: [], status: o.status ?? "open", reporter: o.by, createdAt: at, latestActivityAt: latest,
    contextBlock: null, comments, statusChanges: changes,
  };
}

beforeEach(() => { __store.clear(); n = 0; });

describe("what needs the operator: one rule for the badge, the chip and the list", () => {
  it("open tickets from others you haven't seen", () => {
    const fresh = ticket({ by: BOB });
    const seen = ticket({ by: AMY });
    markIssueRead(seen.event.id, 5000);
    expect(feedbackNeedsYou([fresh, seen], ME).map((t) => t.event.id)).toEqual([fresh.event.id]);
  });

  it("not once it's resolved or closed", () => {
    expect(feedbackNeedsYou([ticket({ by: BOB, status: "resolved" }), ticket({ by: BOB, status: "closed" })], ME)).toEqual([]);
  });

  it("'looking into it' still needs you", () => {
    expect(feedbackNeedsYou([ticket({ by: BOB, status: "draft" })], ME)).toHaveLength(1);
  });

  it("your own replies never make it new — even when they come back later-stamped", () => {
    const t = ticket({ by: BOB, at: 1000, comments: [{ by: ME, at: 2005 }] });
    markIssueRead(t.event.id, 2000); // you read it, then replied; your copy arrives stamped later
    expect(feedbackNeedsYou([t], ME)).toEqual([]);
  });

  it("someone else's newer reply does", () => {
    const t = ticket({ by: BOB, at: 1000, comments: [{ by: BOB, at: 3000 }] });
    markIssueRead(t.event.id, 2000);
    expect(feedbackNeedsYou([t], ME)).toHaveLength(1);
  });

  it("tickets you sent to other operators aren't yours to answer", () => {
    expect(feedbackNeedsYou([ticket({ by: ME })], ME)).toEqual([]);
  });

  it("app errors are counted on their own, never as feedback", () => {
    expect(feedbackNeedsYou([ticket({ by: BOB, crash: "sig1" })], ME)).toEqual([]);
  });
});

describe("app errors: one per error, cleared by opening it", () => {
  it("a group with any unseen occurrence is new — once", () => {
    const a = ticket({ by: BOB, crash: "sigA", at: 1000 }), b = ticket({ by: AMY, crash: "sigA", at: 2000 }), c = ticket({ by: BOB, crash: "sigB" });
    expect(newAppErrorGroups([a, b, c]).sort()).toEqual(["sigA", "sigB"]);
  });

  it("opening the group clears every occurrence in it", () => {
    const a = ticket({ by: BOB, crash: "sigA", at: 1000 }), b = ticket({ by: AMY, crash: "sigA", at: 2000 });
    markAppErrorGroupRead([a, b], "sigA");
    expect(newAppErrorGroups([a, b])).toEqual([]);
  });
});

describe("what's new for the person who reported it", () => {
  it("the operator's reply or status change is news — closing included", () => {
    const replied = ticket({ by: ME, at: 1000, comments: [{ by: BOB, at: 2000 }] });
    const closed = ticket({ by: ME, at: 1000, status: "closed", changes: [{ status: "closed", by: BOB, at: 2000 }] });
    const quiet = ticket({ by: ME, at: 1000 });
    for (const t of [replied, closed, quiet]) markIssueRead(t.event.id, 1500);
    expect(ticketUpdates([replied, closed, quiet], ME).map((t) => t.event.id)).toEqual([replied.event.id, closed.event.id]);
  });

  it("your own replies and status changes aren't news to you", () => {
    const t = ticket({ by: ME, at: 1000, comments: [{ by: ME, at: 2000 }], changes: [{ status: "closed", by: ME, at: 2100 }] });
    markIssueRead(t.event.id, 1500);
    expect(ticketUpdates([t], ME)).toEqual([]);
  });

  it("only tickets you reported", () => {
    expect(ticketUpdates([ticket({ by: BOB, comments: [{ by: AMY, at: 5000 }] })], ME)).toEqual([]);
  });
});

describe("which relay a ticket is about", () => {
  const HERE = "wss://harbour.example", THERE = "wss://pier.example";
  const tagged = (tags: string[][]) => { const t = ticket({ by: BOB }); t.event.tags.push(...tags); return t; };

  it("tickets tagged for this relay are here; for another relay, not; untagged ones are 'not tied to a relay'", () => {
    const here = tagged([["relay", "wss://harbour.example/"]]);
    const viaRepo = tagged([["a", `30617:${ME}:${relayScopedRepoD(HERE)}`]]);
    const there = tagged([["relay", THERE]]);
    const old = tagged([]);
    const { here: h, untied } = ticketsForRelay([here, viaRepo, there, old], HERE);
    expect(h.map((t) => t.event.id)).toEqual([here.event.id, viaRepo.event.id]);
    expect(untied.map((t) => t.event.id)).toEqual([old.event.id]);
  });
});

describe("a ticket's thread: replies, and status changes as lines — never empty bubbles", () => {
  it("in time order; a status-only message is a line, a reply that also sets status is both", () => {
    const t = ticket({ by: ME, at: 1000, comments: [{ by: BOB, at: 2000, content: "Looking now" }, { by: BOB, at: 3000, content: "" }, { by: BOB, at: 4000, content: "Fixed in 1.16" }],
      changes: [{ status: "draft", by: BOB, at: 2000 }, { status: "resolved", by: BOB, at: 3000 }, { status: "closed", by: BOB, at: 4000 }] });
    expect(threadItems(t).map((x) => x.kind === "reply" ? `reply:${x.event.content}` : `status:${x.status}`)).toEqual([
      "reply:Looking now", "status:draft", "status:resolved", "reply:Fixed in 1.16", "status:closed",
    ]);
  });
});

describe("your own tickets in your inbox", () => {
  it("one you sent to yourself (testing your relay) stays; one you sent to someone else doesn't", () => {
    const toSelf = ticket({ by: ME }); toSelf.event.tags.push(["p", ME]);
    const toOther = ticket({ by: ME }); toOther.event.tags.push(["p", BOB]);
    const fromBob = ticket({ by: BOB }); fromBob.event.tags.push(["p", ME]);
    expect(inboxTickets([toSelf, toOther, fromBob], ME).map((t) => t.event.id)).toEqual([toSelf.event.id, fromBob.event.id]);
  });
});

describe("no wave of old news when this version arrives", () => {
  // `since`: when this person first ran a version that tells them about status changes.
  const SINCE = 5000;
  it("a ticket closed long ago isn't news — one closed after, is", () => {
    const old = ticket({ by: ME, at: 1000, status: "closed", changes: [{ status: "closed", by: BOB, at: 2000 }] });
    const fresh = ticket({ by: ME, at: 1000, status: "resolved", changes: [{ status: "resolved", by: BOB, at: 6000 }] });
    expect(ticketUpdates([old, fresh], ME, SINCE).map((t) => t.event.id)).toEqual([fresh.event.id]);
  });

  it("replies count as before: an unread reply on an open ticket is news, however old; on a closed one, only if it came after", () => {
    const openOld = ticket({ by: ME, at: 1000, comments: [{ by: BOB, at: 2000 }] });
    const closedOld = ticket({ by: ME, at: 1000, status: "closed", comments: [{ by: BOB, at: 2000 }], changes: [{ status: "closed", by: BOB, at: 2100 }] });
    expect(ticketUpdates([openOld, closedOld], ME, SINCE).map((t) => t.event.id)).toEqual([openOld.event.id]);
    expect(hasNewForReporter(closedOld, ME, SINCE)).toBe(false);
    expect(hasNewForReporter(openOld, ME, SINCE)).toBe(true);
  });
});

describe("the inbox's three views and its one filter", () => {
  const NOW = 100_000;
  const withType = (t: FeedbackIssue, type: string) => { t.type = [type as never]; return t; };

  it("Needs you: open and 'looking into it', new ones first; Done: resolved and closed; All: everything — app errors in none", () => {
    const readOpen = ticket({ by: BOB, at: 5000 }); markIssueRead(readOpen.event.id, 9000);
    const newOpen = ticket({ by: AMY, at: 3000 });
    const triaged = ticket({ by: BOB, at: 4000, status: "draft" }); markIssueRead(triaged.event.id, 9000);
    const done = ticket({ by: BOB, at: 6000, status: "resolved" });
    const closed = ticket({ by: AMY, at: 2000, status: "closed" });
    const crash = ticket({ by: BOB, crash: "s" });
    const all = [readOpen, newOpen, triaged, done, closed, crash];
    const ids = (v: FeedbackIssue[]) => v.map((t) => t.event.id);
    const r = feedbackView(all, ME, "needs", {}, NOW);
    expect(ids(r.items)).toEqual([newOpen.event.id, readOpen.event.id, triaged.event.id]);
    expect(r.counts).toEqual({ needs: 3, all: 5, done: 2 });
    expect(ids(feedbackView(all, ME, "done", {}, NOW).items)).toEqual([done.event.id, closed.event.id]);
    expect(feedbackView(all, ME, "all", {}, NOW).items).toHaveLength(5);
  });

  it("the filter: kind of request, people you trust, and when — counts follow it", () => {
    const bug = withType(ticket({ by: BOB, at: NOW - 100 }), "bug");
    const idea = withType(ticket({ by: AMY, at: NOW - 100 }), "idea");
    const oldBug = withType(ticket({ by: AMY, at: NOW - 40 * 86400 }), "bug");
    const all = [bug, idea, oldBug];
    expect(feedbackView(all, ME, "all", { types: ["bug"] }, NOW).items.map((t) => t.event.id)).toEqual([bug.event.id, oldBug.event.id]);
    expect(feedbackView(all, ME, "all", { trusted: (pk) => pk === BOB }, NOW).items.map((t) => t.event.id)).toEqual([bug.event.id]);
    const recent = feedbackView(all, ME, "all", { when: "7d" }, NOW);
    expect(recent.items).toHaveLength(2);
    expect(recent.counts.all).toBe(2);
  });
});
