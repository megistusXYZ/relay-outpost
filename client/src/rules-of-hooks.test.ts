/**
 * React's rule of hooks, the one that crashes: no hook after a return that can
 * happen first. A component that returns early on one render and not the next
 * calls a different number of hooks, and React throws "Rendered fewer hooks
 * than expected" (#300) — the page goes down. This repo has no ESLint, so this
 * scan is the only thing that checks it.
 *
 * First caught: Discover's guest wall returned before its useEffect; a crash
 * report from a guest on /help (React #300, 2026-10-03) is that flip.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = import.meta.dirname;
const HOOK = /\buse[A-Z]\w*\s*\(|\buse\$\s*\(/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : tsxFiles(p);
    return /\.tsx$/.test(e.name) && !/ 2\./.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Hooks called after an early return, in top-level components (2-space bodies). */
function hooksAfterReturn(src: string): string[] {
  const L = src.split("\n");
  const found: string[] = [];
  for (let i = 0; i < L.length; i++) {
    const head = L[i].match(/^(?:export (?:default )?)?function ([A-Z]\w*)\s*[(<]/)
      ?? L[i].match(/^(?:export )?const ([A-Z]\w*)\s*=\s*(?:memo\(|forwardRef\()?\s*(?:function\s*\w*\s*)?\(/);
    if (!head) continue;
    let early = -1, inIf = false;
    for (let k = i + 1; k < L.length; k++) {
      const l = L[k];
      if (/^\}/.test(l)) break;
      if (/^  if \(.*\)\s*return\b/.test(l) && early < 0) early = k;
      if (/^  if \(.*\)\s*\{\s*$/.test(l) || /^  \} else (if \(.*\) )?\{\s*$/.test(l)) inIf = true;
      else if (/^  \}\s*$/.test(l)) inIf = false;
      if (inIf && /^    return\b/.test(l) && early < 0) early = k;
      if (early >= 0 && k > early && /^  \S/.test(l) && !/^  \/\//.test(l) && !/^  return\b/.test(l) && HOOK.test(l)) {
        found.push(`${head[1]}: line ${k + 1} (after the return at line ${early + 1})`);
        break;
      }
    }
  }
  return found;
}

describe("no hook after an early return", () => {
  it("the scan itself catches the mistake", () => {
    const bad = ["export default function Page() {", "  const a = useA();", "  if (!a) {", "    return null;", "  }", "  useEffect(() => {}, []);", "  return null;", "}"].join("\n");
    expect(hooksAfterReturn(bad)).toEqual(["Page: line 6 (after the return at line 4)"]);
    const good = ["export default function Page() {", "  const a = useA();", "  useEffect(() => {}, []);", "  if (!a) return null;", "  return null;", "}"].join("\n");
    expect(hooksAfterReturn(good)).toEqual([]);
  });

  it("no component in the app calls a hook after it may already have returned", () => {
    const all = tsxFiles(ROOT).flatMap((f) => hooksAfterReturn(readFileSync(f, "utf8")).map((x) => `${path.relative(ROOT, f)} — ${x}`));
    expect(all).toEqual([]);
  });
});
