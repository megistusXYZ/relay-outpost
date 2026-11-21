// /favicon.ico (client/public/favicon.ico), made from the mark in client/public/logo.svg.
//
// The page names its icons with <link rel="icon">, but plenty of things never read the page:
// feed readers, chat apps, some browsers' history and bookmark lists, and uptime tools all ask
// for /favicon.ico by habit. Without the file that address fell through to the app's HTML page,
// so they were handed a web page where they asked for an icon.
//
// One .ico holding the mark at 16, 32 and 48 pixels, each stored as a PNG (every browser since
// IE 9 reads that), so a small tab icon is drawn from a 16px render and not shrunk from a large one.
//
//   node scripts/gen-favicon.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SIZES = [16, 32, 48];
const root = resolve(fileURLToPath(import.meta.url), "../..");
const SOURCE = resolve(root, "client/public/logo.svg");
const OUT = resolve(root, "client/public/favicon.ico");

/** An .ico: a 6-byte header, one 16-byte entry per image, then the images themselves. */
export function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = []; let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svg = readFileSync(SOURCE);
  const images = [];
  for (const size of SIZES) images.push({ size, png: await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer() });
  writeFileSync(OUT, ico(images));
  console.log(`favicon.ico: ${SIZES.join(", ")} px, ${ico(images).length} bytes`);
}
