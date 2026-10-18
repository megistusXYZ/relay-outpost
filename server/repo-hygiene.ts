/**
 * The repo is public (MIT). Machine- and infrastructure-specific details —
 * home-directory paths, LAN addresses, local hostnames, credential paths and
 * the names of private infrastructure — never belong in a commit.
 * This is the detector the tripwire test runs over every tracked text file.
 */
import { createHash } from "node:crypto";

export interface PersonalDetail {
  path: string;
  line: number;
  /** What was found, trimmed. */
  text: string;
  rule: string;
}

const RULES: Array<{ rule: string; re: RegExp }> = [
  { rule: "home-directory path", re: /\/Users\/[A-Za-z]/ },
  { rule: "session scratch path", re: /\/private\/tmp\/claude/ },
  { rule: "LAN address", re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/ },
  { rule: "local hostname", re: /\b[a-z0-9][a-z0-9-]*\.local\b(?!\w)/ },
  { rule: "cluster credentials", re: /kubeconfig|\.kube\//i },
];

/**
 * Names of private infrastructure, stored as SHA-256 of the lower-cased name
 * so this public file never spells out what it guards. A name can be one word,
 * a host, a host with a path, or an address. Add one with termHash().
 */
export const PRIVATE_TERM_HASHES: readonly string[] = [
  "8c59d07b9c60977b7eac696906516ae433049541e081e45539c2efdb9567d115",
  "ee2365fdf1b1bea314c7111d487df1ea6e5e052ccb3e68643cd053774b7701db",
  "7b35dad0d253b02846108ba4890c1cc92dd438ae9cda0de0a892b0a6f83b4e48",
  "463185b60eb202325dc922a06b2a512c3ba4d4d685bdfad72958b62c641d97c8",
  "27426e2ce2df97cc20c4ee5711eb5b044b244b7846e9983dd364917d667cf71f",
];

export function termHash(term: string): string {
  return createHash("sha256").update(term.toLowerCase()).digest("hex");
}

/**
 * Every piece of a line a private name could be: each run of name-like
 * characters, each run of its "/" segments (a path segment, a host, a host
 * with a path), and each word inside it split on . - _ and /.
 */
function candidateTerms(line: string): Set<string> {
  const out = new Set<string>();
  for (const raw of line.toLowerCase().split(/[^a-z0-9._\/-]+/)) {
    const token = raw.replace(/^[./_-]+|[./_-]+$/g, "");
    if (!token) continue;
    out.add(token);
    const segs = token.split("/").filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j <= segs.length; j++) out.add(segs.slice(i, j).join("/"));
    }
    for (const w of token.split(/[._\/-]+/)) if (w) out.add(w);
  }
  return out;
}

/**
 * Files where a rule's pattern is the point — guards that name private ranges
 * so they can refuse them, and a vendor host. Each entry says why.
 */
const ALLOW: Array<{ path: RegExp; rule: string }> = [
  { path: /^server\/net-safety(\.test)?\.ts$/, rule: "LAN address" },
  { path: /^server\/routes\.ts$/, rule: "LAN address" },
  // Junk-relay detection refuses private-network relays; its fixtures name some.
  { path: /^client\/src\/lib\/relay-junk\.test\.ts$/, rule: "LAN address" },
  { path: /^client\/src\/lib\/relay-junk\.test\.ts$/, rule: "local hostname" },
  // Call services on someone's own network are refused; its fixtures name some.
  { path: /^client\/src\/lib\/concord\/concord-av-brokers\.test\.ts$/, rule: "LAN address" },
  { path: /^client\/src\/lib\/concord\/concord-av-brokers\.test\.ts$/, rule: "local hostname" },
  // Replit's (retired) package proxy host, a vendor name, in the lockfile fix-up.
  { path: /^\.github\/workflows\/ci\.yml$/, rule: "local hostname" },
];

export function findPersonalDetails(
  files: Array<{ path: string; text: string }>,
  opts: { privateTermHashes?: readonly string[] } = {},
): PersonalDetail[] {
  const privateHashes = new Set(opts.privateTermHashes ?? PRIVATE_TERM_HASHES);
  const seen = new Map<string, boolean>();
  const isPrivate = (term: string) => {
    let hit = seen.get(term);
    if (hit === undefined) seen.set(term, (hit = privateHashes.has(termHash(term))));
    return hit;
  };
  const out: PersonalDetail[] = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const term of candidateTerms(lines[i])) {
        if (isPrivate(term)) {
          out.push({ path, line: i + 1, text: lines[i].trim().slice(0, 120), rule: "private infrastructure" });
          break;
        }
      }
    }
    for (const { rule, re } of RULES) {
      if (ALLOW.some((a) => a.rule === rule && a.path.test(path))) continue;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) out.push({ path, line: i + 1, text: lines[i].trim().slice(0, 120), rule });
      }
    }
  }
  return out;
}

/** Tracked text files worth scanning (binaries and the lockfile are not). */
export const SCANNED_EXTENSIONS = /\.(ts|tsx|js|cjs|mjs|json|md|yml|yaml|html|css|sh|txt|env\.example)$/;
export function isScannable(path: string): boolean {
  if (path === "package-lock.json") return false;
  if (/^server\/repo-hygiene(\.test)?\.ts$/.test(path)) return false; // the rules themselves
  return SCANNED_EXTENSIONS.test(path);
}
