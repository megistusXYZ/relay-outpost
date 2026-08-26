import { describe, it, expect } from "vitest";
import { isHiddenByTrust } from "./trust-filter";
import type { SignalTier } from "./graperank";

const tiers = (...t: SignalTier[]) => new Set<SignalTier>(t);

// Regression: flagged accounts were leaking through outpost trust filters because
// getSignalTier only maps influence and never returns "flagged", so excluding the
// "flagged" tier did nothing. isHiddenByTrust now takes an explicit `flagged` flag.
describe("isHiddenByTrust — flagged handling", () => {
  it("hides a flagged account when 'flagged' is excluded, even with high influence", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("flagged"), influence: 0.9, flagged: true, resolved: true })).toBe(true);
  });

  it("hides a flagged account when 'flagged' is excluded even before its score resolves", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("flagged"), influence: null, flagged: true, resolved: false })).toBe(true);
  });

  it("does NOT hide a flagged account when 'flagged' is not in the excluded set", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("weak"), influence: 0.9, flagged: true, resolved: true })).toBe(false);
  });

  it("does NOT hide a non-flagged account just because 'flagged' is excluded", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("flagged"), influence: 0.9, flagged: false, resolved: true })).toBe(false);
  });
});

describe("isHiddenByTrust — guards (unchanged behavior)", () => {
  it("returns false when the filter is disabled", () => {
    expect(isHiddenByTrust({ enabled: false, excludedTiers: tiers("flagged"), influence: null, flagged: true, resolved: true })).toBe(false);
  });

  it("returns false when no tiers are excluded", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers(), influence: null, flagged: true, resolved: true })).toBe(false);
  });

  it("keeps an unresolved unknown-influence account visible (grace window)", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("none"), influence: null, flagged: false, resolved: false })).toBe(false);
  });

  it("hides a resolved unknown-influence account when 'none' is excluded", () => {
    expect(isHiddenByTrust({ enabled: true, excludedTiers: tiers("none"), influence: null, flagged: false, resolved: true })).toBe(true);
  });
});
