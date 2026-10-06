/**
 * Badges, step 2 (owner, 2026-10-06 — badges-plan): start from a template,
 * shape it with a few plain controls, and see exactly what you'll publish.
 * The preview and the published picture come from one drawing, so they can't
 * disagree.
 */
import { describe, it, expect } from "vitest";
import { BADGE_TEMPLATES, BADGE_COLOURS, BADGE_SHAPES, BADGE_SYMBOLS, badgeSvg, type BadgeDesign } from "./badge-design";

describe("templates", () => {
  it("offers the eight agreed starting points, plus blank", () => {
    expect(BADGE_TEMPLATES.map((t) => t.design.name)).toEqual([
      "Founding member", "Moderator", "Helper", "Top contributor", "Event attendee", "Supporter", "Thank you", "Welcome", "",
    ]);
  });

  it("each opens as a complete design you can publish straight away", () => {
    for (const t of BADGE_TEMPLATES.slice(0, 8)) {
      expect(t.design.description.length, t.id).toBeGreaterThan(0);
      expect(BADGE_SHAPES).toContain(t.design.shape);
      expect(Object.keys(BADGE_COLOURS)).toContain(t.design.colour);
      expect(t.design.symbol.kind === "emoji" || BADGE_SYMBOLS.includes(t.design.symbol.id)).toBe(true);
    }
  });
});

describe("a design draws one picture", () => {
  const founder = BADGE_TEMPLATES[0].design;

  it("the same design always draws the same picture", () => {
    expect(badgeSvg(founder)).toBe(badgeSvg({ ...founder }));
  });

  it("changing the colour, shape or symbol changes the picture", () => {
    const base = badgeSvg(founder);
    const other: Array<Partial<BadgeDesign>> = [
      { colour: founder.colour === "blue" ? "rose" : "blue" },
      { shape: founder.shape === "circle" ? "star" : "circle" },
      { symbol: { kind: "emoji", char: "🎉" } },
    ];
    for (const change of other) expect(badgeSvg({ ...founder, ...change })).not.toBe(base);
  });

  it("the name and description never appear on the picture — unreadable at icon size", () => {
    const svg = badgeSvg({ ...founder, name: "Zebra Unicorn", description: "Quokka" });
    expect(svg).not.toMatch(/Zebra|Quokka/);
  });

  it("is a square picture any browser can draw", () => {
    const svg = badgeSvg(founder);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 100 100"/);
    expect(svg).toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});
