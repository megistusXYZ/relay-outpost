/**
 * Sideways-scrolling rows (tab bars, chip rows, rails) must not wiggle up and
 * down on a phone. `overflow-x: auto` quietly makes the other axis scrollable
 * too (CSS computes a `visible` y to `auto`), so any child a pixel taller than
 * the row (tabs use -mb-px to sit on the underline) gives it a vertical
 * scroll. Measured on Settings, 2026-09-29: a 46 px bar with 47 px of
 * content. One rule in index.css covers every such row, present and future.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");

describe("sideways-scrolling rows", () => {
  const rule = css.match(/\.overflow-x-auto:not\(\.overflow-y-auto\):not\(\.overflow-auto\)\s*\{([^}]*)\}/);

  it("never scroll vertically", () => {
    expect(rule?.[1]).toMatch(/overflow-y:\s*hidden/);
  });

  it("keep a sideways swipe inside the row (not the browser's back gesture)", () => {
    expect(rule?.[1]).toMatch(/overscroll-behavior-x:\s*contain/);
  });

  it("Settings keeps its chosen tab in view by scrolling sideways only", () => {
    // scrollIntoView({ block: "nearest" }) nudged the row (and the page)
    // vertically each time the section changed.
    const settings = readFileSync(path.resolve(import.meta.dirname, "pages/Settings.tsx"), "utf8");
    const nav = settings.slice(settings.indexOf("function SettingsNav("));
    expect(nav.slice(0, 1500)).not.toContain("scrollIntoView(");
    expect(nav.slice(0, 1500)).toContain("row.scrollBy({ left:");
  });

  it("no row opts back into vertical scrolling by accident", () => {
    // Anything that really scrolls both ways says so with overflow-auto /
    // overflow-y-auto, which the rule leaves alone. None do today.
    const both = [...allComponents().matchAll(/overflow-x-auto[^"`]*overflow-y-(auto|scroll)/g)];
    expect(both).toEqual([]);
  });
});

/** Every component and page, as one string. */
function allComponents(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(path.resolve(import.meta.dirname));
  return out.join("\n");
}
