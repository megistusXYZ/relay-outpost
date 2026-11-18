/**
 * The app's old accent was violet (the "Synthesis" palette). The brand is ink
 * with Ember now, so a violet or indigo on screen is a leftover (2026-11-17
 * sweep: composer glows, banner glow lines, tinted cards, chart grids, the
 * operator radar). Purple stays only where it means something else: code
 * highlighting, other apps' brand colours, the colour choices people pick for
 * badges and petnames, and a service's logo. The theme's cool blue (#3D6BFF,
 * hue 226) and pale star specks sit outside the band on purpose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname);
const ALLOWED = new Set([
  "lib/client-display.ts", // other Nostr apps' own colours
  "lib/badge-design.tsx", // badge colours people choose
  "components/PetnameDialog.tsx", // petname colours people choose
  "components/MusicLinkCard.tsx", // Wavlake's logo
]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|css)$/.test(name) && !/ \d+\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

function hue(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max / 255 };
}

/** Lines with a violet or indigo colour literal. */
export function violetLines(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (/hljs/.test(line)) return;
    const cols: [number, number, number][] = [];
    for (const m of line.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) cols.push([+m[1], +m[2], +m[3]]);
    for (const m of line.matchAll(/#([0-9a-fA-F]{6})\b/g)) cols.push([0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)) as [number, number, number]);
    if (cols.some(([r, g, b]) => { const c = hue(r, g, b); return c.s > 0.35 && c.v > 0.25 && c.h > 230 && c.h < 305; })) hits.push(i + 1);
  });
  return hits;
}

describe("no old violet", () => {
  it("the check can fail: it catches the old shades and leaves Ember and ink alone", () => {
    expect(violetLines(`style={{ border: "1px solid rgba(140, 100, 220, 0.12)" }}`)).toEqual([1]);
    expect(violetLines(`color: "rgb(129, 140, 248)"`)).toEqual([1]);
    expect(violetLines(`background: "#FF8861"; color: #0D0F12; rgba(163,172,186,0.35)`)).toEqual([]);
    expect(violetLines(`const INDIGO = "#3D6BFF"; rgba(180, 190, 255, 0.5)`)).toEqual([]);
  });

  it("no screen draws the retired violet", () => {
    const css = files(SRC);
    const found: string[] = [];
    for (const f of css) {
      const rel = path.relative(SRC, f);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(f, "utf8");
      // Code highlighting keeps its colours (index.css .hljs-* rules).
      const lines = rel === "index.css" ? text.replace(/(?:\.dark\s+)?\.hljs[^{]*\{[^}]*\}/g, (m) => m.replace(/[^\n]/g, " ")) : text;
      for (const n of violetLines(lines)) found.push(`${rel}:${n}`);
    }
    expect(found).toEqual([]);
  });
});
