// The share card: the image shown when the site's link is pasted into a chat
// or a post (client/public/og-image.png, named by og:image in client/index.html).
//
// It is the landing's hero as a picture: the mark, "The next phase of the
// internet." with the warm dot, and the soft glow, on the light background.
// No wordmark: the link's title, shown beside the image, carries the name.
//
// Text is drawn as outlines (satori) from the Geist package, then rasterised
// (sharp), the same way server/og-cards.ts draws its cards: no system fonts.
//
//   node scripts/gen-share-card.mjs        # writes client/public/og-image.png
import satori from "satori";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CARD = { width: 1200, height: 630 };
const INK = "#0d0f12", GROUND = "#f7f7f8", EMBER = "#ff5b2e";
const root = resolve(fileURLToPath(import.meta.url), "../..");
const font = (weight) => ({
  name: "Geist", weight, style: "normal",
  data: readFileSync(resolve(root, `node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff`)),
});

const h = (type, props, ...children) => {
  const kids = children.filter((c) => c !== null && c !== undefined);
  return { type, props: kids.length === 0 ? { ...props } : { ...props, children: kids.length === 1 ? kids[0] : kids } };
};

// The mark: an open ring (the head), the warm dot at its opening, two eyes.
const mark = (size) => h("svg", { width: size, height: size, viewBox: "0 0 100 100" },
  h("path", { d: "M78.98 42.24 A30 30 0 1 1 57.76 21.02", fill: "none", stroke: INK, "stroke-width": 9, "stroke-linecap": "round" }),
  h("circle", { cx: 71.2, cy: 28.8, r: 6.5, fill: EMBER }),
  h("ellipse", { cx: 42, cy: 51, rx: 3.6, ry: 5.2, fill: INK }),
  h("ellipse", { cx: 58, cy: 51, rx: 3.6, ry: 5.2, fill: INK }),
);

const SIZE = 104; // headline, px
// The dot sits on the baseline like a full stop: the line box ends about 0.19em below it.
const line = (text, dot) => h("div", { style: { display: "flex", alignItems: "flex-end" } },
  h("div", { style: { display: "flex" } }, text),
  dot ? h("div", { style: { width: SIZE * 0.15, height: SIZE * 0.15, borderRadius: "50%", background: EMBER, marginLeft: SIZE * 0.015, marginBottom: SIZE * 0.2 } }) : null,
);

const card = h("div", {
  style: {
    width: CARD.width, height: CARD.height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    backgroundColor: GROUND,
    backgroundImage: "radial-gradient(ellipse 60% 55% at 50% 64%, rgba(255, 91, 46, 0.13), rgba(255, 91, 46, 0) 70%), radial-gradient(ellipse 60% 50% at 20% 4%, rgba(96, 128, 255, 0.10), rgba(96, 128, 255, 0) 70%)",
    fontFamily: "Geist", color: INK,
  },
},
  mark(100),
  h("div", { style: { marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", fontSize: SIZE, fontWeight: 600, lineHeight: 1.04, letterSpacing: "-0.045em" } },
    line("The next phase", false),
    line("of the internet", true),
  ),
);

export async function renderShareCard() {
  const svg = await satori(card, { width: CARD.width, height: CARD.height, fonts: [font(600)] });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const png = await renderShareCard();
  const out = resolve(root, "client/public/og-image.png");
  writeFileSync(out, png);
  console.log(`wrote ${out} (${CARD.width}x${CARD.height}, ${Math.round(png.length / 1024)} KB)`);
}
