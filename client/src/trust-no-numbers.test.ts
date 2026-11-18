/**
 * Trust is said as a fact about the reader's network, never as a number on a
 * person (owner, 2026-10-03: "Highly Trusted 100%" on a stranger's card read
 * as a verdict). Cards, rows, bubbles and hover cards use TrustMark and
 * TrustPhrase (components/TrustMark.tsx, lib/trust-words.ts). The percentage
 * stays in two places that are about the score itself: the profile's trust
 * panel and the operator's analytics.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { getTrustPhrase } from "./lib/trust-words";
import { getSignalTierLabel } from "./lib/graperank";

const SRC = path.resolve(import.meta.dirname);
const ALLOWED = new Set(["pages/Profile.tsx", "pages/AnalyticsDashboard.tsx"]);

function sources(dir: string, ext = /\.tsx$/): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full, ext));
    else if (ext.test(name) && !/ \d+\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Lines that print a trust score as text on screen. */
export function trustNumbers(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/^\s*\{scorePct\}\s*$/.test(line) || />\{scorePct\}</.test(line)) hits.push(i + 1);
    else if (/\{Math\.round\(influence \* 100\)\}/.test(line)) hits.push(i + 1);
    else if (/\{formatInfluence\(/.test(line) || /· \{formatInfluence\(/.test(line)) hits.push(i + 1);
  });
  return hits;
}


describe("the low tier is \"Some ties\", not \"New\" (owner, 2026-11-17)", () => {
  // "New" already means unread and newcomer ("3 new", "New here"); one word per thing.
  it("on cards, in legends and in menus", () => {
    expect(getTrustPhrase("low")).toBe("Some ties to your network");
    expect(getSignalTierLabel("low")).toBe("Some ties");
  });
});

describe("trust is never a number on a person", () => {
  it("the guard can fail: it catches each old shape", () => {
    expect(trustNumbers(`<span>\n  {scorePct}\n</span>`)).toEqual([2]);
    expect(trustNumbers(`  {Math.round(influence * 100)}`)).toEqual([1]);
    expect(trustNumbers(`  {label} · {formatInfluence(influence)}`)).toEqual([1]);
    expect(trustNumbers(`// the percentage stays in the panel`)).toEqual([]);
  });

  it("the tier words are ties, not verdicts", () => {
    // VOCABULARY.md: Trusted · Known · New · Few ties · Concerns.
    const verdict = /["'](Highly [Tt]rusted|Low [Tt]rust|Neutral)["']/;
    expect(verdict.test(`label: "Neutral"`)).toBe(true);
    const found = sources(SRC, /\.tsx?$/).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) =>
        !/^\s*(\/\/|\*|\/\*)/.test(line) && verdict.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : []));
    expect(found).toEqual([]);
  });

  it("no card, row or hover card prints a trust score", () => {
    const found = sources(SRC)
      .filter((f) => !ALLOWED.has(path.relative(SRC, f)))
      .flatMap((f) => trustNumbers(readFileSync(f, "utf8")).map((n) => `${path.relative(SRC, f)}:${n}`));
    expect(found).toEqual([]);
  });
});
