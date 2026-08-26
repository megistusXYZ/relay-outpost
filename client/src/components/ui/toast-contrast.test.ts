/**
 * The destructive toast must stay legible in both themes.
 *
 * It shipped for a long time as an amber gradient in light and a BRAND gradient
 * in dark — with `dark:text-brand` on `dark:from-brand/90`, i.e. the same hue
 * for foreground and background. A real relay error rendered as violet-on-violet
 * and its description was barely readable. Light mode was legible but amber,
 * so an error and a warning looked identical.
 *
 * Measured against the tokens now in use (WCAG AA for normal text = 4.5:1):
 *
 *   light  hsl(0 65% 50%) + hsl(0 0% 100%)  -> 5.06:1
 *   dark   hsl(0 50% 35%) + hsl(0 0% 98%)   -> 8.29:1
 *
 * and the description's `opacity-90` is cancelled on this variant because at
 * 90% the light pairing measures 4.34:1 — under the floor.
 *
 * Colour regressions are invisible to tsc and to every behavioural test, so
 * this reads the source and the stylesheet. Prove it fails before trusting it:
 * put `dark:text-brand` back and watch it go red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const toastSrc = readFileSync(join(process.cwd(), "client/src/components/ui/toast.tsx"), "utf8");
const cssSrc = readFileSync(join(process.cwd(), "client/src/index.css"), "utf8");

/** `--destructive: 0 65% 50%;` → [0, 65, 50] */
function readHsl(css: string, name: string): number[][] {
  const out: number[][] = [];
  const re = new RegExp(String.raw`--${name}:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  return out;
}

function hslToRgb([h, s, l]: number[]): [number, number, number] {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : [0, 0, 0];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("destructive toast uses tokens, not the brand hue", () => {
  it("never paints brand or amber on the destructive variant", () => {
    // The exact regression: same hue for text and background.
    const variant = toastSrc.slice(toastSrc.indexOf("destructive:"), toastSrc.indexOf("},", toastSrc.indexOf("destructive:")));
    expect(variant).not.toMatch(/text-brand|from-brand|via-brand|to-brand/);
    expect(variant).not.toMatch(/amber/);
    expect(variant).toMatch(/bg-destructive/);
    expect(variant).toMatch(/text-destructive-foreground/);
  });

  it("cancels the description's opacity on this variant", () => {
    // 90% white over the light destructive red measures 4.34:1 — under AA.
    expect(toastSrc).toMatch(/group-\[\.destructive\]:opacity-100/);
  });
});

describe("the destructive tokens themselves clear AA in both themes", () => {
  const bgs = readHsl(cssSrc, "destructive");
  const fgs = readHsl(cssSrc, "destructive-foreground");

  it("defines the pair for both light and dark", () => {
    // Two declarations each: :root and .dark. If a theme loses one it inherits
    // the other's colour silently, which is how this broke in the first place.
    expect(bgs.length).toBeGreaterThanOrEqual(2);
    expect(fgs.length).toBeGreaterThanOrEqual(2);
  });

  it("clears 4.5:1 for every theme's pairing", () => {
    const results = bgs.map((bg, i) => contrast(hslToRgb(bg), hslToRgb(fgs[i] ?? fgs[0])));
    for (const r of results) expect(r).toBeGreaterThanOrEqual(4.5);
  });
});
