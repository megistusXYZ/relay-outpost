import { describe, it, expect } from "vitest";
import { TIER_GLYPH } from "./trust-tier-glyph";
import type { SignalTier } from "@/lib/graperank";

// This locks the accessibility + consistency invariant for the unified trust-tier
// glyph system (WCAG 1.4.1 — meaning conveyed by SHAPE/FILL, not hue alone). The
// legend, the per-post badge, and every other tier-render site consume TIER_GLYPH,
// so asserting the map here guarantees they can never drift apart.

describe("TIER_GLYPH — tier → glyph single source of truth", () => {
  it("covers every SignalTier exactly once", () => {
    const keys = Object.keys(TIER_GLYPH).sort();
    expect(keys).toEqual(["flagged", "low", "moderate", "none", "strong", "weak"]);
  });

  it("strong → green filled dot", () => {
    const g = TIER_GLYPH.strong;
    expect(g.kind).toBe("dot");
    expect(g.colorToken).toBe("green");
    expect(g.className).toContain("emerald");
  });

  it("moderate → blue filled dot", () => {
    const g = TIER_GLYPH.moderate;
    expect(g.kind).toBe("dot");
    expect(g.colorToken).toBe("blue");
    expect(g.className).toContain("blue");
  });

  it("low → teal filled dot", () => {
    const g = TIER_GLYPH.low;
    expect(g.kind).toBe("dot");
    expect(g.colorToken).toBe("teal");
    expect(g.className).toContain("cyan");
  });

  it("weak → AMBER filled dot, never red", () => {
    const g = TIER_GLYPH.weak;
    expect(g.kind).toBe("dot");
    expect(g.colorToken).toBe("amber");
    expect(g.className).toContain("amber");
    // The core regression this system fixes: Low must not read as red (which
    // collided with Flagged and the old signal-slash icon).
    expect(g.className).not.toContain("red");
  });

  it("none → HOLLOW / outline gray dot (distinct in greyscale from filled dots)", () => {
    const g = TIER_GLYPH.none;
    expect(g.kind).toBe("hollow");
    expect(g.colorToken).toBe("gray");
    // Outline, not a fill: it styles a border and never paints a solid dot colour.
    expect(g.className).toContain("border");
    expect(g.className).not.toContain("bg-");
  });

  it("flagged → RED flag icon (the only red in the system)", () => {
    const g = TIER_GLYPH.flagged;
    expect(g.kind).toBe("flag");
    expect(g.colorToken).toBe("red");
    expect(g.className).toContain("red");
  });

  it("red is used by flagged ONLY — no other tier's glyph is red", () => {
    const redTiers = (Object.keys(TIER_GLYPH) as SignalTier[]).filter(
      (t) => TIER_GLYPH[t].colorToken === "red",
    );
    expect(redTiers).toEqual(["flagged"]);
  });

  it("the six tiers are distinguishable by shape/fill (kind) — flag & hollow break the dot ladder", () => {
    const kinds = (Object.keys(TIER_GLYPH) as SignalTier[]).map((t) => TIER_GLYPH[t].kind);
    // Exactly one flag (flagged) and one hollow (none); the rest are filled dots.
    expect(kinds.filter((k) => k === "flag").length).toBe(1);
    expect(kinds.filter((k) => k === "hollow").length).toBe(1);
    expect(kinds.filter((k) => k === "dot").length).toBe(4);
  });
});
