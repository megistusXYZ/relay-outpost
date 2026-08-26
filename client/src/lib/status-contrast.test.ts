/**
 * Status colours have to be legible on the LIGHT canvas, not just the dark one.
 *
 * Tailwind's 300/400 status shades are designed to glow on a dark background.
 * On this app's light canvas they measure between 1.25:1 and 2.62:1 against a
 * 4.5:1 requirement — not "a bit thin", closer to invisible. 320 of them applied
 * in light mode because they carried no `dark:` prefix, so one literal was
 * serving both themes and could only be right for one.
 *
 * The fix is the pattern PR #120 established for the purple sprawl and never
 * applied to status colours: darken the light side and restore the original
 * behind a `dark:` guard. Dark mode is therefore STRUCTURALLY unable to regress
 * — every transformed site still names its original shade.
 *
 * WHY THE RATIOS ARE COMPUTED HERE rather than written down as constants: the
 * light surfaces are tokens in index.css, and the whole point of a token is that
 * someone may retune it. If a surface darkens, these shades can quietly stop
 * passing, and a hardcoded "4.75:1" in a comment would go on claiming otherwise.
 * This reads the real tokens and does the arithmetic, so the assertion tracks
 * the design instead of remembering it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "client", "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}
const rel = (f: string) => f.slice(f.indexOf("client/src"));

const STATUS = "amber|yellow|emerald|green|cyan|blue|red|orange";
/** A light-illegible shade with no `dark:` in front of it applies in BOTH themes. */
const UNGUARDED = new RegExp(
  String.raw`(?<![\w-])((?:[a-z-]+:)*)text-(${STATUS})-(300|400)(/\d+)?(?![\w/-])`,
  "g",
);

/**
 * Surfaces that are dark in BOTH themes, where the bright shade is CORRECT and
 * darkening it would be the regression. Every entry was read, not inferred.
 *
 * Two different ways a surface declares itself dark, and the second one is the
 * one that nearly got broken here:
 *   1. A literal class — `bg-black/55`, `bg-[rgba(10,10,20,.8)]`, or a badge
 *      sitting on banner artwork next to `text-white` siblings.
 *   2. A BOOLEAN — `isOverlay ? "text-emerald-300" : "text-emerald-700"`. There
 *      is no `bg-` token anywhere on the line; the darkness lives in a prop. A
 *      class-based scan cannot see it, and a first pass of this sweep duly
 *      "fixed" twelve of them — darkening the branch that renders ON the dark
 *      overlay, while the branch the author had ALREADY written correctly for
 *      light mode sat right beside it in the same ternary.
 *
 * The tell was that the else-branch already read `text-emerald-700` /
 * `text-amber-600` / `text-destructive`. When a ternary already names a
 * light-mode shade, the other branch is not an oversight — it is the dark case,
 * and it is finished.
 */
const DARK_SURFACES: Record<string, { count: number; why: string }> = {
  "client/src/pages/Outposts.tsx": {
    count: 3,
    why: "DARK-SURFACE. One bg-black/40 control pill and two amber badges on a community's banner artwork beside text-white siblings. (Was 4: the expanded banner's on-artwork AUTH badge moved into the identity hero, where it sits on the card surface with theme-aware colors — OutpostHero.tsx.)",
  },
  "client/src/components/rss/AddRssFeedDialog.tsx": {
    count: 3,
    why: "DARK-SURFACE. Three bg-black/55 circular badges over podcast artwork.",
  },
  "client/src/pages/MyOutpost.tsx": {
    count: 3,
    why: "DARK-SURFACE. The WoT status pills use bg-[rgba(10,10,20,0.75+)], dark in both themes.",
  },
  "client/src/components/VideoLightbox.tsx": {
    count: 1,
    why: "DARK-SURFACE. The lightbox is black regardless of theme.",
  },
  "client/src/components/UnlockScreen.tsx": {
    count: 4,
    why: "DARK-SURFACE. The `isOverlay ? bright : dark` ternary — the light branch is already written (text-emerald-700 / text-amber-600).",
  },
  "client/src/components/ImportKeyFlow.tsx": {
    count: 4,
    why: "DARK-SURFACE. Same isOverlay ternary; the else-branch already carries the light-mode shade.",
  },
  "client/src/components/LoginOptions.tsx": {
    count: 2,
    why: "DARK-SURFACE. Same isOverlay ternary; the else-branch uses text-destructive and text-amber-600.",
  },
  "client/src/components/CreateAccountFlow.tsx": {
    count: 1,
    why: "DARK-SURFACE. Same isOverlay ternary; the else-branch already carries text-emerald-700.",
  },
  "client/src/components/PasskeyEnrollmentCard.tsx": {
    count: 1,
    why: "DARK-SURFACE. Same isOverlay ternary; the else-branch already carries text-emerald-600.",
  },
};

// ---- colour maths, so the thresholds are measured rather than remembered ----

