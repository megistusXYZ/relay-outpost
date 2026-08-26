/**
 * Guest deep-link fetch classification (lib/guest-fetch-outcome.ts).
 *
 * The bug this pins (seen live on relayop.xyz, 2026-08-18): a guest opened a
 * shared /thread link and got "Couldn't find this post" for a post that
 * exists — because the preview treated EOSE as an answer, and a COLD guest
 * pool's failed connects EOSE instantly (the fabricated-EOSE class). The
 * classifier separates the three outcomes: found, genuinely-not-found (a
 * relay we provably reached finished answering), and never-got-to-ask.
 */
import { describe, expect, it } from "vitest";
import { guestFetchOutcome } from "./guest-fetch-outcome";

describe("guestFetchOutcome", () => {
  it("found wins over everything", () => {
    expect(guestFetchOutcome({ found: true, eosed: false, reached: null, timedOut: false })).toBe("found");
    expect(guestFetchOutcome({ found: true, eosed: true, reached: false, timedOut: true })).toBe("found");
  });

  it("not-found requires BOTH a real EOSE and proof somebody was reached", () => {
    expect(guestFetchOutcome({ found: false, eosed: true, reached: true, timedOut: false })).toBe("not-found");
    // EOSE alone is NOT an answer — failed connects EOSE too.
    expect(guestFetchOutcome({ found: false, eosed: true, reached: null, timedOut: false })).toBe("loading");
    expect(guestFetchOutcome({ found: false, eosed: true, reached: false, timedOut: false })).toBe("unreachable");
  });

  it("nobody reachable settles as unreachable without waiting for the timer", () => {
    expect(guestFetchOutcome({ found: false, eosed: false, reached: false, timedOut: false })).toBe("unreachable");
  });

  it("deadline with PROVEN reach settles not-found — a connected relay silent for the whole window has answered by silence (aggregate EOSE can hang forever on one dead relay, measured live)", () => {
    expect(guestFetchOutcome({ found: false, eosed: false, reached: true, timedOut: true })).toBe("not-found");
  });

  it("deadline WITHOUT proven reach is unreachable, never a confident not-found", () => {
    expect(guestFetchOutcome({ found: false, eosed: false, reached: null, timedOut: true })).toBe("unreachable");
  });

  it("still waiting while signals are incomplete", () => {
    expect(guestFetchOutcome({ found: false, eosed: false, reached: null, timedOut: false })).toBe("loading");
    expect(guestFetchOutcome({ found: false, eosed: false, reached: true, timedOut: false })).toBe("loading");
  });
});
