/**
 * The brand's files outside the app's own code: the icon things ask for by
 * habit, the page the ingress shows while the app restarts, and the install
 * card. Each drifted from the brand once because nothing checked it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
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

describe("the install card", () => {
  const m = JSON.parse(readFileSync(pub("manifest.json"), "utf8"));
  const size = (src: string) => { const b = readFileSync(pub(src.slice(1))); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), png: b.toString("ascii", 1, 4) === "PNG" }; };

  // The name under the icon is the whole name (owner, 2026-11-21: "Keep Relay Outpost", chosen over the
  // shorter "Outpost" knowing that at thirteen characters some phones may shorten it with an ellipsis).
  it("is named Relay Outpost everywhere a phone or a browser shows a name", () => {
    expect(m.name).toBe("Relay Outpost");
    expect(m.short_name).toBe("Relay Outpost");
    expect(shell).toMatch(/<meta name="apple-mobile-web-app-title" content="Relay Outpost" \/>/);
    expect(shell).toMatch(/<meta name="application-name" content="Relay Outpost" \/>/);
  });

  // A phone's install prompt shows pictures of the app only if the manifest has phone-shaped ones.
  // It had one wide picture, and that was the share image, not the app.
  it("shows the app on a phone: at least two upright pictures, all the same size", () => {
    const narrow = m.screenshots.filter((s: { form_factor?: string }) => s.form_factor === "narrow");
    expect(narrow.length).toBeGreaterThanOrEqual(2);
    expect(new Set(narrow.map((s: { sizes: string }) => s.sizes)).size).toBe(1);
    for (const s of narrow) {
      const real = size(s.src);
      expect(real.png, s.src).toBe(true);
      expect(`${real.w}x${real.h}`, s.src).toBe(s.sizes);
      expect(real.h, s.src).toBeGreaterThan(real.w);
      expect(real.w, s.src).toBeGreaterThanOrEqual(320);
      expect(real.h / real.w, s.src).toBeLessThanOrEqual(2.3);
    }
  });

  it("shows the app on a desktop: a wide picture of the app itself", () => {
    const wide = m.screenshots.filter((s: { form_factor?: string }) => s.form_factor === "wide");
    expect(wide.length).toBeGreaterThanOrEqual(1);
    for (const s of wide) {
      const real = size(s.src);
      expect(`${real.w}x${real.h}`, s.src).toBe(s.sizes);
      expect(real.w, s.src).toBeGreaterThan(real.h);
      expect(real.w / real.h, s.src).toBeLessThanOrEqual(2.3);
      expect(s.src, "a picture of the app, not the share image").not.toBe("/og-image.png");
    }
  });

  it("each picture says what it shows, in plain words, and none is heavy", () => {
    for (const s of m.screenshots) {
      expect(s.type).toBe("image/png");
      expect(s.label.length, s.src).toBeGreaterThan(10);
      expect(s.label, s.src).not.toMatch(/[—–]/);
      expect(readFileSync(pub(s.src.slice(1))).length, s.src).toBeLessThan(700_000);
    }
  });
});

describe("the old space pictures", () => {
  // The first look was a space theme: a moonscape behind Tools, a cockpit behind Send feedback, line art
  // behind Invite a friend, a rubber "Public Beta" stamp, an astronaut for onboarding. The new look is
  // ink on a calm surface, so they were taken out of the screens and out of the build.
  const GONE = ["images/tools-bg.webp", "images/feedback-bg.jpg", "images/invite-bg.webp", "images/landing/galaxy-bg.webp", "images/landing/public-beta-stamp.webp", "images/landing/public-beta-stamp-sm.webp", "images/onboarding/welcome-astronaut.webp", "images/onboarding/welcome-astronaut-sm.webp"];

  it("are not in the build", () => {
    for (const f of GONE) expect(existsSync(pub(f)), f).toBe(false);
  });

  it("are not named anywhere in the app's code", () => {
    const names = /tools-bg|feedback-bg|invite-bg|galaxy-bg|public-beta-stamp|welcome-astronaut/;
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const full = resolve(dir, f);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(tsx?|css)$/.test(f) || /\.test\.ts$/.test(f) || / \d+\./.test(f)) continue;
        if (names.test(readFileSync(full, "utf8"))) named.push(full.slice(ROOT.length + 1));
      }
    };
    walk(resolve(ROOT, "client/src"));
    expect(named).toEqual([]);
    expect(names.test(shell)).toBe(false);
  });
});
