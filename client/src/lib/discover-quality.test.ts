import { describe, it, expect } from "vitest";
import {
  admitStranger,
  gateStrangerProfile,
  getDiscoverPresetConfig,
  DISCOVER_PRESET_CONFIG,
  type ProfileGateInput,
  type StrangerAdmitInput,
} from "./discover-quality";

const NOW = 1_700_000_000;
const DAY = 24 * 60 * 60;

const base = (over: Partial<StrangerAdmitInput> = {}): StrangerAdmitInput => ({
  isInNetwork: false,
  wotScore: undefined,
  engagementScore: 0,
  powDifficulty: 0,
  firstSeen: null,
  followerCount: undefined,
  nowSeconds: NOW,
  config: DISCOVER_PRESET_CONFIG.balanced,
  ...over,
});

describe("getDiscoverPresetConfig", () => {
  it("maps each preset to its config", () => {
    expect(getDiscoverPresetConfig("open")).toBe(DISCOVER_PRESET_CONFIG.open);
    expect(getDiscoverPresetConfig("balanced")).toBe(DISCOVER_PRESET_CONFIG.balanced);
    expect(getDiscoverPresetConfig("strict")).toBe(DISCOVER_PRESET_CONFIG.strict);
  });

  it("falls back to balanced for custom (hand-tuned knobs)", () => {
    expect(getDiscoverPresetConfig("custom")).toBe(DISCOVER_PRESET_CONFIG.balanced);
  });

  it("breadth + stranger bar rise monotonically Open → Balanced → Strict", () => {
    const o = DISCOVER_PRESET_CONFIG.open;
    const b = DISCOVER_PRESET_CONFIG.balanced;
    const s = DISCOVER_PRESET_CONFIG.strict;
    // Breadth shrinks as strictness rises.
    expect(o.relayPoolCap).toBeGreaterThan(b.relayPoolCap);
    expect(b.relayPoolCap).toBeGreaterThan(s.relayPoolCap);
    // Stranger bar rises as strictness rises.
    expect(o.strangerEngagementFloor).toBeLessThan(b.strangerEngagementFloor);
    expect(b.strangerEngagementFloor).toBeLessThan(s.strangerEngagementFloor);
    // PoW bar rises with strictness too.
    expect(o.minPow).toBeLessThan(b.minPow);
    expect(b.minPow).toBeLessThan(s.minPow);
    // Strict folds no extra sources; Open/Balanced do.
    expect(o.foldOutbox && o.foldCommunity).toBe(true);
    expect(s.foldOutbox || s.foldCommunity).toBe(false);
  });
});

describe("admitStranger — in-network is never gated", () => {
  it("admits a followed/self author even with zero signal", () => {
    expect(admitStranger(base({ isInNetwork: true }))).toBe(true);
  });

  it("admits an in-network author on Strict with no engagement/age/followers", () => {
    expect(
      admitStranger(base({ isInNetwork: true, config: DISCOVER_PRESET_CONFIG.strict })),
    ).toBe(true);
  });
});

describe("admitStranger — earned signals admit an out-of-network author", () => {
  it("positive WoT admits", () => {
    expect(admitStranger(base({ wotScore: 0.01 }))).toBe(true);
  });

  it("a zero/negative WoT score does NOT admit on its own", () => {
    expect(admitStranger(base({ wotScore: 0 }))).toBe(false);
    expect(admitStranger(base({ wotScore: -0.2 }))).toBe(false);
  });

  it("engagement at/above the preset floor admits", () => {
    // Balanced floor = 3.
    expect(admitStranger(base({ engagementScore: 3 }))).toBe(true);
    expect(admitStranger(base({ engagementScore: 2 }))).toBe(false);
  });

  it("established age admits (older than the preset threshold)", () => {
    // Balanced establishedAgeDays = 7.
    expect(admitStranger(base({ firstSeen: NOW - 8 * DAY }))).toBe(true);
    expect(admitStranger(base({ firstSeen: NOW - 6 * DAY }))).toBe(false);
  });

  it("enough followers admits", () => {
    // Balanced establishedMinFollowers = 15.
    expect(admitStranger(base({ followerCount: 15 }))).toBe(true);
    expect(admitStranger(base({ followerCount: 14 }))).toBe(false);
  });

  it("meaningful PoW admits on its own, with no other signal", () => {
    // Balanced minPow = 16.
    expect(admitStranger(base({ powDifficulty: 16 }))).toBe(true);
    expect(admitStranger(base({ powDifficulty: 20 }))).toBe(true);
  });

  it("PoW below the preset floor does NOT admit on its own", () => {
    // 15 < balanced minPow (16); no other earned signal.
    expect(admitStranger(base({ powDifficulty: 15 }))).toBe(false);
    expect(admitStranger(base({ powDifficulty: 0 }))).toBe(false);
  });
});

