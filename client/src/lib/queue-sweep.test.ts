/**
 * The whole point of this module is that it stays QUIET in the two cases where
 * a line would be noise, and speaks in the one where silence would be a lie.
 * Sabotage to check these can fail: return a string unconditionally.
 */
import { describe, it, expect } from "vitest";
import { sweepNotice, combinedSweepNotice, EMPTY_SWEEP, type QueueSweep } from "./queue-sweep";

const sweep = (attempted: number, unreached: number): QueueSweep => ({
  relaysAttempted: attempted,
  relaysUnreached: unreached,
});

describe("sweepNotice — when to say nothing", () => {
  it("says nothing on a complete sweep", () => {
    // Every relay answered. An empty queue here genuinely means nobody waiting.
    expect(sweepNotice(sweep(3, 0))).toBeNull();
  });

  it("says nothing when no relay was swept at all", () => {
    // The Concord-only operator. This is PERMANENT for them, so a line here is
    // a standing banner about a feature they do not have.
    expect(sweepNotice(EMPTY_SWEEP)).toBeNull();
    expect(sweepNotice(sweep(0, 0))).toBeNull();
  });

  it("says nothing rather than rendering an impossible ratio", () => {
    // Defensive: never put "2 of 1" on screen if a caller miscounts.
    expect(sweepNotice(sweep(1, 2))).toBeNull();
    expect(sweepNotice(sweep(0, 3))).toBeNull();
  });

  it("treats a negative unreached count as nothing to report", () => {
    expect(sweepNotice(sweep(3, -1))).toBeNull();
  });
});

describe("sweepNotice — when silence would be a lie", () => {
  it("reports a partial sweep with both numbers", () => {
    expect(sweepNotice(sweep(3, 1))).toBe(
      "Couldn't reach 1 of 3 relays, so this may be incomplete.",
    );
  });

  it("reads naturally when the only relay failed", () => {
    // "1 of 1 relays" is how a queue sounds like a robot.
    expect(sweepNotice(sweep(1, 1))).toBe("Couldn't reach your relay, so this may be incomplete.");
  });

  it("reads naturally when every relay failed", () => {
    expect(sweepNotice(sweep(4, 4))).toBe(
      "Couldn't reach any of your relays, so this may be incomplete.",
    );
  });

  it("never claims a count it did not measure", () => {
    // The sentence must not imply anything about what was FOUND — only about
    // what could not be asked.
    const notice = sweepNotice(sweep(5, 2))!;
    expect(notice).toContain("2 of 5");
    expect(notice).not.toMatch(/waiting|pending|report|nobody|none/i);
  });
});

describe("sweepNotice — with a named subject", () => {
  // Live report (2026-08-26): with an EMPTY queue the notice is the only
  // thing the component renders, and on the Activity page a context-free
  // "Couldn't reach 1 of 14 relays, so this may be incomplete" reads as
  // "your notifications are broken". Naming the subject makes the orphan
  // line carry its own context — while still claiming nothing about what
  // exists on the unreached relay.
  it("names what could not be checked, not what might exist", () => {
    expect(sweepNotice(sweep(14, 1), "reports")).toBe(
      "Couldn't reach 1 of 14 outpost relays, so reports there can't be checked.",
    );
    expect(sweepNotice(sweep(14, 1), "join requests")).toBe(
      "Couldn't reach 1 of 14 outpost relays, so join requests there can't be checked.",
    );
  });

  it("keeps the natural singular and all-failed forms", () => {
    expect(sweepNotice(sweep(1, 1), "reports")).toBe(
      "Couldn't reach your outpost relay, so reports there can't be checked.",
    );
    expect(sweepNotice(sweep(3, 3), "join requests")).toBe(
      "Couldn't reach any of your outpost relays, so join requests there can't be checked.",
    );
  });

  it("stays quiet in exactly the same cases as the plain form", () => {
    expect(sweepNotice(sweep(3, 0), "reports")).toBeNull();
    expect(sweepNotice(EMPTY_SWEEP, "reports")).toBeNull();
  });
});

describe("combinedSweepNotice (one actionable card instead of stacked duplicate lines)", () => {
  it("merges subjects when sweeps failed, and unions the failing relay urls", () => {
    const a = { sweep: { relaysAttempted: 14, relaysUnreached: 1, unreachedUrls: ["wss://dead.example"] }, subject: "join requests" };
    const b = { sweep: { relaysAttempted: 14, relaysUnreached: 1, unreachedUrls: ["wss://dead.example"] }, subject: "reports" };
    const got = combinedSweepNotice([a, b]);
    expect(got).not.toBeNull();
    expect(got!.text).toBe("Couldn't reach 1 of 14 outpost relays, so join requests and reports there can't be checked.");
    expect(got!.urls).toEqual(["wss://dead.example"]);
  });

  it("keeps only the failing subject when the other sweep was clean", () => {
    const a = { sweep: { relaysAttempted: 14, relaysUnreached: 0, unreachedUrls: [] }, subject: "join requests" };
    const b = { sweep: { relaysAttempted: 14, relaysUnreached: 1, unreachedUrls: ["wss://dead.example"] }, subject: "reports" };
    const got = combinedSweepNotice([a, b]);
    expect(got!.text).toBe("Couldn't reach 1 of 14 outpost relays, so reports there can't be checked.");
  });

  it("unions distinct failing relays across sweeps and counts the union", () => {
    const a = { sweep: { relaysAttempted: 14, relaysUnreached: 1, unreachedUrls: ["wss://x.example"] }, subject: "join requests" };
    const b = { sweep: { relaysAttempted: 14, relaysUnreached: 1, unreachedUrls: ["wss://y.example"] }, subject: "reports" };
    const got = combinedSweepNotice([a, b]);
    expect(got!.urls.sort()).toEqual(["wss://x.example", "wss://y.example"]);
    expect(got!.text).toContain("2 of 14");
  });

  it("null when every sweep was clean or nothing was asked", () => {
    expect(combinedSweepNotice([{ sweep: { relaysAttempted: 14, relaysUnreached: 0, unreachedUrls: [] }, subject: "reports" }])).toBeNull();
    expect(combinedSweepNotice([{ sweep: EMPTY_SWEEP, subject: "reports" }])).toBeNull();
  });
});
