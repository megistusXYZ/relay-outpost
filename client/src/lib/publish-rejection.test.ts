import { describe, it, expect } from "vitest";
import { explainPublishFailure, summarizePublishRejections, humanize } from "./publish-rejection";

describe("humanize — keep the sentence, drop the machine prefix", () => {
  it("strips a NIP-01 prefix and capitalizes what's left", () => {
    expect(humanize('invalid: a group event must carry an "h" tag')).toBe(
      'A group event must carry an "h" tag',
    );
  });

  it("keeps a URL intact — it is the actionable part", () => {
    // This is the real relay.groups.nip29.com refusal. If the URL is mangled the
    // message stops being instructions and becomes trivia.
    expect(humanize("blocked: to create groups open https://groups.fiatjaf.com in your web browser")).toBe(
      "To create groups open https://groups.fiatjaf.com in your web browser",
    );
  });

  it("leaves a message with no known prefix alone apart from casing", () => {
    expect(humanize("something went sideways")).toBe("Something went sideways");
  });

  it("does not eat a colon that isn't a prefix", () => {
    // "note" is not a NIP-01 prefix, so the whole string survives.
    expect(humanize("note: see docs")).toBe("Note: see docs");
  });

  it("survives a prefix with an empty body", () => {
    expect(humanize("invalid:")).toBe("invalid:");
  });
});

describe("summarizePublishRejections", () => {
  it("returns undefined when nothing usable came back", () => {
    expect(summarizePublishRejections([])).toBeUndefined();
    expect(summarizePublishRejections(null)).toBeUndefined();
    expect(summarizePublishRejections(undefined)).toBeUndefined();
    expect(summarizePublishRejections([{ relay: "wss://a", message: "" }])).toBeUndefined();
  });

  it("drops timeouts and connection failures, which explain nothing", () => {
    // A timeout is the absence of an answer. Showing it as the reason implies the
    // relay objected to something, which it did not.
    expect(summarizePublishRejections([
      { relay: "wss://a", message: "Timeout after 8000ms: wss://a" },
      { relay: "wss://b", message: "connection failure: nope" },
    ])).toBeUndefined();
  });

  it("prefers the most actionable prefix over relay order", () => {
    // 'invalid' says the event itself is wrong — fixable right now. 'error' is a
    // shrug. Leading with the shrug because it arrived first would bury the fix.
    const out = summarizePublishRejections([
      { relay: "wss://a", message: "error: try later" },
      { relay: "wss://b", message: 'invalid: a group event must carry an "h" tag' },
    ]);
    expect(out).toContain('A group event must carry an "h" tag');
  });

  it("counts the other refusals without printing them", () => {
    const out = summarizePublishRejections([
      { relay: "wss://a", message: "invalid: bad tag" },
      { relay: "wss://b", message: "error: nope" },
      { relay: "wss://c", message: "error: nope" },
    ]);
    expect(out).toBe("Bad tag (and 2 other relays)");
  });

  it("says relay, singular, for exactly one other", () => {
    expect(summarizePublishRejections([
      { relay: "wss://a", message: "invalid: bad tag" },
      { relay: "wss://b", message: "error: nope" },
    ])).toBe("Bad tag (and 1 other relay)");
  });

  it("adds no suffix for a single rejection", () => {
    expect(summarizePublishRejections([{ relay: "wss://a", message: "blocked: use the website" }])).toBe(
      "Use the website",
    );
  });

  it("ignores noise when counting the others", () => {
    // Two relays refused; one merely timed out. Saying "and 1 other relay" would
    // be counting a non-answer as an objection.
    expect(summarizePublishRejections([
      { relay: "wss://a", message: "invalid: bad tag" },
      { relay: "wss://b", message: "Timeout after 8000ms: wss://b" },
    ])).toBe("Bad tag");
  });

  it("breaks ties toward the first relay", () => {
    expect(summarizePublishRejections([
      { relay: "wss://a", message: "invalid: first" },
      { relay: "wss://b", message: "invalid: second" },
    ])).toBe("First (and 1 other relay)");
  });
});

/**
 * The prefix this module's own docstring names — and the only one it had no
 * test for, until a real relay produced it and nothing on screen showed it.
 *
 * `restricted:` is what a NIP-29 relay answers when you try to moderate a group
 * you do not admin. Verbatim from wss://bunk-test.feeds.relay.tools.
 */
describe("restricted — the refusal an operator most needs to read", () => {
  const WIRE = "restricted: you are not authorized to moderate group qa-9002-probe-287534";

  it("keeps the whole sentence and drops only the machine prefix", () => {
    expect(humanize(WIRE)).toBe("You are not authorized to moderate group qa-9002-probe-287534");
  });

  it("surfaces it through summarize, which is what the toast prints", () => {
    expect(summarizePublishRejections([{ relay: "wss://r", message: WIRE }]))
      .toBe("You are not authorized to moderate group qa-9002-probe-287534");
  });

  it("outranks auth-required, which outranks rate-limited", () => {
    // A relay that says "not authorized" on one socket and "we can't serve you
    // unauthenticated" on another must surface the AUTHORIZATION sentence —
    // that is the one the operator can act on, and the other is a distraction.
    const out = summarizePublishRejections([
      { relay: "wss://a", message: "rate-limited: slow down" },
      { relay: "wss://b", message: "auth-required: we can't serve unauthenticated users" },
      { relay: "wss://c", message: WIRE },
    ]);
    expect(out).toContain("You are not authorized to moderate group");
    expect(out).toContain("and 2 other relays");
  });

  it("keeps auth-required when it is the only thing said", () => {
    // Actionable on its own — sign in again — unlike a bare timeout.
    expect(summarizePublishRejections([{ relay: "wss://a", message: "auth-required: not authenticated" }]))
      .toBe("Not authenticated");
  });

  it("still returns undefined when every relay only timed out", () => {
    // The caller's own generic copy is better than "timeout after 10000ms",
    // which is why `error` is optional and every toast keeps a fallback.
    expect(summarizePublishRejections([
      { relay: "wss://a", message: "timeout after 10000ms" },
      { relay: "wss://b", message: "" },
    ])).toBeUndefined();
  });
});

describe("explainPublishFailure (never blames the relay for a socket that failed)", () => {
  it("prefers the relay's own words when any relay actually answered", () => {
    expect(explainPublishFailure([
      { relay: "wss://a", message: "connection failure: getaddrinfo ENOTFOUND" },
      { relay: "wss://b", message: "restricted: members only" },
    ])).toBe("Members only");
  });

  it("says the relay was unreachable when nothing was reached — a dead socket is not a refusal", () => {
    // Buzz join requests surfaced 'The relay didn't take it' when the ws host
    // 404'd and no relay ever saw the event. Unreached ≠ refused.
    expect(explainPublishFailure([
      { relay: "wss://a", message: "connection failure: Unexpected server response: 404" },
      { relay: "wss://b", message: "timeout after 10000ms" },
    ])).toBe("Couldn't reach the relay — it may be offline. Try again in a moment.");
  });

  it("returns undefined when there are no rejections at all", () => {
    expect(explainPublishFailure([])).toBeUndefined();
    expect(explainPublishFailure(undefined)).toBeUndefined();
  });
});
