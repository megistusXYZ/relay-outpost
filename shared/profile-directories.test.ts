/**
 * Profile directories: relays that keep a copy of everyone's profile, follow
 * list and relay list, so people can be found wherever they post.
 *
 * Measured on the wire 2026-10-23 (seven well-known accounts, read-only):
 * user.kindpag.es answered EMPTY for five of seven, so "no relay list" from
 * it was a false answer; purplepag.es missed some profiles; profiles.nostr1.com
 * and relay.nos.social held them. And none of the directories keep app data
 * (kind 30078: settings, bookmarks, read marks), starter packs or badges, so
 * asking them for those was wasted. The list is stated once, in
 * shared/profile-directories.ts; this test keeps it that way.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { PROFILE_DIRECTORIES, LIST_DIRECTORIES } from "./profile-directories";

const ROOT = path.resolve(__dirname, "..");
const DIRECTORY_HOSTS = ["purplepag.es", "user.kindpag.es", "profiles.nostr1.com", "relay.nos.social"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") sourceFiles(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name) || / \d+\.tsx?$/.test(name)) continue; // tests; sync duplicates
    out.push(p);
  }
  return out;
}
const files = ["client/src", "server", "shared"].flatMap((d) => sourceFiles(path.join(ROOT, d)));
const rel = (p: string) => path.relative(ROOT, p);

describe("profile directories", () => {
  it("are named in one place: no other file writes a directory's address", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === "shared/profile-directories.ts") continue;
      const src = readFileSync(f, "utf8");
      for (const host of DIRECTORY_HOSTS) {
        if (src.includes(`"wss://${host}"`) || src.includes(`'wss://${host}'`)) offenders.push(`${rel(f)} → ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never include the directory that answered empty for most people", () => {
    expect(PROFILE_DIRECTORIES).not.toContain("wss://user.kindpag.es");
    expect(LIST_DIRECTORIES).not.toContain("wss://user.kindpag.es");
  });

  it("the ones that keep personal lists are among the profile directories", () => {
    for (const d of LIST_DIRECTORIES) expect(PROFILE_DIRECTORIES).toContain(d);
  });

  it("app data, starter packs and badges are not asked of directories (they don't keep them)", () => {
    const appData = ["client/src/lib/featured.ts", "client/src/lib/nip78-settings.ts", "client/src/lib/read-state-sync.ts", "client/src/lib/news-bookmark-sync.ts", "client/src/lib/follow-packs.ts"];
    for (const f of appData) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/PROFILE_DIRECTORIES|LIST_DIRECTORIES/);
      for (const host of DIRECTORY_HOSTS) expect(src, `${f} → ${host}`).not.toContain(`wss://${host}"`);
    }
  });
});
