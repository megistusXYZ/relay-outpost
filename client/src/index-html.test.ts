/**
 * client/index.html under production's CSP, which has script-src-attr 'none':
 * inline event handlers (onload="" and friends) never run there. The webfonts
 * link switched itself on with one, so no webfont ever loaded in production
 * (measured 2026-09-29: the link stuck at media="print", zero font faces, the
 * whole app in system fallbacks). Dev has no such CSP, so only this catches it.
 */
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import path from "path";

const HTML = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8");

describe("index.html", () => {
  it("has no inline event handlers (production's CSP blocks them)", () => {
    const withoutScripts = HTML.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    expect(withoutScripts.match(/<[^>]*\son[a-z]+=/gi) ?? []).toEqual([]);
  });

  describe("the fonts", () => {
    // Owner, 2026-11-18: the app serves its own fonts. The old async link to
    // Google Fonts (and the inline-handler lesson that came with it, above) is
    // gone; the browser check own-fonts-e2e watches the network for the same.
    it("never asks a font CDN for anything", () => {
      expect(HTML).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    });

    it("preloads Geist from our own origin so the first paint has it", () => {
      const dom = new JSDOM(HTML.replace(/<script\b[\s\S]*?<\/script>/g, ""));
      const link = dom.window.document.querySelector('link[rel="preload"][as="font"]') as HTMLLinkElement | null;
      expect(link?.getAttribute("href")).toBe("/fonts/Geist-Variable.woff2");
      expect(link?.hasAttribute("crossorigin")).toBe(true);
    });

    it("the check can fail: the old link would be caught", () => {
      expect(HTML + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">').toMatch(/fonts\.googleapis\.com/);
    });
  });
});
