/**
 * What a first-time visitor downloads before the first posts: Home and
 * everything it imports statically. Pieces nobody needs until they act — a
 * dialog they open, a composer, an invite card, the sign-in options — load
 * when they're first used instead.
 *
 * Measured 2026-10-04 on a production build: 107 files / 988 KB of script
 * before the first post; on a slow phone connection the first posts waited
 * ~6.7 s for it. Some of it wasn't even used: NostrPost imported the mention
 * search, the mention textarea and the emoji picker and never rendered them.
 *
 * Walks the real import graph (static imports only — import() is a lazy
 * load), so moving a piece lazy is what turns this green, and an eager import
 * slipping back turns it red.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname);
const RE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const e of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}
function staticGraph(root: string): Set<string> {
  const seen = new Set([path.join(SRC, root)]);
  const queue = [...seen];
  while (queue.length) {
    const f = queue.shift()!;
    for (const m of fs.readFileSync(f, "utf8").matchAll(RE)) {
      const r = resolve(f, m[1]);
      if (r && !seen.has(r)) { seen.add(r); queue.push(r); }
    }
  }
  return new Set([...seen].map((f) => path.relative(SRC, f)));
}

describe("a first-time visitor's first load", () => {
  const home = staticGraph("pages/Home.tsx");
  it.each([
    "components/ZapDialog.tsx",
    "components/ReportDialog.tsx",
    "components/PrivateReplyDialog.tsx",
    "components/AddToFeaturedDialog.tsx",
    "components/MentionSearch.tsx",
    "components/MentionHighlightTextarea.tsx",
    "components/ComposeEmojiPicker.tsx",
    "components/GroupInviteCard.tsx",
  ])("doesn't include %s until it's used", (mod) => {
    expect(home.has(mod)).toBe(false);
  });

  it("the guest welcome loads the sign-in options only when they're shown", () => {
    expect(staticGraph("components/GalaxyWarpOverlay.tsx").has("components/LoginOptions.tsx")).toBe(false);
  });
});
