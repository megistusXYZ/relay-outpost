/**
 * The repo is public (MIT). Machine- and infrastructure-specific details —
 * home-directory paths, LAN addresses, local hostnames, cluster credentials
 * paths, the private ops repo — belong in local notes, never in a commit.
 * This is the detector the tripwire test runs over every tracked text file.
 */

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
  // Not a rule: the NAME of the private ops repo. It is already in the public
  // history (a comment in .gitlab-ci.yml, a test), and a name reveals nothing;
  // paths and credentials into it are what the rules above catch.
];

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
  { path: /^(\.github\/workflows\/ci\.yml|\.agents\/memory\/build-and-deploy\.md)$/, rule: "local hostname" },
];

export function findPersonalDetails(files: Array<{ path: string; text: string }>): PersonalDetail[] {
  const out: PersonalDetail[] = [];
  for (const { path, text } of files) {
    const lines = text.split("\n");
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
