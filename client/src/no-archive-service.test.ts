/**
 * The outside archive (charts, network counts, post search by count) stopped
 * its service; the owner had every use of it removed on 2026-11-21. Nothing in
 * the app, the server or the shared code may ask it for anything again, or
 * keep a route, a link or a label for it. A browser check covers what people
 * see; this is the backstop for what they cannot.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SELF = path.resolve(import.meta.dirname, "no-archive-service.test.ts");
const SKIP = new Set(["node_modules", "dist", ".git"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) files(full, out);
    // The owner's sync copies ("Name 2.tsx") are not part of the app.
    else if (/\.(ts|tsx|css|html|json|md)$/.test(name) && !/ \d+\.[a-z]+$/.test(name)) out.push(full);
  }
  return out;
}

describe("the outside archive service is gone", () => {
  const all = ["client/src", "client/index.html", "client/public", "server", "shared"].flatMap((p) => {
    const full = path.join(ROOT, p);
    return statSync(full).isDirectory() ? files(full) : [full];
  }).filter((f) => f !== SELF);

  it("looked at the app, the server and the shared code", () => {
    expect(all.length).toBeGreaterThan(500);
    expect(all.some((f) => f.endsWith("server/routes.ts"))).toBe(true);
    expect(all.some((f) => f.endsWith("pages/Home.tsx"))).toBe(true);
  });

  it("nothing names its hosts, its routes or its client", () => {
    const hits: string[] = [];
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      if (/nostrarchives|\/api\/archives|nostr-archives/i.test(text)) hits.push(path.relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });

  it("nothing on screen credits it", () => {
    const hits: string[] = [];
    for (const f of all.filter((x) => /\.tsx$/.test(x))) {
      const text = readFileSync(f, "utf8");
      if (/powered by<\/span>\s*(<[^>]+>\s*)*Archives|Charts by Archives|from Archives|live from archives/i.test(text)) hits.push(path.relative(ROOT, f));
    }
    expect(hits).toEqual([]);
  });
});
