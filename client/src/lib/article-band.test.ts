/**
 * Which band of the Articles page a writer's work belongs in (owner,
 * 2026-11-23): people you follow first; then, only with the wider network on,
 * writers your network vouches for; nobody else at all.
 */
import { describe, it, expect } from "vitest";
import { articleBand, type BandSignals } from "./article-band";

const ME = "me", ANA = "ana", INES = "ines", RUI = "rui", STRANGER = "stranger", BAD = "bad";
const signals = (over: Partial<BandSignals> = {}): BandSignals => ({
  me: ME,
  isFollowed: (pk) => pk === ANA,
  followedByFollows: (pk) => pk === INES || pk === BAD,
  trustScore: (pk) => (pk === RUI ? 0.4 : pk === STRANGER ? 0 : undefined),
  flagged: (pk) => pk === BAD,
  widerNetworkOn: true,
  ...over,
});

describe("articleBand", () => {
  it("someone you follow, and you yourself, are yours", () => {
    expect(articleBand(ANA, signals())).toBe("yours");
    expect(articleBand(ME, signals())).toBe("yours");
  });
  it("someone followed by people you follow is your wider circle", () => {
    expect(articleBand(INES, signals())).toBe("circle");
  });
  it("someone your trust score vouches for is your wider circle", () => {
    expect(articleBand(RUI, signals())).toBe("circle");
  });
  it("a stranger nobody vouches for is not shown, whatever their score of zero says", () => {
    expect(articleBand(STRANGER, signals())).toBeNull();
    expect(articleBand("nobody-knows", signals())).toBeNull();
  });
  it("a flagged account is not shown even when people you follow follow it", () => {
    expect(articleBand(BAD, signals())).toBeNull();
  });
  it("with the wider network off there is no wider circle: only yours", () => {
    const off = signals({ widerNetworkOn: false });
    expect(articleBand(ANA, off)).toBe("yours");
    expect(articleBand(INES, off)).toBeNull();
    expect(articleBand(RUI, off)).toBeNull();
  });
  it("someone you follow stays yours even if flagged: your own list is never second-guessed", () => {
    expect(articleBand(ANA, signals({ flagged: () => true }))).toBe("yours");
  });
});
