/**
 * A form control's border is how a person finds the control, so it meets the
 * 3:1 that WCAG 1.4.11 asks of a control boundary, on every ground a field or
 * switch can sit on, in every theme. It was 1.2–1.6:1 (brand system review,
 * 2026-11-17). --input is also the off track of the switch, which needs the
 * same 3:1 for its state to read.
 *
 * Themes cascade: dark starts from light, black starts from dark.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type HSL = [number, number, number];
const CSS = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");

function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  return CSS.slice(start, CSS.indexOf("}", start));
}
function tokens(src: string): Record<string, HSL> {
  const out: Record<string, HSL> = {};
  for (const m of src.matchAll(/--([a-z-]+):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}
const light = tokens(block(":root"));
const dark = { ...light, ...tokens(block(".dark")) };
const black = { ...dark, ...tokens(block('.dark[data-theme="black"]')) };

function rgb([h, s, l]: HSL): HSL {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (c: HSL) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: HSL, b: HSL) => {
  const A = lum(rgb(a)), B = lum(rgb(b));
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

describe("input border contrast", () => {
  for (const [name, t] of [["light", light], ["dark", dark], ["black", black]] as const) {
    it(`--input is 3:1 on background, card, popover and muted (${name})`, () => {
      for (const ground of ["background", "card", "popover", "muted"]) {
        expect(ratio(t.input, t[ground]), `${name}: input on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("can fail: the old 82% light border is under 3:1 on white", () => {
    expect(ratio([220, 9, 82], [0, 0, 100])).toBeLessThan(3);
  });

  it("the shared search pill uses the control border, not a faint tint", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "components/SearchPill.tsx"), "utf8");
    const cls = src.slice(src.indexOf("export const searchPillClass"), src.indexOf(";", src.indexOf("export const searchPillClass")));
    expect(cls).toMatch(/\bborder-input\b/);
    expect(cls).not.toMatch(/(?:^|[\s"])(?:dark:)?border-(?:primary|foreground|white)\/\d/);
  });

  it("composers don't swap the border for a faint white one in dark", () => {
    for (const file of ["pages/RSSFeed.tsx", "pages/Community.tsx"]) {
      const src = readFileSync(path.resolve(import.meta.dirname, file), "utf8");
      const lines = src.split("\n").filter((l) => l.includes("border-input"));
      expect(lines.length, file).toBeGreaterThan(0);
      for (const l of lines) expect(l, file).not.toMatch(/dark:border-white\//);
    }
  });
});
