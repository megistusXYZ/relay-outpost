/**
 * Tripwire: nothing machine- or infrastructure-specific lands in the public
 * repo. Asked for by the owner 2026-10-01 after a day of local QA that used
 * the Mac's hostname, LAN address and cluster paths — all of which stayed in
 * local notes, and must keep staying there.
 *
 * Two halves: the detector proves it CAN fail on the things we care about,
 * then the real scan over every tracked text file must find nothing.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findPersonalDetails, isScannable } from "./repo-hygiene";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("the detector", () => {
  it("catches a home-directory path, a LAN address, a local hostname and cluster credential paths", () => {
    const found = findPersonalDetails([
      { path: "scripts/qa/x.cjs", text: 'require("/Users/someone/.npm/_npx/abc/node_modules/playwright")' },
      { path: "docs/qa.md", text: "open http://192.168.1.51:5003 then http://my-macbook-pro.local:5006" },
      { path: "scripts/ship.sh", text: "export KUBECONFIG=/Users/someone/.kube/clusters/x.kubeconfig" },
    ]);
    expect(found.map((f) => f.rule).sort()).toEqual([
      "cluster credentials", "home-directory path", "home-directory path",
      "LAN address", "local hostname",
    ].sort());
    expect(found.find((f) => f.rule === "LAN address")?.line).toBe(1);
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
