/**
 * "Couldn't update role — grant chain head unknown", every time, for the owner
 * of their own community.
 *
 * `doSetAdmin` read the live governance fold (`state.heads`) but left `state`
 * out of its `useCallback` deps, while `doRemove` — the callback directly above
 * it, in the same file, reading the same fold — listed it. So the promote path
 * closed over the fold as it stood on the render that memoized it. Every dep it
 * DID list is referentially stable (`setCommunity` is a useState setter, `toast`
 * is module-level), so that render was the mount: an empty edition map, no
 * heads. `foldArrived` was false forever and the owner could never grant a role.
 *
 * WHY A SOURCE TEST. This repo has no ESLint — no config, no script, nothing in
 * CI — so `react-hooks/exhaustive-deps` has never run here. (The lone
 * eslint-disable comment in useConcordGovernance.ts is addressed to a linter
 * that does not exist.) There is also no @testing-library/react, so a render
 * test that observes the stale closure is not available either. That leaves
 * reading the source, which is enough for this specific class: the fold is the
 * one binding whose whole nature is to ARRIVE LATE, so capturing it stale is
 * always a bug and never a choice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOTS = ["client/src/components/concord", "client/src/pages", "client/src/components/space"];

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of ROOTS) {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!/\.tsx?$/.test(e) || /\.test\.tsx?$/.test(e)) continue;
      out.push(join(dir, e));
    }
  }
  return out;
}

/**
 * Comments and string/template literals replaced by spaces, so bracket matching
 * below cannot be thrown off by a brace inside a string — while every index
 * still lines up with the original text.
 */
function blank(src: string): string {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    const wipe = (end: number) => { for (let j = i; j < end && j < src.length; j++) if (out[j] !== "\n") out[j] = " "; i = end; };
    if (c === "/" && next === "/") { let j = i; while (j < src.length && src[j] !== "\n") j++; wipe(j); continue; }
    if (c === "/" && next === "*") { const j = src.indexOf("*/", i + 2); wipe(j === -1 ? src.length : j + 2); continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      wipe(j); continue;
    }
    i++;
  }
  return out.join("");
}

/** The bindings a file destructures off useConcordGovernance, under their local names. */
function foldBindings(src: string): string[] {
  const m = src.match(/const\s*\{([^}]*)\}\s*=\s*useConcordGovernance\(/);
  if (!m) return [];
  return m[1].split(",").map((part) => {
    const p = part.trim();
    if (!p) return "";
    // `state: govState` binds locally as govState; plain `roster` binds as roster.
    return (p.includes(":") ? p.split(":")[1] : p).trim();
  }).filter(Boolean);
}

interface MemoCall { hook: string; body: string; deps: string; line: number }

/** Every useCallback/useMemo/useEffect call, split into its body and its dep array. */
function memoCalls(src: string): MemoCall[] {
  const blanked = blank(src);
  const calls: MemoCall[] = [];
  const re = /\buse(Callback|Memo|Effect)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked))) {
    const open = m.index + m[0].length - 1;
    let depth = 0, close = -1;
    for (let i = open; i < blanked.length; i++) {
      const c = blanked[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) continue;
    // The dep array is the last top-level [...] before the closing paren.
    let depsOpen = -1;
    for (let i = close - 1; i > open; i--) {
      const c = blanked[i];
      if (c === ")" || c === "]" || c === "}") { let d = 0; for (; i > open; i--) { const k = blanked[i]; if (k === ")" || k === "]" || k === "}") d++; else if (k === "(" || k === "[" || k === "{") { d--; if (d === 0) break; } } if (blanked[i] === "[") { depsOpen = i; break; } continue; }
      if (c === "[") { depsOpen = i; break; }
    }
    if (depsOpen === -1) continue;
    calls.push({
      hook: `use${m[1]}`,
      body: src.slice(open + 1, depsOpen),
      deps: src.slice(depsOpen, close),
      line: src.slice(0, m.index).split("\n").length,
    });
    re.lastIndex = close;
  }
  return calls;
}

describe("a memoized callback may not capture the governance fold stale", () => {
  // Consumers only — the hook's own definition file names itself and has no
  // destructuring to check.
  const files = sourceFiles().filter((f) =>
    !f.endsWith("useConcordGovernance.ts") && readFileSync(f, "utf8").includes("useConcordGovernance("));

  it("finds the consumers it is meant to be guarding", () => {
    // A guard that silently matches nothing passes forever. This is the check
    // that the file list and the destructuring regex still work at all.
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some((f) => f.endsWith("ConcordMembers.tsx"))).toBe(true);
  });

  it("actually parses the hook calls, rather than passing on an empty scan", () => {
    // The failure mode of a source scanner is silence: a parser that returns
    // nothing reports no violations and looks green forever. ConcordChat is the
    // hard case — hundreds of lines of JSX, braces and brackets inside strings —
    // so if the blanking or the bracket matching breaks, its count collapses here
    // before the violation check can quietly stop working.
    const counts = Object.fromEntries(
      files.map((f) => [f.split("/").pop(), memoCalls(readFileSync(f, "utf8")).length]),
    );
    expect(counts["ConcordMembers.tsx"]).toBeGreaterThanOrEqual(2);
    expect(counts["ConcordChat.tsx"]).toBeGreaterThanOrEqual(20);
    for (const [name, n] of Object.entries(counts)) expect(n, `${name} parsed 0 hook calls`).toBeGreaterThan(0);
  });

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const bindings = foldBindings(src);

    it(`${file.split("/").pop()} lists every fold value it reads`, () => {
      expect(bindings.length).toBeGreaterThan(0);
      const violations: string[] = [];
      for (const call of memoCalls(src)) {
        for (const b of bindings) {
          const used = new RegExp(`\\b${b}\\b`).test(call.body);
          const declared = new RegExp(`\\b${b}\\b`).test(call.deps);
          if (used && !declared) {
            violations.push(`${file}:${call.line} ${call.hook} reads \`${b}\` but does not depend on it`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
