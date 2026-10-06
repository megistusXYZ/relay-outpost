/**
 * Every post draws itself. No list of posts may hand drawing to the browser's
 * lazy renderer (`content-visibility: auto`): on iPhone WebKit a lazily-drawn
 * row scrolling into view during a fling stays blank, and its placeholder
 * height moves the page under the reader when the real height lands.
 *
 * #333 took the rule off `.feed-post-item` (profiles, threads). Home's phone
 * feed kept its own copy on `.cv-list > *`, and the owner's 2026-10-05
 * recording shows the same blank cards and jumps there. Reproduced in the
 * iOS Simulator with the scroll-restore debug overlay: "undrawn on screen"
 * 1 frame (2 rows), "moved under reader" 2× (761px), after five flings.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("posts always draw", () => {
  it("no stylesheet gives feed rows content-visibility: auto", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "index.css"), "utf8");
    // Each rule block whose declarations include content-visibility: auto.
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /content-visibility\s*:\s*auto/.test(body))
      .map(([, sel]) => sel.trim().replace(/\s+/g, " "));
    expect(blocks).toEqual([]);
  });

  it("no feed list opts into lazy drawing", () => {
    const src = path.resolve(__dirname);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) && /\bcv-list\b|contentVisibility\s*:\s*["']auto/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(hits).toEqual([]);
  });
});
