/**
 * A person is rendered the way they look to YOU (owner, 2026-10-12: custom
 * names and pictures must hold everywhere). Surfaces that read a profile's
 * raw `display_name`/`name` or `picture` bypass your name and photo for them.
 * This counts those reads in people-facing screens and ratchets down: a new
 * one fails; lowering BASELINE when you fix some is the point.
 *
 * Prove it can fail: add `content.display_name || content.name` to any page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "client", "src");
/** Your own identity (custom names don't apply) and the places that must show the real name on purpose. */
const SKIP = [
  /components\/Header\.tsx$/, /app-sidebar\.tsx$/, /OrbitMenu\.tsx$/, /DesktopStoriesRail\.tsx$/, /YouAvatarIcon\.tsx$/, /pages\/Account\.tsx$/,
  /MediaComments\.tsx$/, /CreatePost\.tsx$/, /PetnameDialog\.tsx$/, /EditProfile/, /ProfileEdit/, /lib\//, /\.test\.tsx?$/, /\/ 2\./, / \d\./,
  /ImpersonationBadge/, /identity-banner/, /impersonation/,
];
const RAW_NAME = /\b(display_name\s*\|\|\s*[\w.?]*name|\.name\s*\|\|\s*[\w.?]*display_name)\b/;
const RAW_PICTURE = /\?\.picture\b|\.picture\s*(\}|,|\)|\]|;|$)/;

function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) files(f, out);
    else if (/\.tsx$/.test(n)) out.push(f);
  }
  return out;
}

export function rawPersonReads(): string[] {
  const out: string[] = [];
  for (const f of files(SRC)) {
    if (SKIP.some((re) => re.test(f))) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (RAW_NAME.test(line) || RAW_PICTURE.test(line)) out.push(`${relative(SRC, f)}:${i + 1}`);
    });
  }
  return out;
}

/** Lower this as surfaces move to lib/person-look.ts; never raise it. */
const BASELINE = 205;

describe("people are rendered as they look to you", () => {
  it("no new raw profile name/picture read reaches a people-facing screen", () => {
    const reads = rawPersonReads();
    expect(reads.length, `raw reads: ${reads.length}\n${reads.slice(0, 20).join("\n")}`).toBeLessThanOrEqual(BASELINE);
  });
});
