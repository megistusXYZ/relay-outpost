/**
 * Every server fetch of a URL someone else chose goes through safeFetch
 * (server/safe-fetch.ts), which checks the host on every redirect hop and pins
 * the connection to the address it checked. The patterns that skipped that —
 * fetch following redirects on its own, hand-written redirect loops that
 * re-check the name but not the address, and the feed library fetching by
 * itself — are kept out by scanning the source.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const serverFiles = execFileSync("git", ["ls-files", "server/*.ts"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((p) => p && !p.endsWith(".test.ts"));

function hits(re: RegExp, except: string[] = []): string[] {
  const out: string[] = [];
  for (const p of serverFiles) {
    if (except.includes(p)) continue;
    readFileSync(path.join(ROOT, p), "utf8").split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${p}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("outbound fetches of user-chosen URLs", () => {
  it("never let fetch follow redirects by itself", () => {
    expect(hits(/redirect:\s*["']follow["']/)).toEqual([]);
  });

  it("never hand-roll a redirect loop outside safeFetch", () => {
    expect(hits(/redirect:\s*["']manual["']/, ["server/safe-fetch.ts"])).toEqual([]);
  });

  it("never let the feed library fetch a URL itself", () => {
    expect(hits(/\.parseURL\(/)).toEqual([]);
  });

  it("use safeFetch in the modules that only fetch user-chosen URLs", () => {
    for (const p of ["server/og-cards.ts", "server/hls-liveness.ts"]) {
      expect(hits(/(?<![\w.])fetch\(/).filter((h) => h.startsWith(p + ":"))).toEqual([]);
    }
  });
});
