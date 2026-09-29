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

  describe("the webfonts", () => {
    function page() {
      // jsdom has no CSP and would happily run an inline handler, so drop them
      // as production's browser effectively does.
      const asInProduction = HTML
        .replace(/<script type="module"[^>]*><\/script>/g, "")
        .replace(/\son[a-z]+="[^"]*"/gi, "");
      const dom = new JSDOM(asInProduction, {
        runScripts: "dangerously",
        beforeParse(w: any) { w.WebSocket = undefined; },
      });
      const w = dom.window as any;
      const link = () => w.document.querySelector('link[href^="https://fonts.googleapis.com/css2"]:not(noscript link)') as HTMLLinkElement;
      return { w, link };
    }

    it("load without blocking the first paint", () => {
      expect(page().link().media).toBe("print");
    });

    it("apply once their stylesheet has loaded", () => {
      const { w, link } = page();
      link().dispatchEvent(new w.Event("load"));
      expect(link().media).toBe("all");
    });

    it("keep a plain link for browsers without JavaScript", () => {
      expect(HTML).toMatch(/<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2/);
    });
  });
});
