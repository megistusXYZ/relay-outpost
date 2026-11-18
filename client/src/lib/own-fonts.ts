/**
 * Fonts come from our own origin, never a font CDN (owner, 2026-11-18). Every
 * page load used to fetch a stylesheet for eleven families from Google Fonts,
 * which hands each visitor's IP address to Google: at odds with "No ads, no
 * trackers". Geist, the default face, is a file in /fonts (@font-face in
 * index.css). The mono face, the article-heading face and the fonts offered in
 * Settings are open-licence packages bundled at build time; their stylesheets
 * load on request, and the browser fetches a font file only when text uses it.
 *
 * Weights 400–700, upright. Italics are synthesised (rare in the app).
 */
const four = (load: (w: 400 | 500 | 600 | 700) => Promise<unknown>) => () => Promise.all([load(400), load(500), load(600), load(700)]);

const LOADERS: Record<string, () => Promise<unknown>> = {
  "Space Mono": () => Promise.all([import("@fontsource/space-mono/400.css"), import("@fontsource/space-mono/700.css")]),
  "Space Grotesk": four((w) => w === 400 ? import("@fontsource/space-grotesk/400.css") : w === 500 ? import("@fontsource/space-grotesk/500.css") : w === 600 ? import("@fontsource/space-grotesk/600.css") : import("@fontsource/space-grotesk/700.css")),
  "JetBrains Mono": four((w) => w === 400 ? import("@fontsource/jetbrains-mono/400.css") : w === 500 ? import("@fontsource/jetbrains-mono/500.css") : w === 600 ? import("@fontsource/jetbrains-mono/600.css") : import("@fontsource/jetbrains-mono/700.css")),
  "Nunito": four((w) => w === 400 ? import("@fontsource/nunito/400.css") : w === 500 ? import("@fontsource/nunito/500.css") : w === 600 ? import("@fontsource/nunito/600.css") : import("@fontsource/nunito/700.css")),
  "Inter": four((w) => w === 400 ? import("@fontsource/inter/400.css") : w === 500 ? import("@fontsource/inter/500.css") : w === 600 ? import("@fontsource/inter/600.css") : import("@fontsource/inter/700.css")),
  "Poppins": four((w) => w === 400 ? import("@fontsource/poppins/400.css") : w === 500 ? import("@fontsource/poppins/500.css") : w === 600 ? import("@fontsource/poppins/600.css") : import("@fontsource/poppins/700.css")),
  "Lora": four((w) => w === 400 ? import("@fontsource/lora/400.css") : w === 500 ? import("@fontsource/lora/500.css") : w === 600 ? import("@fontsource/lora/600.css") : import("@fontsource/lora/700.css")),
  "Playfair Display": four((w) => w === 400 ? import("@fontsource/playfair-display/400.css") : w === 500 ? import("@fontsource/playfair-display/500.css") : w === 600 ? import("@fontsource/playfair-display/600.css") : import("@fontsource/playfair-display/700.css")),
  "Source Serif 4": four((w) => w === 400 ? import("@fontsource/source-serif-4/400.css") : w === 500 ? import("@fontsource/source-serif-4/500.css") : w === 600 ? import("@fontsource/source-serif-4/600.css") : import("@fontsource/source-serif-4/700.css")),
};

const asked = new Set<string>();

/** The first family named in a CSS font-family list, without its quotes. */
export function firstFamily(cssFamily: string): string {
  return (cssFamily.split(",")[0] || "").replace(/['"]/g, "").trim();
}

/** Make a family available (by name, or by a CSS font-family list). Unknown names and Geist need nothing. */
export function ensureFont(cssFamily: string): void {
  const name = firstFamily(cssFamily);
  const load = LOADERS[name];
  if (!load || asked.has(name)) return;
  asked.add(name);
  void load().catch(() => { asked.delete(name); });
}

/** The faces the app's own chrome uses beside Geist: mono text and article headings. Called once the app is idle. */
export function ensureAppFonts(): void {
  ensureFont("Space Mono");
  ensureFont("Space Grotesk");
}

export const OWN_FONT_FAMILIES = Object.keys(LOADERS);
