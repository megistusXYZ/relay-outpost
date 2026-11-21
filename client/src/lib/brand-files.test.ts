/**
 * The brand's files outside the app's own code: the icon things ask for by
 * habit, the page the ingress shows while the app restarts, and the install
 * card. Each drifted from the brand once because nothing checked it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const pub = (f: string) => resolve(ROOT, "client/public", f);
const shell = readFileSync(resolve(ROOT, "client/index.html"), "utf8");

describe("/favicon.ico", () => {
  // Feed readers, chat apps and bookmark lists ask for this address without reading the page.
  // With no file there, it fell through to the app's HTML page.
  const ico = readFileSync(pub("favicon.ico"));
  const count = ico.readUInt16LE(4);
  const entries = Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    return { size: ico.readUInt8(at) || 256, bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });

  it("is a real icon file", () => {
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("holds the mark at 16, 32 and 48 pixels, each a PNG of that size", () => {
    expect(entries.map((e) => e.size)).toEqual([16, 32, 48]);
    for (const e of entries) {
      const png = ico.subarray(e.offset, e.offset + e.bytes);
      expect(png.toString("ascii", 1, 4)).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([e.size, e.size]);
    }
  });

  it("is named by the page, ahead of the larger icons", () => {
    expect(shell).toMatch(/<link rel="icon" href="\/favicon\.ico" sizes="48x48" \/>\s*<link rel="icon" type="image\/svg\+xml" href="\/logo\.svg" \/>/);
  });
});

describe("every icon the page and the install card name is in the build", () => {
  it("the page's icons", () => {
    const hrefs = [...shell.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const h of hrefs) expect(existsSync(pub(h.slice(1))), h).toBe(true);
  });

  it("the install card's icons and screenshot", () => {
    const m = JSON.parse(readFileSync(pub("manifest.json"), "utf8"));
    for (const i of [...m.icons, ...m.screenshots]) expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
  });
});

describe("the page shown while the app restarts", () => {
  const page = readFileSync(pub("maintenance.html"), "utf8");

  it("carries none of the old look: no violet, no Oxanium, no boxed wordmark", () => {
    expect(page).not.toMatch(/#7c3aed|#5e2db4|#b38bf9|#16101d/i);
    expect(page).not.toMatch(/Oxanium/i);
    expect(page).not.toMatch(/class='mark'|class='pill'/);
  });

  it("is Relay at work: the ring and the Ember dot, turning, on the app's own backgrounds", () => {
    expect(page).toContain("M78.98 42.24A30 30 0 1 1 57.76 21.02");
    expect(page).toMatch(/aria-label='Relay, working'/);
    expect(page).toMatch(/--bg:#0a0c10/);
    expect(page).toMatch(/prefers-color-scheme:light\)\{:root\{--bg:#f7f7f8/);
    expect(page).toMatch(/--ember:#ff6a3d/);
  });

  it("holds still for someone who asked for less motion", () => {
    expect(page).toMatch(/prefers-reduced-motion:reduce\)\{svg\{animation:none\}\}/);
  });
});
