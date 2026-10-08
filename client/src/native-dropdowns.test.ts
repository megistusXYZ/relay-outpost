/**
 * Native dropdowns get their full size in Safari (WebKit sweep, 2026-10-07).
 * WebKit draws a <select> with its built-in look at its own height and ignores
 * min-height, so the app's 44px dropdowns came out ~22px on an iPhone — under
 * the tap-size floor (ops-member-inbox-e2e, WebKit only). Drawn with our own
 * look (one chevron), the size classes apply in every browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");

function rule(selector: string): string {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`);
  const m = CSS.match(re);
  if (!m) throw new Error(`no rule for ${selector}`);
  return m[2];
}

describe("native dropdowns", () => {
  it("drop the browser's built-in look, so their height applies in Safari", () => {
    const body = rule("select:not([multiple]):not([size])");
    expect(body).toMatch(/-webkit-appearance:\s*none/);
    expect(body).toMatch(/(^|\n)\s*appearance:\s*none/);
  });
  it("still show they open: a chevron, with room for it, in light and dark", () => {
    const light = rule("select:not([multiple]):not([size])");
    expect(light).toMatch(/background-image:\s*url\("data:image\/svg\+xml/);
    expect(light).toMatch(/padding-right:\s*2rem/);
    const dark = rule(".dark select:not([multiple]):not([size])");
    expect(dark).toMatch(/background-image:\s*url\("data:image\/svg\+xml/);
  });
});
