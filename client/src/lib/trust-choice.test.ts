// @vitest-environment jsdom
/**
 * "How careful should we be with people you don't know?" — owner, 2026-10-06:
 * the Trust page must be an easy concept for everyone. Three choices replace
 * the Web of Trust switch and the hidden "How strict?" preset, and each one
 * sets exactly what the feeds hide.
 *
 *  - See everything: trust scores off, nothing hidden.
 *  - Balanced (new accounts start here): hides accounts your network flagged.
 *  - Careful: also hides accounts your network doesn't know or barely knows.
 *
 * Existing accounts that never chose keep seeing everything (turning scores on
 * asks them to sign once), and are invited on the page instead.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyTrustChoice, readTrustChoice, readWotEnabled, startNewAccountTrust } from "./trust-choice";
import { readExcludedTiers } from "./trust-filter";
import { readReachDepth } from "./trust-preset";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});

const hidden = () => [...readExcludedTiers()].sort();

describe("each choice sets what the feeds hide", () => {
  it("Balanced: trust scores on, accounts your network flagged are hidden", () => {
    applyTrustChoice("balanced");
    expect(readWotEnabled()).toBe(true);
    expect(hidden()).toEqual(["flagged"]);
    expect(readReachDepth()).toBe("global");
  });

  it("Careful: also hides accounts nobody you trust knows — with a reach every feed honors", () => {
    applyTrustChoice("careful");
    expect(readWotEnabled()).toBe(true);
    expect(hidden()).toEqual(["flagged", "none", "weak"]);
    // Not a hop depth: Home reads 1hop/2hops/3hops as "global", which made
    // the old Strict show as "Custom" on the feed.
    expect(readReachDepth()).toBe("global");
  });

  it("See everything: trust scores off, nothing hidden", () => {
    applyTrustChoice("careful");
    applyTrustChoice("everything");
    expect(readWotEnabled()).toBe(false);
    expect(hidden()).toEqual([]);
    expect(readReachDepth()).toBe("off");
  });

  it("reads back the choice that was made", () => {
    for (const c of ["everything", "balanced", "careful"] as const) {
      applyTrustChoice(c);
      expect(readTrustChoice()).toBe(c);
    }
  });

  it("settings tuned by hand read as Custom", () => {
    applyTrustChoice("balanced");
    localStorage.setItem("relay-outpost-excluded-tiers", JSON.stringify(["weak"]));
    expect(readTrustChoice()).toBe("custom");
  });

  it("choosing tells open feeds at once — no reload", () => {
    const heard: string[] = [];
    for (const ev of ["trust-filter-tiers-changed", "reach-depth-changed", "wot-enabled-changed"]) {
      window.addEventListener(ev, () => heard.push(ev));
    }
    applyTrustChoice("careful");
    expect(heard.sort()).toEqual(["reach-depth-changed", "trust-filter-tiers-changed", "wot-enabled-changed"]);
  });
});

describe("where people start", () => {
  it("an existing account that never chose sees everything", () => {
    expect(readTrustChoice()).toBe("everything");
  });

  it("a new account starts on Balanced", () => {
    startNewAccountTrust();
    expect(readTrustChoice()).toBe("balanced");
  });

  it("with nothing saved, the page and the feeds agree: no reach filter", () => {
    // Home and the page defaulted to "off"; readReachDepth said "global".
    expect(readReachDepth()).toBe("off");
  });
});
