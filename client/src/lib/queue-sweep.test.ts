/**
 * The whole point of this module is that it stays QUIET in the two cases where
 * a line would be noise, and speaks in the one where silence would be a lie.
 * Sabotage to check these can fail: return a string unconditionally.
 */
import { describe, it, expect } from "vitest";
import { sweepNotice, EMPTY_SWEEP, type QueueSweep } from "./queue-sweep";

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
