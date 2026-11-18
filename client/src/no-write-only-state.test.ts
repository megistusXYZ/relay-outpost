/**
 * State nobody reads only costs re-renders (2026-11-17 review: Account asked the
 * wallet for transactions it never showed; Home flipped a hint flag twice per
 * update). The unused-locals check can't see it, because the setter is used.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/.test(name) && !/ \d+\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/**
 * Lines that keep state no one reads: `const [, setX] = useState(...)` or a
 * bare `useState(...)`. A setter named `…Tick` or `…Version` is the deliberate
 * re-render trigger (bump a counter so derived values refresh: a live
 * duration each minute, names once they load) and is allowed.
 */
export function writeOnlyState(text: string): number[] {
  const hits: number[] = [];
  text.split("\n").forEach((line, i) => {
    const m = line.match(/const \[\s*,\s*(set[A-Z]\w*)\s*\]\s*=\s*useState/);
    if ((m && !/(?:Tick|Version)$/.test(m[1])) || /^\s*useState\(/.test(line)) hits.push(i + 1);
  });
  return hits;
}

describe("no write-only state", () => {
  it("the check can fail", () => {
    expect(writeOnlyState(`  const [, setHint] = useState(false);`)).toEqual([1]);
    expect(writeOnlyState(`  useState(() => localStorage.getItem("x"));`)).toEqual([1]);
    expect(writeOnlyState(`  const [hint, setHint] = useState(false);`)).toEqual([]);
    expect(writeOnlyState(`  const [, setNowTick] = useState(0);`)).toEqual([]);
    expect(writeOnlyState(`  const [, setFollowerVersion] = useState(0);`)).toEqual([]);
  });

  it("nothing keeps state no one reads", () => {
    const found = files(SRC).flatMap((f) => writeOnlyState(readFileSync(f, "utf8")).map((n) => `${path.relative(SRC, f)}:${n}`));
    expect(found).toEqual([]);
  });
});