describe("admitStranger — PoW is additive (only ever admits, never drops)", () => {
  it("a stranger the other signals already admit is NOT dropped by low/zero PoW", () => {
    // Positive WoT admits regardless of PoW = 0.
    expect(admitStranger(base({ wotScore: 0.5, powDifficulty: 0 }))).toBe(true);
    // Engagement admits regardless of PoW = 0.
    expect(admitStranger(base({ engagementScore: 3, powDifficulty: 0 }))).toBe(true);
    // Followers admit regardless of PoW = 0.
    expect(admitStranger(base({ followerCount: 20, powDifficulty: 0 }))).toBe(true);
  });

  it("in-network content is exempt regardless of PoW (0 or high)", () => {
    expect(admitStranger(base({ isInNetwork: true, powDifficulty: 0 }))).toBe(true);
    expect(admitStranger(base({ isInNetwork: true, powDifficulty: 30 }))).toBe(true);
    expect(
      admitStranger(
        base({ isInNetwork: true, powDifficulty: 0, config: DISCOVER_PRESET_CONFIG.strict }),
      ),
    ).toBe(true);
  });

  it("the throwaway case: fresh key, no history, no PoW → dropped", () => {
    expect(
      admitStranger(
        base({ wotScore: 0, engagementScore: 0, powDifficulty: 0, firstSeen: null, followerCount: undefined }),
      ),
    ).toBe(false);
  });
});

describe("admitStranger — per-preset minPow differences", () => {
  it("16-bit PoW clears Open/Balanced but not Strict", () => {
    const powDifficulty = 16; // >= open(12) & balanced(16), < strict(20)
    expect(admitStranger(base({ powDifficulty, config: DISCOVER_PRESET_CONFIG.open }))).toBe(true);
    expect(admitStranger(base({ powDifficulty, config: DISCOVER_PRESET_CONFIG.balanced }))).toBe(true);
    expect(admitStranger(base({ powDifficulty, config: DISCOVER_PRESET_CONFIG.strict }))).toBe(false);
  });
});

describe("admitStranger — the cold stranger", () => {
  it("drops a cold, brand-new, unknown, unscored, followerless post", () => {
    expect(admitStranger(base())).toBe(false);
  });

  it("drops when age and follower count are both UNKNOWN and nothing else signals", () => {
    expect(admitStranger(base({ firstSeen: null, followerCount: undefined }))).toBe(false);
  });
});

describe("gateStrangerProfile — three-state profile resolution gate", () => {
  const gate = (over: Partial<ProfileGateInput> = {}) =>
    gateStrangerProfile({ isInNetwork: false, wotScore: undefined, resolution: "unknown", ...over });

  it("UNKNOWN (kind-0 fetch in flight) → grace, never a hard drop", () => {
    expect(gate({ resolution: "unknown" })).toBe("grace");
  });

  it("RESOLVED + named profile → admit", () => {
    expect(gate({ resolution: "named" })).toBe("admit");
  });

  it("RESOLVED + no profile (fetch settled empty, or empty name) → drop", () => {
    expect(gate({ resolution: "unnamed" })).toBe("drop");
  });

  it("followed authors are ALWAYS admitted, whatever the profile state", () => {
    expect(gate({ isInNetwork: true, resolution: "unknown" })).toBe("admit");
    expect(gate({ isInNetwork: true, resolution: "unnamed" })).toBe("admit");
    expect(gate({ isInNetwork: true, resolution: "named" })).toBe("admit");
  });

  it("positive WoT is in-network by trust — always admitted too", () => {
    expect(gate({ wotScore: 0.01, resolution: "unknown" })).toBe("admit");
    expect(gate({ wotScore: 0.01, resolution: "unnamed" })).toBe("admit");
  });

  it("a zero/negative WoT score does NOT exempt a stranger", () => {
    expect(gate({ wotScore: 0, resolution: "unnamed" })).toBe("drop");
    expect(gate({ wotScore: -0.5, resolution: "unknown" })).toBe("grace");
  });
});

describe("admitStranger — per-preset threshold differences", () => {
  it("the same middling engagement is admitted on Open/Balanced but dropped on Strict", () => {
    const engagementScore = 5; // > open(1) & balanced(3), < strict(8)
    expect(admitStranger(base({ engagementScore, config: DISCOVER_PRESET_CONFIG.open }))).toBe(true);
    expect(admitStranger(base({ engagementScore, config: DISCOVER_PRESET_CONFIG.balanced }))).toBe(true);
    expect(admitStranger(base({ engagementScore, config: DISCOVER_PRESET_CONFIG.strict }))).toBe(false);
  });

  it("a 5-day-old account is established on Open but not on Balanced/Strict", () => {
    const firstSeen = NOW - 5 * DAY; // > open(3), < balanced(7) & strict(14)
    expect(admitStranger(base({ firstSeen, config: DISCOVER_PRESET_CONFIG.open }))).toBe(true);
    expect(admitStranger(base({ firstSeen, config: DISCOVER_PRESET_CONFIG.balanced }))).toBe(false);
    expect(admitStranger(base({ firstSeen, config: DISCOVER_PRESET_CONFIG.strict }))).toBe(false);
  });

  it("10 followers clear Open's bar but not Balanced/Strict", () => {
    const followerCount = 10; // >= open(5), < balanced(15) & strict(40)
    expect(admitStranger(base({ followerCount, config: DISCOVER_PRESET_CONFIG.open }))).toBe(true);
    expect(admitStranger(base({ followerCount, config: DISCOVER_PRESET_CONFIG.balanced }))).toBe(false);
    expect(admitStranger(base({ followerCount, config: DISCOVER_PRESET_CONFIG.strict }))).toBe(false);
  });
});
