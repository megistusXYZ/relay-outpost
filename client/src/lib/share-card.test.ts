/**
 * The share card (client/public/og-image.png): the picture shown when the
 * site's link is pasted into a chat or a post. Until 2026-11-18 it was still
 * the old galaxy with the old logo, long after the app's look changed. It is
 * drawn by scripts/gen-share-card.mjs: the landing's hero as a picture, light,
 * with the mark and the headline and no wordmark.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const FILE = resolve(ROOT, "client/public/og-image.png");
const HTML = readFileSync(resolve(ROOT, "client/index.html"), "utf8");
const meta = (prop: string) => new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`).exec(HTML)?.[1];

describe("the share card", () => {
  it("is the standard 1200 by 630, and the page says so", async () => {
    const { width, height } = await sharp(FILE).metadata();
    expect([width, height]).toEqual([1200, 630]);
    expect([meta("og:image:width"), meta("og:image:height")]).toEqual(["1200", "630"]);
    expect(meta("twitter:card")).toBe("summary_large_image");
  });

  it("is the light card with ink in the middle, not the old dark galaxy", async () => {
    const { data, info } = await sharp(FILE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
    // The ground near a corner is the landing's near-white…
    for (const [x, y] of [[1150, 40], [40, 590], [1150, 590]]) {
      const [r, g, b] = at(x, y);
      expect(Math.min(r, g, b), `ground at ${x},${y}`).toBeGreaterThan(225);
    }
    // …and the headline's ink crosses the middle band.
    let ink = 0;
    for (let x = 250; x < 950; x += 2) { const [r, g, b] = at(x, 330); if (r < 60 && g < 60 && b < 60) ink++; }
    expect(ink, "ink pixels across the headline").toBeGreaterThan(40);
  });

  // The same picture, give or take a rasteriser's rounding on another machine.
  // A changed letter or a moved mark shifts thousands of values a long way;
  // rounding shifts a few by a little.
  const differs = (a: Buffer, b: Buffer) => {
    if (a.length !== b.length) return true;
    let far = 0, total = 0;
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); total += d; if (d > 48) far++; }
    return far > 300 || total / a.length > 1;
  };

  it("matches what the generator draws today", async () => {
    // A changed script with a stale image is the launch-image mistake again.
    const { renderShareCard } = await import(/* @vite-ignore */ resolve(ROOT, "scripts/gen-share-card.mjs"));
    const fresh = await sharp(await renderShareCard()).raw().toBuffer({ resolveWithObject: true });
    const onDisk = await sharp(FILE).raw().toBuffer();
    expect(differs(onDisk, fresh.data), "the image on disk is not what the script draws: run node scripts/gen-share-card.mjs").toBe(false);

    // The comparison can fail: one letter-sized patch of ink where there was none is caught.
    const stale = Buffer.from(fresh.data);
    const ch = fresh.info.channels;
    for (let y = 40; y < 80; y++) for (let x = 1100; x < 1130; x++) for (let c = 0; c < 3; c++) stale[(y * fresh.info.width + x) * ch + c] = 12;
    expect(differs(stale, fresh.data)).toBe(true);
  });
});
