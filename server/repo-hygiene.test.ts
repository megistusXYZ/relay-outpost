/**
 * Tripwire: nothing machine- or infrastructure-specific lands in the public
 * repo — home paths, LAN addresses, local hostnames, credential paths, and the
 * names of private infrastructure.
 *
 * Two halves: the detector proves it CAN fail on the things we care about,
 * then the real scan over every tracked text file must find nothing. The
 * private names are checked by hash, so these tests use made-up names.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findPersonalDetails, isScannable, termHash, PRIVATE_TERM_HASHES } from "./repo-hygiene";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("the detector", () => {
  it("catches a home-directory path, a LAN address, a local hostname and cluster credential paths", () => {
    const found = findPersonalDetails([
      { path: "scripts/qa/x.cjs", text: 'require("/Users/someone/.npm/_npx/abc/node_modules/playwright")' },
      { path: "docs/qa.md", text: "open http://192.168.100.200:5003 then http://my-macbook-pro.local:5006" },
      { path: "scripts/ship.sh", text: "export KUBECONFIG=/Users/someone/.kube/clusters/x.kubeconfig" },
    ]);
    expect(found.map((f) => f.rule).sort()).toEqual([
      "cluster credentials", "home-directory path", "home-directory path",
      "LAN address", "local hostname",
    ].sort());
    expect(found.find((f) => f.rule === "LAN address")?.line).toBe(1);
  });

  describe("private names, checked by hash", () => {
    const terms = ["moonbase-ops", "kestrel", "vault.example.net", "git.example.net/secret-team", "203.0.113.77"];
    const opts = { privateTermHashes: terms.map(termHash) };

    it("catches each name as a path segment, a word in a longer name, a host and a host path", () => {
      const found = findPersonalDetails([
        { path: "Dockerfile", text: "# chart lives in ~/work/moonbase-ops/charts" },
        { path: "deploy.sh", text: "export CTX=acme-KESTREL-cluster" },
        { path: "ci.yml", text: "image: vault.example.net/team/app:latest" },
        { path: "README.md", text: "mirror at https://git.example.net/secret-team/app." },
        { path: "notes.md", text: "ingress answers on 203.0.113.77, see above" },
      ], opts);
      expect(found.map((f) => `${f.path}:${f.line}`)).toEqual([
        "Dockerfile:1", "deploy.sh:1", "ci.yml:1", "README.md:1", "notes.md:1",
      ]);
      expect(found.every((f) => f.rule === "private infrastructure")).toBe(true);
    });

    it("leaves near misses alone: another project on the same host, a longer word, a different address", () => {
      expect(findPersonalDetails([
        { path: "a.ts", text: 'href: "https://git.example.net/public-project"' },
        { path: "b.ts", text: "const kestrels = 3; // moonbase-opsy" },
        { path: "c.ts", text: "203.0.113.7 and 203.0.113.770" },
      ], opts)).toEqual([]);
    });

    it("keeps the real list as hashes only, so this file never names what it guards", () => {
      expect(PRIVATE_TERM_HASHES.length).toBeGreaterThan(0);
      for (const h of PRIVATE_TERM_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("leaves the SSRF guard alone: naming private ranges is its job", () => {
    expect(findPersonalDetails([{ path: "server/net-safety.ts", text: "inCidr(v4, '192.168.0.0', 16)" }])).toEqual([]);
    // Elsewhere the same text is a finding.
    expect(findPersonalDetails([{ path: "server/other.ts", text: "const lan = '192.168.0.0';" }])).toHaveLength(1);
  });

  it("does not mistake localStorage or localhost for a .local hostname", () => {
    expect(findPersonalDetails([{ path: "a.ts", text: "window.localStorage; http://localhost:5002; a.localhost" }])).toEqual([]);
  });
});

describe("the public repo", () => {
  it("has no machine- or infrastructure-specific details in any tracked text file", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
    const files = tracked.filter(isScannable).map((p) => ({ path: p, text: readFileSync(path.join(ROOT, p), "utf8") }));
    expect(files.length).toBeGreaterThan(500);
    const found = findPersonalDetails(files);
    expect(found.map((f) => `${f.path}:${f.line} [${f.rule}] ${f.text}`)).toEqual([]);
  });
});
