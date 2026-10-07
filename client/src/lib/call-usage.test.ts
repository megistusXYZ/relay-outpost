/**
 * The team's one line about calls (owner, 2026-10-06): how many are running
 * on our call service, out of how many allowed — in plain words, for the
 * Relay Outpost team only.
 */
import { describe, it, expect } from "vitest";
import { callUsageLine, canSeeCallUsage } from "./call-usage";
import { RELAY_OUTPOST_TEAM_PUBKEY } from "@shared/team-key";

describe("calls right now", () => {
  it("says how many, out of how many", () => {
    expect(callUsageLine({ calls: 3, max: 50 })).toEqual({ text: "Calls right now: 3 of 50", nearlyFull: false });
    expect(callUsageLine({ calls: 0, max: 50 }).text).toBe("Calls right now: none");
  });
  it("says when it's nearly full", () => {
    expect(callUsageLine({ calls: 40, max: 50 })).toEqual({ text: "Calls right now: 40 of 50", nearlyFull: true });
  });
  it("only the team sees it", () => {
    expect(canSeeCallUsage(RELAY_OUTPOST_TEAM_PUBKEY)).toBe(true);
    expect(canSeeCallUsage("a".repeat(64))).toBe(false);
    expect(canSeeCallUsage(null)).toBe(false);
  });
});
