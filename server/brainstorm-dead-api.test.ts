/**
 * Brainstorm's profile search API (brainstorm.world/api/search/profiles/meili/…)
 * has answered its web app's HTML instead of data since 2026-09-28, and the
 * health check (service-health.ts) has reported it "answering with nothing"
 * ever since. Owner, 2026-10-23: remove the calls; re-add if it comes back.
 * Nothing in the app or the server asks it, or the routes built on it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") files(p, out); continue; }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/ \d+\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the dead Brainstorm search API", () => {
  it("is asked by nothing", () => {
    const dead = ["/api/search/profiles/meili", "/api/brainstorm/profile/", "/api/brainstorm/profiles-bulk", "/api/brainstorm/search", "/api/brainstorm/discover"];
    const hits: string[] = [];
    for (const f of ["client/src", "server", "shared"].flatMap((d) => files(path.join(ROOT, d)))) {
      // The health check keeps watching it, so we see if it comes back.
      if (path.relative(ROOT, f) === "server/service-health-targets.ts") continue;
      const src = readFileSync(f, "utf8");
      for (const d of dead) if (src.includes(d)) hits.push(`${path.relative(ROOT, f)} → ${d}`);
    }
    expect(hits).toEqual([]);
  });
});
