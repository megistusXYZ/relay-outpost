/**
 * Front-door curation (lib/discover-curation.ts) — two rules born from a live
 * report (2026-08-27): a "Damus Airdrop — $wSATS claim is open" scam sat at
 * the top of the Discover feed tile.
 *
 *  - Promo-bait never makes the FRONT DOOR. Airdrop/claim-shill patterns are
 *    dropped from teasers only — the full feed stays unfiltered; this is
 *    curation of our showcase, not censorship of the network.
 *  - People you follow come first. Teasers prefer followed authors, with
 *    trending only filling the gaps — a stable partition, so nobody is
 *    dropped, only ordered.
 */
import { describe, expect, it } from "vitest";
import { isPromoBait, preferFollowed } from "./discover-curation";

describe("isPromoBait — the airdrop-shill floor", () => {
  it("catches the reported scam verbatim", () => {
    expect(isPromoBait("🎈 Damus Airdrop is live — $wSATS claim is open.")).toBe(true);
  });

  it("catches the pattern family: airdrops, claim-now, token shills", () => {
    expect(isPromoBait("AIRDROP for early users! claim yours")).toBe(true);
    expect(isPromoBait("The $MOON claim is now open, don't miss out")).toBe(true);
    expect(isPromoBait("Claim your free tokens before the snapshot")).toBe(true);
  });

  it("leaves ordinary posts alone — even ones about money", () => {
    expect(isPromoBait("Zapped 21 sats to my favorite writer today")).toBe(false);
    expect(isPromoBait("The rent spike isn't a glitch; it's the market")).toBe(false);
    expect(isPromoBait("I claim no expertise in this")).toBe(false);
  });
});

describe("preferFollowed — your people first, nobody dropped", () => {
  const item = (author: string, id: string) => ({ author, id });

  it("followed authors lead; both groups keep their incoming order", () => {
    const out = preferFollowed(
      [item("x", "1"), item("f1", "2"), item("y", "3"), item("f2", "4")],
      (a) => a.startsWith("f"),
      (i) => i.author,
    );
    expect(out.map((i) => i.id)).toEqual(["2", "4", "1", "3"]);
  });

  it("with nothing followed, order is untouched", () => {
    const list = [item("a", "1"), item("b", "2")];
    expect(preferFollowed(list, () => false, (i) => i.author)).toEqual(list);
  });
});
