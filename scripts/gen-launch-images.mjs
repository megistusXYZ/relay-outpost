// iOS launch images for the home-screen app (client/public/splash/*.png).
//
// iOS shows one of these from the tap on the icon until the page first paints.
// Each is the first frame of the inline splash in client/index.html — the same
// 54px mark on the same 132px glow, centred on the brand canvas — so the
// hand-off can't be seen.
//
// One image per screen, for BOTH appearances. iOS picks a launch image by the
// phone's light/dark setting, but the app's theme is its own (dark unless the
// person chose otherwise), so a per-appearance image showed a white launch
// screen to a dark app on every light-mode phone (measured on the simulator,
// 2026-10-01): white for ~0.8 s, then the dark splash. The launch screen is the
// brand, the same for everyone; the splash after it wears the person's theme.
//
//   node scripts/gen-launch-images.mjs        # writes the PNGs and prints the <link>s
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// CSS points and scale of every iPhone screen since the SE (2nd gen).
export const SCREENS = [
  [375, 667, 2], // SE 2/3, 8
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [390, 844, 3], // 12, 13, 14, 16e
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [414, 736, 3], // 8 Plus
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [420, 912, 3], // Air
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
];

export const CANVAS = "#0a0a0a";
const MARK = "#ffffff";
const GLOW = "#8b5cf6";
const MARK_PX = 54;
const GLOW_PX = 132;
const PATHS = [
  "M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z",
  "M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z",
];

export function fileName(w, h, s) {
  return `splash-${w}x${h}@${s}x.png`;
}

/** The <link> for one screen: no colour-scheme clause, on purpose. */
export function linkTag(w, h, s) {
  return `<link rel="apple-touch-startup-image" href="/splash/${fileName(w, h, s)}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${s}) and (orientation: portrait)" />`;
}

function svg(w, h, s) {
  const W = w * s, H = h * s, cx = W / 2, cy = H / 2;
  const m = MARK_PX * s, g = GLOW_PX * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="g"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.42"/><stop offset="0.7" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>
    <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${8 * s}"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${CANVAS}"/>
  <circle cx="${cx}" cy="${cy}" r="${g / 2}" fill="url(#g)" filter="url(#b)"/>
  <g transform="translate(${cx - m / 2} ${cy - m / 2}) scale(${m / 24})" fill="${MARK}">
    <path d="${PATHS[0]}"/><path d="${PATHS[1]}"/>
  </g>
</svg>`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = resolve("client/public/splash");
  mkdirSync(out, { recursive: true });
  for (const [w, h, s] of SCREENS) {
    const png = await sharp(Buffer.from(svg(w, h, s))).png({ compressionLevel: 9, palette: true }).toBuffer();
    writeFileSync(resolve(out, fileName(w, h, s)), png);
  }
  console.log(SCREENS.map(([w, h, s]) => "    " + linkTag(w, h, s)).join("\n"));
}
