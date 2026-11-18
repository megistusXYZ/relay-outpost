/**
 * "Live" is said one way (components/LiveBadge.tsx, 2026-11-17): 12px or
 * larger, sentence case, no glow. The badges it replaced were "LIVE" in
 * 7–10px capitals on a glowing red pill, drawn a dozen different ways.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    // " 2.tsx"-style sync duplicates are not part of the app.
    else if (/\.tsx$/.test(name) && !/ \d+\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** Lines that draw "LIVE" in capitals as text on screen. */
export function shoutedLive(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/>\s*LIVE\s*</.test(line) || /^\s+LIVE\s*$/.test(line) || /\?\s*"LIVE"\s*:/.test(line)) hits.push(i + 1);
  });
  return hits;
}

describe("live is said one way", () => {
  it("the guard can fail: it catches each old shape", () => {
    expect(shoutedLive(`<Badge className="x">LIVE</Badge>`)).toEqual([1]);
    expect(shoutedLive(`<div>\n                LIVE\n</div>`)).toEqual([2]);
    expect(shoutedLive(`const label = live ? "LIVE" : "Ended";`)).toEqual([1]);
    expect(shoutedLive(`// a LIVE stream stays`)).toEqual([]);
  });

  it("no screen draws LIVE in capitals", () => {
    const found = sources(SRC).flatMap((f) => shoutedLive(readFileSync(f, "utf8")).map((n) => `${path.relative(SRC, f)}:${n}`));
    expect(found).toEqual([]);
  });

  it("every form is at least 12px, with no glow", () => {
    const badge = readFileSync(path.join(SRC, "components/LiveBadge.tsx"), "utf8");
    const sizes = [...badge.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
    expect(badge).not.toMatch(/shadow-\[0_0/);
    expect(badge).not.toMatch(/uppercase/);
  });
});
