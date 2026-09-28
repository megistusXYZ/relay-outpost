/**
 * Who may build a follow list (kind 3). Publishing one REPLACES the user's
 * whole list, so a list built on an empty or not-yet-loaded base wipes every
 * follow they have (the follow-list wipe bug). The safe way to follow someone
 * is the shared hook, hooks/use-follow-action.ts, which loads the authoritative
 * list behind the wipe guard first. Every hand-rolled copy of that logic is a
 * place a future fix to the shared path silently fails to reach.
 *
 * Source-reading, like chats-badge-sites.test.ts: the question is structural
 * ("does anything else build one?"), which rendering can't answer. Reads of
 * other people's lists (kinds: [KIND_FOLLOW_LIST], getReplaceable) don't match;
 * only an event template (`kind: KIND_FOLLOW_LIST`) does.
 * Prove it can fail: add `kind: KIND_FOLLOW_LIST` to any component.
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
const stripComments = (src: string) => {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);
};

const ALLOWED = new Set([
  // The one way to follow someone.
  "client/src/hooks/use-follow-action.ts",
  // Not "follow one more person": the very first list at sign-up (there is no
  // existing list yet), and restoring a chosen snapshot of a lost list.
  "client/src/components/CreateAccountFlow.tsx",
  "client/src/pages/RecoverFollows.tsx",
  // KNOWN COPIES still to move onto the shared hook (each is guarded today).
  // Take a file off this list when it moves; never add one.
  "client/src/components/InviteAcceptCard.tsx",
  "client/src/pages/Search.tsx",
  "client/src/pages/Profile.tsx",
]);

describe("follow-list builders", () => {
  it("nothing builds a follow list except the shared follow hook and the known special cases", () => {
    const builders = sourceFiles(SRC)
      .filter((f) => /\bkind:\s*KIND_FOLLOW_LIST\b/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel)
      .filter((f) => !ALLOWED.has(f));
    expect(builders).toEqual([]);
  });
});
