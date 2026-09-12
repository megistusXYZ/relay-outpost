/**
 * Polls in Concord group chats, as Armada seals them (Armada CORD.md "Polls",
 * NIP-88 inside the Chat Plane). Found live (2026-09-12): an Armada poll in a
 * shared group never appeared in Relay Outpost at all — the room's router only
 * knew messages, replies, reactions, deletes, edits and timers, so kind 1068
 * (the poll) and kind 1018 (a vote) were dropped on arrival.
 */
import { describe, it, expect } from "vitest";
import { routeRumor, type DecodedRumor } from "./concord-stream";
import { KIND_POLL, KIND_POLL_VOTE, tallyPollVotes, readPoll, readVote, buildVoteRumor, buildPollRumor } from "./concord-polls";

const CH = "c".repeat(64);
const rumor = (kind: number, tags: string[][], content = ""): DecodedRumor =>
  ({ id: "r".repeat(64), pubkey: "p".repeat(64), created_at: 1_700_000_000, kind, content, tags } as unknown as DecodedRumor);

describe("a poll reaching the room", () => {
  it("a poll made in the room arrives as a poll, and a vote as a vote", () => {
    const poll = rumor(KIND_POLL, [["channel", CH], ["epoch", "0"], ["option", "a1", "Tacos"], ["option", "b2", "Sushi"]], "Lunch?");
    const vote = rumor(KIND_POLL_VOTE, [["channel", CH], ["epoch", "0"], ["e", "x".repeat(64)], ["response", "a1"]]);
    expect(routeRumor(poll, CH, 0).type).toBe("poll");
    expect(routeRumor(vote, CH, 0).type).toBe("vote");
  });
});

/**
 * The count must match Armada's to the vote (CORD.md "Tally"), or two members
 * of the same group see different results for the same poll.
 */
describe("counting a poll the way Armada does", () => {
  const options = [{ id: "a1", label: "Tacos" }, { id: "b2", label: "Sushi" }];

  it("each voter's latest vote counts once; late votes and options the poll never offered don't", () => {
    const votes = [
      { pubkey: "alice", optionIds: ["a1"], ms: 1_000 },
      { pubkey: "alice", optionIds: ["b2"], ms: 2_000 },        // changed her mind
      { pubkey: "bob", optionIds: ["a1", "zz"], ms: 1_500 },    // "zz" isn't an option
      { pubkey: "carol", optionIds: ["a1"], ms: 9_000_000 },    // after the poll closed
    ];
    const tally = tallyPollVotes(votes, options, 5_000, "alice");
    expect(tally.totalVoters).toBe(2);
    expect(tally.counts.get("a1")).toBe(1);
    expect(tally.counts.get("b2")).toBe(1);
    expect([...(tally.myVote ?? [])]).toEqual(["b2"]);
  });
});

describe("reading a poll and a vote as Armada writes them", () => {
  it("a poll gives its options in order, its kind of choice, and when it closes", () => {
    const poll = rumor(KIND_POLL, [
      ["channel", CH], ["epoch", "0"], ["ms", "417"],
      ["option", "a1", "Tacos"], ["option", "b2", "Sushi"],
      ["polltype", "multiplechoice"], ["endsAt", "1735689600"], ["alt", "Poll: Lunch?"],
    ], "Lunch?");
    expect(readPoll(poll)).toEqual({
      options: [{ id: "a1", label: "Tacos" }, { id: "b2", label: "Sushi" }],
      pollType: "multiplechoice",
      endsAt: 1735689600,
    });
  });

  it("a vote names its poll, its choices, and when it was cast (to the millisecond)", () => {
    const vote = rumor(KIND_POLL_VOTE, [
      ["channel", CH], ["epoch", "0"], ["ms", "912"],
      ["e", "x".repeat(64)], ["response", "a1"], ["response", "b2"],
    ]);
    expect(readVote(vote)).toEqual({
      pollId: "x".repeat(64),
      vote: { pubkey: "p".repeat(64), optionIds: ["a1", "b2"], ms: 1_700_000_000_912 },
    });
  });
});

describe("voting from Relay Outpost", () => {
  it("a vote is sealed the way Armada writes one, so Armada counts it", () => {
    const author = "a".repeat(64);
    const vote = buildVoteRumor(author, CH, 0n, "x".repeat(64), ["b2"], 912, 1_700_000_000);
    expect(vote).toEqual({
      kind: KIND_POLL_VOTE,
      pubkey: author,
      created_at: 1_700_000_000,
      content: "",
      tags: [["channel", CH], ["epoch", "0"], ["ms", "912"], ["e", "x".repeat(64)], ["response", "b2"]],
    });
    // …and it reads back as the same vote.
    expect(readVote({ ...vote, tags: vote.tags })?.vote.optionIds).toEqual(["b2"]);
  });

  it("a poll is sealed the way Armada writes one, so Armada shows and counts it", () => {
    const author = "a".repeat(64);
    const options = [{ id: "a1", label: "Tacos" }, { id: "b2", label: "Sushi" }];
    const poll = buildPollRumor(author, CH, 0n, "Lunch?", options, "singlechoice", 1735689600, 417, 1_700_000_000);
    expect(poll).toEqual({
      kind: KIND_POLL,
      pubkey: author,
      created_at: 1_700_000_000,
      content: "Lunch?",
      tags: [
        ["channel", CH], ["epoch", "0"], ["ms", "417"],
        ["option", "a1", "Tacos"], ["option", "b2", "Sushi"],
        ["polltype", "singlechoice"], ["endsAt", "1735689600"], ["alt", "Poll: Lunch?"],
      ],
    });
    expect(readPoll(poll)).toEqual({ options, pollType: "singlechoice", endsAt: 1735689600 });
  });
});
