// Locks the calm new-user defaults for the feed-intelligence switches:
// feed ranking stays ON by default, but the per-post engagement-score badge is
// OFF until the user explicitly enables it. Users who chose a value before the
// default flip keep it (their localStorage key exists).

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage/window; the prefs read them synchronously.
const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});
vi.stubGlobal("window", {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
});

import {
  isFeedRankingEnabled, setFeedRankingEnabled,
  isEngagementScoreEnabled, setEngagementScoreEnabled,
} from "./feed-prefs";

beforeEach(() => __store.clear());

describe("feed ranking default", () => {
  it("unset → ON (unchanged behavior)", () => {
    expect(isFeedRankingEnabled()).toBe(true);
  });

  it('explicit "false" → OFF', () => {
    localStorage.setItem("relay-outpost-feed-ranking-enabled", "false");
    expect(isFeedRankingEnabled()).toBe(false);
  });

  it("round-trips through the setter", () => {
    setFeedRankingEnabled(false);
    expect(isFeedRankingEnabled()).toBe(false);
    setFeedRankingEnabled(true);
    expect(isFeedRankingEnabled()).toBe(true);
  });
});

describe("engagement-score badge default", () => {
  it("unset → OFF (calm default for new users)", () => {
    expect(isEngagementScoreEnabled()).toBe(false);
  });

  it('explicit "true" (pre-flip opt-in) → stays ON', () => {
    localStorage.setItem("relay-outpost-show-engagement", "true");
    expect(isEngagementScoreEnabled()).toBe(true);
  });

  it('explicit "false" → stays OFF', () => {
    localStorage.setItem("relay-outpost-show-engagement", "false");
    expect(isEngagementScoreEnabled()).toBe(false);
  });

  it("round-trips through the setter", () => {
    setEngagementScoreEnabled(true);
    expect(isEngagementScoreEnabled()).toBe(true);
    setEngagementScoreEnabled(false);
    expect(isEngagementScoreEnabled()).toBe(false);
  });
});
