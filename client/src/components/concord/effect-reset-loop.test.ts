/**
 * Every group chat page flooded the console with React's "Maximum update depth
 * exceeded" (50,000+ warnings in minutes), from the group settings dialog even
 * while it was closed. Its seeding effect ran `if (!open) { setDirty({}); … }`
 * with `dirty` in its own deps: a brand-new `{}` is a new value every time, so
 * the effect re-ran, set it again, and never stopped.
 *
 * WHY A SOURCE TEST. No ESLint runs here and there is no
 * @testing-library/react (see fold-freshness.test.ts), so the loop can't be
 * observed by rendering. The pattern is exact enough to read: an effect that
 * sets a fresh `{}` or `[]` into state named in its own dependency list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOTS = ["client/src/components/concord", "client/src/pages", "client/src/components/space", "client/src/components"];

function sourceFiles(): string[] {
  const out = new Set<string>();
  for (const dir of ROOTS) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
      out.add(join(dir, e));
    }
  }
  return [...out];
}

/** The text of each `useEffect(...)` call, parentheses balanced. */
function effectCalls(src: string): string[] {
  const calls: string[] = [];
  let at = src.indexOf("useEffect(");
  while (at !== -1) {
    let depth = 0, i = at + "useEffect".length;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    calls.push(src.slice(at, i + 1));
    at = src.indexOf("useEffect(", i);
  }
  return calls;
}

/** State an effect resets to a fresh {} or [] while listing it as a dependency. */
function selfResets(effect: string): string[] {
  const deps = effect.match(/\[([^\[\]]*)\]\s*\)$/)?.[1]?.split(",").map((d) => d.trim()) ?? [];
  const hits: string[] = [];
  for (const m of effect.matchAll(/\bset([A-Z]\w*)\(\s*(\{\s*\}|\[\s*\])\s*\)/g)) {
    const name = m[1][0].toLowerCase() + m[1].slice(1);
    if (deps.includes(name)) hits.push(name);
  }
  return hits;
}

describe("an effect never resets state it depends on to a brand-new {} or []", () => {
  it("the detector catches the pattern, and leaves an identity-keeping reset alone", () => {
    expect(selfResets("useEffect(() => { if (!open) { setDirty({}); return; } }, [open, dirty])")).toEqual(["dirty"]);
    expect(selfResets("useEffect(() => { if (!open) { setDirty((d) => (Object.keys(d).length ? {} : d)); } }, [open, dirty])")).toEqual([]);
    expect(selfResets("useEffect(() => { setItems([]); }, [open])")).toEqual([]);
  });

  it("no component does it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const effect of effectCalls(src)) for (const name of selfResets(effect)) offenders.push(`${file}: ${name}`);
    }
    expect(offenders).toEqual([]);
  });
});
