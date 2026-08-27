/**
 * Parent-post resolution (lib/parent-resolve.ts) — the decidable half of
 * "show the post this reply answers".
 *
 * Born from a live report (2026-08-26, The Forest outpost feed): a reply's
 * parent card sat on "Loading parent post..." forever. Three defects, all in
 * the component's inline fetch:
 *
 *  - it asked only the first 4 DEFAULT_RELAYS — never the relay the reply
 *    itself arrived on (the outpost's relay, where the parent lives) and
 *    never the NIP-10 e-tag relay hint that exists for exactly this;
 *  - a reply target that isn't a 64-hex event id bailed out before fetching,
 *    settling nothing — an eternal spinner;
 *  - an empty answer from relays we never reached was recorded as "parent
 *    does not exist", which silently DROPS the reply from the feed — the
 *    RELAY_REACHABILITY three-outcomes defect, verbatim.
 */
import { describe, expect, it } from "vitest";
import { classifyParentTarget, orderedRelayCandidates, parentRelayCandidates, resolveFetchOutcome } from "./parent-resolve";

const ID = "a".repeat(64);

describe("classifyParentTarget", () => {
  it("a 64-hex id is a fetchable event", () => {
    expect(classifyParentTarget(ID)).toBe("event");
    expect(classifyParentTarget(ID.toUpperCase())).toBe("event");
  });

  it("anything else settles as invalid — never an eternal spinner", () => {
    expect(classifyParentTarget("30023:abc:my-article")).toBe("invalid");
    expect(classifyParentTarget("note1qqqq")).toBe("invalid");
    expect(classifyParentTarget("")).toBe("invalid");
    expect(classifyParentTarget("a".repeat(63))).toBe("invalid");
  });

  it("no target at all is none — the post is not a reply", () => {
    expect(classifyParentTarget(null)).toBe("none");
  });
});

describe("parentRelayCandidates", () => {
  const DEFAULTS = ["wss://a.example", "wss://b.example", "wss://c.example"];
  const reply = (tags: string[][]) => ({ tags });

  it("asks where the reply came from FIRST — the outpost relay holds the parent (the live bug)", () => {
    const out = parentRelayCandidates({
      event: reply([["e", ID, "", "reply"]]),
      targetId: ID,
      seenOn: ["wss://forest.outpost.example"],
      defaults: DEFAULTS,
    });
    expect(out[0]).toBe("wss://forest.outpost.example");
    expect(out).toContain("wss://a.example");
  });

  it("the e-tag's NIP-10 relay hint leads — the author told us where the parent lives", () => {
    const out = parentRelayCandidates({
      event: reply([["e", ID, "wss://hint.example", "reply"]]),
      targetId: ID,
      seenOn: ["wss://forest.outpost.example"],
      defaults: DEFAULTS,
    });
    expect(out[0]).toBe("wss://hint.example");
    expect(out[1]).toBe("wss://forest.outpost.example");
  });

  it("dedupes across spellings and ignores junk hints", () => {
    const out = parentRelayCandidates({
      event: reply([["e", ID, "not-a-url", "reply"]]),
      targetId: ID,
      seenOn: ["wss://A.example/", "wss://a.example"],
      defaults: ["wss://a.example"],
    });
    expect(out).toEqual(["wss://a.example"]);
  });

  it("caps the list — a reply seen everywhere must not fan a query out to every relay", () => {
    const seenOn = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example`);
    const out = parentRelayCandidates({ event: reply([]), targetId: ID, seenOn, defaults: DEFAULTS });
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out[0]).toBe("wss://r0.example");
  });
});

describe("orderedRelayCandidates — the shared candidate builder for hinted fetches", () => {
  it("keeps group order: hints, then seen-on, then defaults", () => {
    const out = orderedRelayCandidates([
      ["wss://hint.example"],
      ["wss://seen.example"],
      ["wss://default.example"],
    ]);
    expect(out).toEqual(["wss://hint.example", "wss://seen.example", "wss://default.example"]);
  });

  it("dedupes across groups and spellings, drops junk, keeps first occurrence's slot", () => {
    const out = orderedRelayCandidates([
      ["wss://A.example/", "not-a-url", ""],
      ["wss://a.example", "wss://b.example"],
      ["wss://b.example/"],
    ]);
    expect(out).toEqual(["wss://a.example", "wss://b.example"]);
  });

  it("caps the flat list — a widely-shared quote must not fan one lookup out to every relay", () => {
    const hints = Array.from({ length: 12 }, (_, i) => `wss://h${i}.example`);
    const out = orderedRelayCandidates([hints, ["wss://never-reached.example"]]);
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out[0]).toBe("wss://h0.example");
    expect(out).not.toContain("wss://never-reached.example");
  });

  it("all-junk input yields an empty list, not a crash", () => {
    expect(orderedRelayCandidates([["", "http-ish", "relay.example"], []])).toEqual([]);
  });
});

describe("resolveFetchOutcome — the three outcomes stay three (RELAY_REACHABILITY)", () => {
  const evt = { id: ID } as never;

  it("an event is found regardless of the answered flag", () => {
    expect(resolveFetchOutcome({ events: [evt], answered: true })).toBe("found");
    expect(resolveFetchOutcome({ events: [evt], answered: false })).toBe("found");
  });

  it("answered and empty = the target genuinely isn't there", () => {
    expect(resolveFetchOutcome({ events: [], answered: true })).toBe("missing");
  });

  it("unanswered and empty = we never got to ask — NOT missing, nothing may be claimed absent", () => {
    expect(resolveFetchOutcome({ events: [], answered: false })).toBe("unreached");
  });
});
