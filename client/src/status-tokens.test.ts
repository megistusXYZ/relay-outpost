/**
 * Status colours as tokens — Light mode Phase 2c, first slice (LIGHT_MODE.md;
 * owner, 2026-10-08). Success, warning and danger each get ONE light-mode
 * colour instead of a different Tailwind shade per screen. Info folds into
 * violet (--primary). The values LIGHT_MODE.md first sketched were fills;
 * as text two of them failed (success 3.99:1, warning 3.12:1), so these are
 * the text-safe shades, measured here against the darkest light surface a
 * status line can sit on (--accent), as status-contrast.test.ts does.
 *
 * Dark mode is out of scope and must not change: a converted site keeps its
 * original dark shade behind `dark:`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
const token = (name: string): [number, number, number] => {
  const m = ROOT.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%`));
  if (!m) throw new Error(`no light --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
function rgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (c: [number, number, number]) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const A = lum(rgb(a)), B = lum(rgb(b));
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

describe("status tokens (light)", () => {
  for (const name of ["success", "warning", "danger"]) {
    it(`--${name} is readable as text on every light surface (4.5:1)`, () => {
      for (const surface of ["accent", "background", "card"]) {
        expect(ratio(token(name), token(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("are Tailwind colours (text-success, bg-warning/10, border-danger/30…)", () => {
    const tw = readFileSync(path.resolve(import.meta.dirname, "../../tailwind.config.ts"), "utf8");
    for (const name of ["success", "warning", "danger"]) expect(tw).toMatch(new RegExp(`${name}:\\s*\\{[^}]*hsl\\(var\\(--${name}\\)`));
  });
});
