import { describe, it, expect } from "vitest";
import { getTrustPhrase, getTrustMark } from "./trust-words";

describe("trust, said as a fact about your network", () => {
  it("names the tie, never a grade", () => {
    expect(getTrustPhrase("strong")).toBe("Trusted by your network");
    expect(getTrustPhrase("moderate")).toBe("Known to your network");
    expect(getTrustPhrase("low")).toBe("New to your network");
    expect(getTrustPhrase("weak")).toBe("Few ties to your network");
    expect(getTrustPhrase("flagged")).toBe("Your network has concerns");
  });
  it("says nothing when there is nothing to say", () => {
    expect(getTrustPhrase("none")).toBe("");
  });
  it("never contains a number or a percent", () => {
    for (const t of ["strong", "moderate", "low", "weak", "flagged", "none"] as const) {
      expect(getTrustPhrase(t)).not.toMatch(/[%0-9]/);
    }
  });
});

describe("the quiet mark beside a name", () => {
  it("is filled for a strong tie, outlined for a known one, a warning when flagged, and absent otherwise", () => {
    expect(getTrustMark("strong")).toBe("filled");
    expect(getTrustMark("moderate")).toBe("outline");
    expect(getTrustMark("flagged")).toBe("warning");
    expect(getTrustMark("low")).toBeNull();
    expect(getTrustMark("weak")).toBeNull();
    expect(getTrustMark("none")).toBeNull();
  });
});
