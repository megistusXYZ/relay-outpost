/**
 * Tap targets and readable text, held (owner, 2026-10-07: "best standards
 * across all devices"). The phone audit (ship/a11y-audit.cjs) found the same
 * two text patterns behind most unreadable lines: 7–9px type, and the muted
 * grey at 40% or less, which can't reach 4.5:1 on white. Existing uses are
 * counted; new ones fail. When a sweep removes some, lower the number —
 * a baseline above the real count is a check that can't fail (CLAUDE.md).
 *
 * And the helper that gives a small control a fingertip-sized target.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = import.meta.dirname;
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(p);
  }
  return out;
}
const ALL = sources(ROOT).map((p) => readFileSync(p, "utf8")).join("\n");
const count = (re: RegExp) => (ALL.match(re) || []).length;

// Ratchet: today's counts (2026-10-07). Lower them as screens are fixed.
const TINY_TYPE = 378;
const FAINT_GREY = 585;

describe("readable text", () => {
  it("no new 7–9px text", () => {
    expect(count(/text-\[(7|8|9)px\]/g)).toBeLessThanOrEqual(TINY_TYPE);
  });
  it("no new muted grey at 40% or less", () => {
    expect(count(/text-muted-foreground\/(10|20|30|40)\b/g)).toBeLessThanOrEqual(FAINT_GREY);
  });
});

describe("tap targets", () => {
  it("a small control can get a 44x44 target without being drawn bigger", () => {
    const css = readFileSync(path.join(ROOT, "index.css"), "utf8");
    expect(css).toMatch(/\.hit-area::after\s*\{[^}]*top:\s*min\(0px,\s*calc\(\(100% - 44px\) \/ 2\)\)/);
  });
  it("a post's actions, the header's buttons and settings segments use it", () => {
    const post = readFileSync(path.join(ROOT, "components/NostrPost.tsx"), "utf8");
    for (const id of ["button-reply-", "button-repost-", "button-like-", "button-zap-", "button-post-menu-"]) {
      const at = post.indexOf(`data-testid={\`${id}\${event.id}\`}`);
      expect(at, id).toBeGreaterThan(0);
      expect(post.slice(post.lastIndexOf("<Button", at), at), id).toMatch(/hit-area/);
    }
  });
});
