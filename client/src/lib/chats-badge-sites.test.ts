/**
 * Every Chats badge goes through chatsBadge(), so private mode masks all of
 * them. Four surfaces used to add the count up themselves; the chats list got
 * masked and the bottom-nav badge beside it kept counting.
 *
 * Source-reading rather than rendering, like hover-reach.test.ts: the surfaces
 * pull in the whole app shell, and what matters is that none of them can grow
 * its own sum back. Prove it can fail: call concordChatsBadgeCount( in any
 * component and watch this go red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "client", "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => f.slice(f.indexOf("client/src"));

/** Blank out comments so prose about the old sum doesn't count as the sum. */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);
}

// Where the group part is defined, and the one place allowed to add it up.
const ALLOWED = new Set(["client/src/lib/concord/concord-mentions.ts", "client/src/lib/chats-badge.ts"]);

describe("Chats badge sites", () => {
  it("no surface adds up the Chats badge itself: all of them go through chatsBadge()", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !ALLOWED.has(rel(f)))
      .filter((f) => /\bconcordChatsBadgeCount\s*\(/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
