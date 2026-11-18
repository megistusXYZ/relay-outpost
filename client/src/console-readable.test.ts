/**
 * The operator console reads at 12px or more (2026-11-17). The browser check
 * (ship/console-text-e2e.cjs) covers the sections it can open; this backstop
 * covers the states it can't reach, like the post previews for every kind.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(import.meta.dirname, "pages/relay-ops");

/** Lines that set text under 12px (avatar initials are allowed). */
export function smallTextLines(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (/AvatarFallback/.test(line)) return;
    if (/text-\[(?:[1-9]|1[01])(?:\.\d)?px\]/.test(line)) hits.push(i + 1);
  });
  return hits;
}

/** Chart text set under 12px (`fontSize: 10` in a tick, `fontSize={9}` on a label). */
export function smallChartText(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => { if (/fontSize(?:: ?|=\{)(?:[1-9]|1[01])\b/.test(line)) hits.push(i + 1); });
  return hits;
}

describe("charts in analytics and the console are readable", () => {
  it("the check can fail", () => {
    expect(smallChartText(`<XAxis tick={{ fontSize: 10 }} />`)).toEqual([1]);
    expect(smallChartText(`<text fontSize={9}>x</text>`)).toEqual([1]);
    expect(smallChartText(`<XAxis tick={{ fontSize: 12 }} />`)).toEqual([]);
  });
  it("no chart label is under 12px", () => {
    const roots = [path.resolve(import.meta.dirname, "components/analytics"), DIR];
    const found = roots.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".tsx") && !/ \d+\.tsx$/.test(f)).flatMap((f) => smallChartText(readFileSync(path.join(d, f), "utf8")).map((n) => `${f}:${n}`)));
    found.push(...smallChartText(readFileSync(path.resolve(import.meta.dirname, "pages/AnalyticsDashboard.tsx"), "utf8")).map((n) => `AnalyticsDashboard.tsx:${n}`));
    expect(found).toEqual([]);
  });
});

describe("the operator console is readable", () => {
  it("the check can fail", () => {
    expect(smallTextLines(`<span className="text-[10px] text-muted-foreground">2m</span>`)).toEqual([1]);
    expect(smallTextLines(`<AvatarFallback className="text-[10px]">AL</AvatarFallback>`)).toEqual([]);
    expect(smallTextLines(`<span className="text-[12px]">2m</span>`)).toEqual([]);
  });

  it("no console file sets text under 12px", () => {
    const found = readdirSync(DIR)
      .filter((f) => f.endsWith(".tsx") && !/ \d+\.tsx$/.test(f) && !/\.test\./.test(f))
      .flatMap((f) => smallTextLines(readFileSync(path.join(DIR, f), "utf8")).map((n) => `${f}:${n}`));
    expect(found).toEqual([]);
  });
});
