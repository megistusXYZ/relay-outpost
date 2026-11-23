/**
 * Which band of the Articles page a writer's work belongs in (owner,
 * 2026-11-23): people you follow first; then, only with the wider network on,
 * writers your network vouches for; nobody else at all.
 */
import { describe, it, expect } from "vitest";
import { articleBand, pickByBand, type BandSignals } from "./article-band";

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

describe("pickByBand: the few articles a small card shows (Discover's Articles card)", () => {
  const item = (id: string, author: string) => ({ id, author });
  const pick = (items: { id: string; author: string }[], limit = 2, s = signals()) => pickByBand(items, (i) => i.author, s, limit).map((i) => i.id);

  it("your own people come first, then your wider circle, in the order given", () => {
    expect(pick([item("c1", INES), item("y1", ANA), item("c2", RUI)], 3)).toEqual(["y1", "c1", "c2"]);
  });
  it("a stranger and a flagged account are never picked, however new", () => {
    expect(pick([item("s", STRANGER), item("b", BAD), item("u", "nobody-knows"), item("c", INES)], 3)).toEqual(["c"]);
  });
  it("one article per writer, so one prolific writer does not fill the card", () => {
    expect(pick([item("y1", ANA), item("y2", ANA), item("c1", INES)], 2)).toEqual(["y1", "c1"]);
  });
  it("stops at the limit", () => {
    expect(pick([item("y1", ANA), item("c1", INES), item("c2", RUI)], 2)).toEqual(["y1", "c1"]);
  });
  it("with the wider network off only your own people are picked", () => {
    expect(pick([item("c1", INES), item("y1", ANA)], 2, signals({ widerNetworkOn: false }))).toEqual(["y1"]);
  });
});