function srgbToLinear(v: number) {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: [number, number, number]) {
  const [R, G, B] = [r, g, b].map((c) => srgbToLinear(c / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
/** `262 16% 98%` — the shape shadcn tokens are stored in. */
function hslTripleToRgb(triple: string): [number, number, number] {
  const [h, s, l] = triple.trim().split(/\s+/).map((p) => parseFloat(p));
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const seg: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = seg[Math.floor((h % 360) / 60)];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255] as [number, number, number];
}

/** Tailwind v3, the shades this sweep moved from and to. */
const BRIGHT: Record<string, string> = {
  "amber-400": "#fbbf24", "yellow-400": "#facc15", "emerald-400": "#34d399",
  "green-400": "#4ade80", "cyan-400": "#22d3ee", "blue-400": "#60a5fa",
  "red-400": "#f87171", "orange-400": "#fb923c",
};
/**
 * The replacement shade, chosen PER HUE.
 *
 * Not a uniform number, because a uniform number does not buy uniform contrast:
 * at -700, blue and red clear the floor on every light surface while amber,
 * yellow, emerald, green, cyan and orange land between 4.0 and 4.5:1 on the
 * tinted ones. Each hue is darkened to the first step that passes everywhere, so
 * the palette is even in the thing that matters and uneven in the thing that
 * does not.
 */
const DARKENED: Record<string, string> = {
  "amber-800": "#92400e", "yellow-800": "#854d0e", "emerald-800": "#065f46",
  "green-800": "#166534", "cyan-800": "#155e75", "orange-800": "#9a3412",
  "blue-700": "#1d4ed8", "red-700": "#b91c1c",
};

/**
 * The DARKEST light surface in the system, read from the tokens.
 *
 * Not `--background`. Status text lands on tinted surfaces too — `--accent` is
 * the active-pill and hover fill — and that is where contrast is tightest. Sized
 * against the canvas alone, six of the eight hues sat between 4.0 and 4.5:1 on
 * `--accent` while the test called them passing. The floor has to be measured
 * against the worst surface a caller can put this text on, not the best.
 */
function darkestLightSurface(): [number, number, number] {
  const css = readFileSync(join(SRC, "index.css"), "utf8");
  const root = css.slice(0, css.indexOf(".dark")); // `:root` is light; `.dark` overrides below
  const surfaces = ["background", "card", "muted", "secondary", "accent", "popover"];
  const rgbs: [number, number, number][] = [];
  for (const name of surfaces) {
    const m = root.match(new RegExp(`--${name}:\\s*([0-9.]+\\s+[0-9.]+%\\s+[0-9.]+%)`));
    if (m) rgbs.push(hslTripleToRgb(m[1]));
  }
  expect(rgbs.length, "no light surface tokens found in :root").toBeGreaterThan(2);
  return rgbs.reduce((a, b) => (luminance(a) <= luminance(b) ? a : b));
}

describe("status colours on the light canvas", () => {
  const canvas = darkestLightSurface();

  it("is measuring the light canvas, not the dark one", () => {
    // Guards the parse itself: if `--background` were read out of `.dark`, every
    // ratio below would invert and the suite would pass while asserting nonsense.
    expect(luminance(canvas)).toBeGreaterThan(0.7);
  });

  it("confirms the bright shades really are illegible there — the reason for the sweep", () => {
    for (const [name, hex] of Object.entries(BRIGHT)) {
      const r = contrast(hexToRgb(hex), canvas);
      expect(r, `${name} measured ${r.toFixed(2)}:1 — if this now PASSES, the canvas changed and this sweep may be obsolete`).toBeLessThan(4.5);
    }
  });

  it("confirms every replacement shade passes WCAG AA body text", () => {
    for (const [name, hex] of Object.entries(DARKENED)) {
      const r = contrast(hexToRgb(hex), canvas);
      expect(r, `text-${name} measured ${r.toFixed(2)}:1 against the light canvas — below the 4.5:1 floor`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("no status colour is left serving both themes", () => {
  function unguardedByFile() {
    const byFile = new Map<string, number>();
    for (const file of tsxFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      // Comments are code-adjacent prose here too — a note explaining the fix
      // must not read as the defect. (hover-reach.test.ts learned this the hard way.)
      const blank = (m: string) => m.replace(/[^\n]/g, " ");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/(?<!:)\/\/[^\n]*/g, blank);
      for (const m of code.matchAll(UNGUARDED)) {
        if (m[1].includes("dark:")) continue;
        byFile.set(rel(file), (byFile.get(rel(file)) ?? 0) + 1);
      }
    }
    return byFile;
  }

  it("never appears in a file that has none", () => {
    const fresh = [...unguardedByFile().keys()].filter((f) => !(f in DARK_SURFACES));
    expect(
      fresh,
      `A 300/400 status shade with no dark: guard applies in LIGHT mode, where it measures under 3:1.\nWrite it as \`text-<c>-700 dark:text-<c>-400\` so each theme gets the shade it needs:\n${fresh.join("\n")}`,
    ).toEqual([]);
  });

  it("holds the dark-surface exemptions to their exact count", () => {
    const byFile = unguardedByFile();
    const drift: string[] = [];
    for (const [file, { count }] of Object.entries(DARK_SURFACES)) {
      const actual = byFile.get(file) ?? 0;
      if (actual !== count) drift.push(`${file}: ${actual}, expected ${count}`);
    }
    expect(drift, `Exemption counts moved — re-read the surfaces before adjusting:\n${drift.join("\n")}`).toEqual([]);
  });

  it("keeps every exemption justified", () => {
    for (const [file, { why }] of Object.entries(DARK_SURFACES)) {
      expect(/^DARK-SURFACE\./.test(why), `${file}: the only reason to keep a bright shade is that the surface is dark in BOTH themes`).toBe(true);
      expect(why.length, `${file}: needs a real reason`).toBeGreaterThan(40);
    }
  });
});
