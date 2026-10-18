/**
 * Fingerprints of the inline scripts a build serves, for the production CSP.
 * The page needs a dozen small inline scripts before its code loads (theme,
 * splash, first-screen prefetch, route preload). Allowing them by SHA-256
 * instead of 'unsafe-inline' means an injected script can't run. Read from the
 * built pages at startup, so the policy always matches the build being served.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** 'sha256-…' sources for every inline <script> (no src) in a page. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(m[1])) continue;
    out.push(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
  }
  return out;
}

/** Distinct fingerprints across the .html pages at the top of a build folder. */
export function scriptHashesForDir(dir: string): string[] {
  const all = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".html")) continue;
    for (const h of inlineScriptHashes(fs.readFileSync(path.join(dir, name), "utf8"))) all.add(h);
  }
  return [...all];
}
