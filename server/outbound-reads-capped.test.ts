import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * A reply from a site someone else chose is read with a cap, never whole.
 *
 * `safeFetch` decides WHERE the server may go; it does not limit how much
 * comes back. `response.json()`, `.text()`, `.arrayBuffer()` and `.blob()`
 * buffer everything, after undici has inflated it: a few kilobytes of gzip
 * from an attacker's lightning address or article URL became gigabytes in
 * memory, enough to take down the one server process. `readBodyCapped`
 * (safe-fetch.ts) counts the inflated bytes and stops at its cap.
 *
 * This reads the server's source for every response that came out of
 * `safeFetch` (or a `fetcher` that stands in for it) and fails on a whole-body
 * read of it. It is the backstop; safe-fetch.test.ts proves the cap holds.
 */
const SERVER = path.resolve(__dirname);
const files = fs
  .readdirSync(SERVER, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !/ \d+\.ts$/.test(f));

const ASSIGN = /\b([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:safeFetch|fetcher)\s*\(/g;
/** Lines a safeFetch result can still be read on: up to the name's next `= await`. */
const REACH = 80;

/** Names bound to a safeFetch (or injected fetcher) response in one file. */
function responseNames(src: string): string[] {
  return [...new Set([...src.matchAll(ASSIGN)].map((m) => m[1]))];
}

function wholeReads(file: string): string[] {
  const src = fs.readFileSync(path.join(SERVER, file), "utf8");
  if (!/\bsafeFetch\b/.test(src)) return [];
  const lines = src.split("\n");
  const out = new Set<string>();
  lines.forEach((line, start) => {
    for (const m of line.matchAll(ASSIGN)) {
      const name = m[1].replace(/\$/g, "\\$");
      const read = new RegExp(`\\b${name}\\.(json|text|arrayBuffer|blob)\\s*\\(`);
      const rebound = new RegExp(`\\b${name}\\s*=\\s*await\\b`);
      for (let i = start; i < Math.min(lines.length, start + REACH); i++) {
        if (i > start && rebound.test(lines[i])) break;
        if (!lines[i].trim().startsWith("//") && read.test(lines[i])) out.add(`${file}:${i + 1}  ${lines[i].trim()}`);
      }
    }
  });
  return [...out];
}

describe("replies from sites someone else chose", () => {
  it("the scan finds the server's safeFetch callers (or this test proves nothing)", () => {
    const callers = files.filter((f) => responseNames(fs.readFileSync(path.join(SERVER, f), "utf8")).length > 0);
    expect(callers).toEqual(expect.arrayContaining(["routes.ts", "nip86-proxy.ts"]));
  });

  it("are never read whole: every body goes through readBodyCapped", () => {
    expect(files.flatMap(wholeReads)).toEqual([]);
  });
});
