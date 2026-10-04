import { describe, it, expect } from "vitest";
import type { Event as NostrEvent } from "nostr-tools";
import type { FeedbackIssue, FeedbackStatus } from "./nip34-feedback";
import { rankSuggestions, isSuggestion, voteTemplate, unvoteTemplate } from "./suggestions";
import { STARTER_TEMPLATES } from "./inbox-settings";

const ME = "a".repeat(64), BOB = "b".repeat(64), AMY = "c".repeat(64), OP = "d".repeat(64);
let n = 0;
const ev = (o: Partial<NostrEvent>): NostrEvent => ({ id: String(++n).padStart(64, "0"), pubkey: BOB, created_at: 1000, kind: 7, content: "+", tags: [], sig: "", ...o }) as NostrEvent;
const idea = (o: { at?: number; status?: FeedbackStatus; by?: string; tags?: string[][]; priv?: boolean } = {}): FeedbackIssue => {
  const e = ev({ kind: 1621, pubkey: o.by ?? BOB, created_at: o.at ?? 1000, tags: [["t", "feedback"], ["t", "idea"], ["p", OP], ...(o.tags ?? [])], content: "" });
  return { event: e, title: "Idea", type: ["idea"], status: o.status ?? "open", reporter: e.pubkey, createdAt: e.created_at, latestActivityAt: e.created_at, contextBlock: null, comments: [], statusChanges: [], private: o.priv };
};
const vote = (on: FeedbackIssue, by: string, content = "+", at = 2000) => ev({ kind: 7, pubkey: by, content, created_at: at, tags: [["e", on.event.id], ["p", on.reporter]] });

describe("votes: one per person, yours known", () => {
  it("a person voting twice counts once; '-' isn't a vote; your vote is remembered", () => {
    const a = idea();
    const mine = vote(a, ME);
    const [r] = rankSuggestions([a], [vote(a, BOB), vote(a, BOB, "👍"), vote(a, AMY, "-"), mine], [], ME).open;
    expect(r.votes).toBe(2);
    expect(r.myVote).toBe(mine.id);
  });

  it("taking a vote back (a deletion by its author) removes it; someone else's deletion doesn't", () => {
    const a = idea();
    const mine = vote(a, ME), bobs = vote(a, BOB);
    const del = (by: string, target: NostrEvent) => ev({ kind: 5, pubkey: by, tags: [["e", target.id], ["k", "7"]] });
    const [r] = rankSuggestions([a], [mine, bobs], [del(ME, mine), del(AMY, bobs)], ME).open;
    expect(r.votes).toBe(1);
    expect(r.myVote).toBeNull();
  });
});

describe("the board's order", () => {
  it("most votes first, newest breaking ties; resolved and closed listed apart", () => {
    const few = idea({ at: 3000 }), many = idea({ at: 1000 }), tieOld = idea({ at: 500 }), done = idea({ status: "resolved" }), closed = idea({ status: "closed" });
    const votes = [vote(many, BOB), vote(many, AMY), vote(few, BOB), vote(tieOld, AMY), vote(done, BOB), vote(done, AMY), vote(done, ME)];
    const board = rankSuggestions([few, many, tieOld, done, closed], votes, [], ME);
    expect(board.open.map((s) => s.issue.event.id)).toEqual([many.event.id, few.event.id, tieOld.event.id]);
    expect(board.done.map((s) => s.issue.event.id)).toEqual([done.event.id, closed.event.id]);
  });
});

describe("what counts as a suggestion", () => {
  it("public ideas, and anything from a public request type; never private tickets", () => {
    const templates = STARTER_TEMPLATES;
    expect(isSuggestion(idea(), templates)).toBe(true);
    expect(isSuggestion(idea({ priv: true }), templates)).toBe(false);
    const q = idea(); q.type = ["question"];
    expect(isSuggestion(q, templates)).toBe(false);
    q.event.tags.push(["template", "suggest"]); // "Suggest something" is public
    expect(isSuggestion(q, templates)).toBe(true);
  });
});

describe("voting on the wire", () => {
  it("a vote is a '+' reaction to the suggestion; taking it back deletes that reaction", () => {
    const a = idea();
    expect(voteTemplate(a.event)).toMatchObject({ kind: 7, content: "+", tags: [["e", a.event.id], ["p", BOB], ["k", "1621"]] });
    expect(unvoteTemplate("f".repeat(64))).toMatchObject({ kind: 5, tags: [["e", "f".repeat(64)], ["k", "7"]] });
  });
});
