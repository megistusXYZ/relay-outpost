/**
 * iOS launch images (owner, 2026-10-01: "fix the mobile loading blank screen").
 *
 * Measured on the iPhone 17 simulator in light appearance: iOS showed the
 * LIGHT launch image (white canvas, purple mark) for ~0.8 s, then the app's
 * dark splash. iOS picks a launch image by the phone's light/dark setting; the
 * app's theme is its own setting (dark unless chosen otherwise). So there is
 * one image per screen, in the brand canvas, for both appearances — the first
 * frame of the splash, so the hand-off can't be seen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { SCREENS, fileName, linkTag, CANVAS } from "../../../scripts/gen-launch-images.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const html = readFileSync(path.join(root, "client/index.html"), "utf8");
const links = html.split("\n").filter((l) => l.includes('rel="apple-touch-startup-image"')).map((l) => l.trim());

describe("iOS launch images", () => {
  it("one per iPhone screen, exactly the generator's list, and every file exists", () => {
    expect(links).toEqual(SCREENS.map(([w, h, s]) => linkTag(w, h, s)));
    for (const [w, h, s] of SCREENS) {
      expect(existsSync(path.join(root, "client/public/splash", fileName(w, h, s)))).toBe(true);
    }
  });

  it("never picks by the phone's light/dark setting", () => {
    for (const l of links) expect(l).not.toMatch(/prefers-color-scheme/);
  });

  it("covers the iPhone Air (420×912@3x), which the first set missed", () => {
    expect(SCREENS).toContainEqual([420, 912, 3]);
  });

  it("is the first frame of the splash: the brand canvas with the mark centred", async () => {
    expect(html).toMatch(/#ro-splash\{[^}]*background:#0a0a0a/);
    expect(CANVAS).toBe("#0a0a0a");
    const [w, h, s] = [402, 874, 3];
    const img = sharp(path.join(root, "client/public/splash", fileName(w, h, s)));
    const { width, height } = await img.metadata();
    expect([width, height]).toEqual([w * s, h * s]);
    const { data } = await img.raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [data[(y * w * s + x) * 3], data[(y * w * s + x) * 3 + 1], data[(y * w * s + x) * 3 + 2]];
    expect(px(0, 0)).toEqual([10, 10, 10]); // corner: the canvas
    // The mark is 54 CSS px, centred, drawn on a 24-unit grid; its left loop
    // is solid at (3.5, 13.5) of that grid (the exact centre is the gap
    // between the two halves).
    const m = 54 * s, u = m / 24;
    const [cr, cg, cb] = px(Math.round((w * s) / 2 - m / 2 + 3.5 * u), Math.round((h * s) / 2 - m / 2 + 13.5 * u));
    expect(Math.min(cr, cg, cb)).toBeGreaterThan(200); // the mark, white
  });
});
