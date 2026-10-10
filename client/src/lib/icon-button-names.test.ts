/**
 * An icon-only button says what it does (owner, 2026-10-10, from the
 * first-use review). A newcomer learned the composer's seven icons by
 * clicking them — one opened the operating system's file picker on a shared
 * screen — and clicked the bug beside the moon. The label is the signifier;
 * a hover tooltip is the least it can carry, and the accessible name is what
 * a screen reader and a phone have.
 *
 * Source-reading because the repo has no ESLint and no axe run. Two bars:
 *  - the surfaces the review named are CLEAN: no unnamed `size="icon"`
 *    Button there, ever;
 *  - the rest of the app is a RATCHET: the count may fall, never rise.
 *    Lower BASELINE when you lower the count (a baseline above the real
 *    count is a check that can't fail — see CLAUDE.md).
 *
 * Prove it can fail: drop the aria-label from the composer's poll button.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

/** Unnamed icon buttons across the app on 2026-10-10, after the composer and hub were named (was 105). */
const BASELINE = 101;

const CLEAN = [
  "client/src/components/CreatePost.tsx",
  "client/src/components/ComposeEmojiPicker.tsx",
  "client/src/components/OrbitMenu.tsx",
  "client/src/components/DesktopStoriesRail.tsx",
  "client/src/components/KeyBackupActions.tsx",
];

/**
 * The attributes of each <Button …> tag. Not a regex to the first ">": an
 * `onClick={() => …}` carries one, and a scanner that stopped there missed
 * every label written after the handler.
 */
function buttonTags(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf("<Button");
  while (i !== -1) {
    const next = src[i + 7];
    if (next === " " || next === "\n" || next === ">" || next === "/") {
      let depth = 0, quote = "", j = i + 7;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) { if (c === quote && src[j - 1] !== "\\") quote = ""; continue; }
        if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      out.push(src.slice(i + 7, j));
    }
    i = src.indexOf("<Button", i + 7);
  }
  return out;
}

function unnamedIconButtons(src: string): number {
  let n = 0;
  for (const attrs of buttonTags(src)) {
    if (/size="icon"/.test(attrs) && !/aria-label|aria-labelledby|title=/.test(attrs)) n++;
  }
  return n;
}

describe("icon-only buttons have a name", () => {
  const files = globSync("client/src/**/*.tsx");
  const counts = new Map(files.map((f) => [f, unnamedIconButtons(readFileSync(f, "utf8"))]));

  it("the scanner finds icon buttons at all", () => {
    let icons = 0;
    for (const f of files) icons += (readFileSync(f, "utf8").match(/size="icon"/g) || []).length;
    expect(icons).toBeGreaterThan(100);
  });

  for (const f of CLEAN) {
    it(`${f.replace("client/src/", "")} names every icon button`, () => {
      expect(counts.get(f) ?? 0).toBe(0);
    });
  }

  it("the rest of the app never grows new unnamed icon buttons (ratchet)", () => {
    let total = 0;
    for (const [, n] of counts) total += n;
    expect(total).toBeLessThanOrEqual(BASELINE);
  });
});
