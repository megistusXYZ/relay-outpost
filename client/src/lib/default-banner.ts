/**
 * The banner for someone without one, or whose banner won't load (owner,
 * 2026-10-07; default-banner.test.ts): "custom for our solution, subtle and
 * comfortable, not overbearing… very good in both light and dark". Chosen from
 * drawn options: Aurora + Terrain — a soft glow in the brand's family (hue 262
 * and its neighbours) with faint map-like contours, the ground an outpost
 * stands on.
 *
 * Drawn here as an SVG, so it never fails to load and costs no download. The
 * shape comes from the person's key, so one person keeps one look while a
 * list of people varies; light and dark are separate versions of the same
 * drawing.
 */

const W = 1200;
const H = 400;

/** FNV-1a: a pubkey's hex alphabet is low-entropy, so not the usual h*31+c. */
function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = {
  light: { ground: "hsl(262 22% 96%)", line: "hsl(262 32% 58%)", line2: "hsl(230 30% 62%)", glowSat: 55, glowLight: 80, glowAlpha: 0.55 },
  dark: { ground: "hsl(258 30% 9%)", line: "hsl(262 55% 72%)", line2: "hsl(225 45% 68%)", glowSat: 45, glowLight: 32, glowAlpha: 0.5 },
};

function glow(r: () => number, p: (typeof PALETTE)["light"]): string {
  const hues = [262, 238, 285].map((h) => h + Math.floor((r() - 0.5) * 16));
  let s = `<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter></defs>`;
  s += `<g filter="url(#g)">`;
  for (const h of hues) {
    const cx = (0.15 + r() * 0.7) * W, cy = (0.2 + r() * 0.6) * H;
    const rx = 260 + r() * 200, ry = 120 + r() * 90;
    s += `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="hsl(${h} ${p.glowSat}% ${p.glowLight}%)" fill-opacity="${p.glowAlpha}"/>`;
  }
  return s + "</g>";
}

function contours(r: () => number, p: (typeof PALETTE)["light"], dark: boolean): string {
  let s = "";
  const centers = [0, 1, 2].map(() => ({ x: r() * W, y: r() * H, phase: r() * 6.283, folds: 2 + Math.floor(r() * 3) }));
  for (const c of centers) {
    for (let i = 1; i <= 9; i++) {
      const radius = i * 34 + r() * 6;
      let d = "";
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * 6.283;
        const rr = radius * (1 + 0.18 * Math.sin(th * c.folds + c.phase + i * 0.35) + 0.07 * Math.sin(th * (c.folds + 3) - i));
        d += `${a ? "L" : "M"}${(c.x + rr * Math.cos(th)).toFixed(1)},${(c.y + rr * 0.62 * Math.sin(th)).toFixed(1)}`;
      }
      const major = i % 4 === 0;
      const opacity = (dark ? (major ? 0.26 : 0.13) : (major ? 0.32 : 0.18)) * 0.7;
      s += `<path d="${d}Z" fill="none" stroke="${major ? p.line : p.line2}" stroke-opacity="${opacity.toFixed(3)}" stroke-width="${major ? 1.4 : 1}"/>`;
    }
  }
  return s;
}

/** The drawn default banner for this person, as an image URL (an SVG data URI). */
export function drawnBannerFor(pubkey: string | null | undefined, dark: boolean): string {
  const key = pubkey || "relay-outpost";
  const p = dark ? PALETTE.dark : PALETTE.light;
  const body =
    `<rect width="${W}" height="${H}" fill="${p.ground}"/>` +
    glow(random(seedOf(key)), p) +
    contours(random(seedOf(`${key}t`)), p, dark);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Whether this image URL is one of these drawn banners (not a person's photo). */
export function isDrawnBanner(src: string | null | undefined): boolean {
  return !!src && src.startsWith("data:image/svg+xml");
}
