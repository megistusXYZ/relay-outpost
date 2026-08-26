// WCAG 2.1 contrast utilities.
//
// Pure functions (no DOM) compute relative luminance and contrast ratios so the
// app can report color legibility *objectively* — see ContrastMeter and the
// Accessibility settings section. `readTokenColor` is the only DOM-touching
// helper; everything else is unit-testable in plain Node.

export type RGB = { r: number; g: number; b: number };

// WCAG ratio thresholds. Large text = >= 18.66px bold or >= 24px regular.
export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3;
export const WCAG_AAA_NORMAL = 7;
export const WCAG_AAA_LARGE = 4.5;

export type WcagLevel = "AAA" | "AA" | "fail";

/** Parse a CSS color into RGB. Supports `#rgb`/`#rrggbb` and the bare HSL triple
 *  form used by this app's design tokens, e.g. `"240 12% 40%"` (also tolerates
 *  `hsl(240 12% 40%)` and comma separators). Returns null if unparseable. */
export function parseColor(input: string): RGB | null {
  if (!input) return null;
  const str = input.trim();

  // Hex
  if (str.startsWith("#")) {
    let hex = str.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length !== 6) return null;
    const n = parseInt(hex, 16);
    if (Number.isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // HSL triple — strip optional hsl()/hsla() wrapper and normalize separators.
  const cleaned = str
    .replace(/^hsla?\(/i, "")
    .replace(/\)$/, "")
    .replace(/\//g, " ") // drop alpha slash
    .replace(/,/g, " ")
    .replace(/%/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
    return hslToRgb(parts[0], parts[1], parts[2]);
  }
  return null;
}

/** HSL (h in degrees, s/l in 0–100) → RGB (0–255). */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = lN - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** Composite a possibly-translucent foreground over an opaque background.
 *  Lets the meter account for `text-white/50`-style opacity. */
export function blend(fg: RGB, bg: RGB, alpha: number): RGB {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21) between two colors. */
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Classify a ratio against WCAG AA/AAA thresholds. */
export function wcagLevel(ratio: number, opts?: { large?: boolean }): WcagLevel {
  const large = opts?.large ?? false;
  if (ratio >= (large ? WCAG_AAA_LARGE : WCAG_AAA_NORMAL)) return "AAA";
  if (ratio >= (large ? WCAG_AA_LARGE : WCAG_AA_NORMAL)) return "AA";
  return "fail";
}

/** Convenience: contrast ratio directly from two CSS color strings. */
export function ratioFromCss(fg: string, bg: string): number | null {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return null;
  return contrastRatio(f, b);
}

/** Read a CSS custom property off :root and parse it to RGB (DOM only). */
export function readTokenColor(name: string): RGB | null {
  if (typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseColor(raw);
}
