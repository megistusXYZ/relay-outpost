/**
 * The share cards the server draws for a post, a profile and an invite: the
 * pictures shown when one of those links is pasted into a chat. They kept the
 * retired violet look (a dark violet ground, a violet bar along the top, the
 * old fonts) after the app and the site's own card changed. They are now the
 * site card's look: a light ground, ink, the mark with its Ember dot, Geist.
 *
 * Each card is drawn here from fixed data (no network) and its pixels are read.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderThreadCard, renderProfileCard, renderInviteCard } from "./og-cards";

type Px = [number, number, number];
async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Px => { const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  return { info, at, data };
}
/** The retired violet, as the client's guard defines it: hue 230–305 with real saturation. */
function isOldViolet([r, g, b]: Px): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 40) return false; // greys, and the faint glows
  const l = (max + min) / 510, s = d / 255 / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 230 && h <= 305 && s > 0.35;
}

const cards: [string, () => Promise<Buffer>][] = [
  ["a post", () => renderThreadCard({ name: "Ines Vale", avatarDataUri: null, excerpt: "The night market moved to the square. Sixty stalls, open from six, lanterns up on Thursday." })],
  ["a profile", () => renderProfileCard({ name: "Ines Vale", nip05: "ines@harbour.test", aboutExcerpt: "Runs the night market. Writes about bread, maps and small harbours.", followingCount: 212, avatarDataUri: null })],
  ["an invite", () => renderInviteCard()],
];

describe("the share cards the server draws", () => {
  for (const [what, render] of cards) {
    it(`${what}: the standard 1200 by 630, on the light ground with ink on it`, async () => {
      const { info, at } = await pixels(await render());
      expect([info.width, info.height]).toEqual([1200, 630]);
      for (const [x, y] of [[8, 8], [1190, 8], [8, 620], [1190, 620]]) {
        expect(Math.min(...at(x, y)), `ground at ${x},${y}`).toBeGreaterThan(225);
      }
      let ink = 0;
      for (let y = 40; y < 600; y += 3) for (let x = 40; x < 1160; x += 3) { const p = at(x, y); if (Math.max(...p) < 70) ink++; }
      expect(ink, "dark ink pixels on the card").toBeGreaterThan(400);
    });

    it(`${what}: no retired violet anywhere, and no bar along the top`, async () => {
      const { info, at } = await pixels(await render());
      let violet = 0;
      for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) if (isOldViolet(at(x, y))) violet++;
      expect(violet, "violet pixels").toBe(0);
      for (let x = 20; x < 1180; x += 20) expect(Math.min(...at(x, 3)), `top edge at ${x}`).toBeGreaterThan(225);
    });

    it(`${what}: the mark's Ember dot is on it`, async () => {
      const { info, at } = await pixels(await render());
      // Every pixel: on a post or a profile the mark is small, at the foot of the card.
      let ember = 0;
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const [r, g, b] = at(x, y); if (r > 220 && g > 60 && g < 120 && b < 80) ember++; }
      expect(ember, "Ember pixels").toBeGreaterThan(10);
    });
  }

  it("a post with a picture shows the picture in the right-hand panel, and its words beside it", async () => {
    // A flat test picture, one colour, so the panel is easy to find.
    const photo = `data:image/png;base64,${(await sharp({ create: { width: 468, height: 630, channels: 3, background: "#3c5a6e" } }).png().toBuffer()).toString("base64")}`;
    const { at } = await pixels(await renderThreadCard({ name: "Ines Vale", avatarDataUri: null, excerpt: "First lanterns up. The square looks like a different town at night.", imageDataUri: photo }));
    const isPhoto = ([r, g, b]: Px) => Math.abs(r - 0x3c) < 6 && Math.abs(g - 0x5a) < 6 && Math.abs(b - 0x6e) < 6;
    for (const [x, y] of [[740, 20], [960, 315], [1190, 610]]) expect(isPhoto(at(x, y)), `picture at ${x},${y}: ${at(x, y)}`).toBe(true);
    expect(isPhoto(at(700, 315)), "the words' side stays the ground").toBe(false);
    let ink = 0;
    for (let y = 40; y < 600; y += 3) for (let x = 40; x < 720; x += 3) if (Math.max(...at(x, y)) < 70) ink++;
    expect(ink, "words on the left").toBeGreaterThan(300);
  });

  it("the detector can fail: it finds the old violet", () => {
    expect(isOldViolet([124, 77, 255])).toBe(true);
    expect(isOldViolet([255, 91, 46])).toBe(false);
    expect(isOldViolet([13, 15, 18])).toBe(false);
  });

  it("draws with the app's own face and none of the retired palette", () => {
    const src = readFileSync(resolve(process.cwd(), "server/og-cards.ts"), "utf8");
    expect(src).not.toMatch(/#7c4dff|#0e0c16|#a89fc4|#cfc5ec|violet/i);
    expect(src).not.toMatch(/Space Grotesk|"Inter"/);
    expect(src).toMatch(/Geist/);
  });
});
