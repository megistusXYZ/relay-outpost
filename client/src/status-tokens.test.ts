/**
 * Status colours as tokens — Light mode Phase 2c, first slice (LIGHT_MODE.md;
 * owner, 2026-10-08). Success, warning and danger each get ONE light-mode
 * colour instead of a different Tailwind shade per screen. Info folds into
 * violet (--primary). The values LIGHT_MODE.md first sketched were fills;
 * as text two of them failed (success 3.99:1, warning 3.12:1), so these are
 * the text-safe shades, measured here against the darkest light surface a
 * status line can sit on (--accent), as status-contrast.test.ts does.
 *
 * Dark mode is out of scope and must not change: a converted site keeps its
 * original dark shade behind `dark:`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");
const ROOT = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
const token = (name: string): [number, number, number] => {
  const m = ROOT.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)%\\s+(\\d+)%`));
  if (!m) throw new Error(`no light --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
function rgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lum = (c: [number, number, number]) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const A = lum(rgb(a)), B = lum(rgb(b));
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

describe("status tokens (light)", () => {
  // --zap is the money colour (zaps, sats, thanks): amber kept as identity,
  // one shade, dark enough to read (owner, 2026-10-08).
  for (const name of ["success", "warning", "danger", "zap"]) {
    it(`--${name} is readable as text on every light surface (4.5:1)`, () => {
      for (const surface of ["accent", "background", "card"]) {
        expect(ratio(token(name), token(surface)), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("are Tailwind colours (text-success, bg-warning/10, border-danger/30…)", () => {
    const tw = readFileSync(path.resolve(import.meta.dirname, "../../tailwind.config.ts"), "utf8");
    for (const name of ["success", "warning", "danger", "zap"]) expect(tw).toMatch(new RegExp(`${name}:\\s*\\{[^}]*hsl\\(var\\(--${name}\\)`));
  });
});

/**
 * "Couldn't reach" is a warning, never an error (owner, 2026-10-08;
 * RELAY_REACHABILITY.md): we never got to ask, which is not the relay saying
 * no. It was red in the Publisher and the Wire Console, amber elsewhere.
 */
describe("Couldn't reach", () => {
  it("is the warning colour everywhere in the relay console, light and dark", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = path.resolve(import.meta.dirname, "pages/relay-ops");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.includes(".test."))) {
      readFileSync(path.join(dir, f), "utf8").split("\n").forEach((line, i) => {
        if (/Couldn't reach/.test(line) && /text-(danger|red-)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Light-mode green text is the success colour (owner, 2026-10-08: Phase 2c
 * slice 2). It was a dozen greens — emerald-500 to -700, green-500/600, with
 * opacities — and as text on white most of them were under 4.5:1. Dark mode
 * keeps its own shades behind dark:, and icons (anything with a size) may
 * stay brighter: 3:1 is enough for an icon.
 */
describe("green text", () => {
  it("in light mode is only ever text-success", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx") && !p.includes(".test.")) files.push(p); } };
    walk(import.meta.dirname);
    const offenders: string[] = [];
    // -100..-300 are dark-surface shades (an overlay's branch of a light/dark
    // ternary — LIGHT_MODE.md "the tell"): correct as they are.
    const LIGHT_GREEN = /(^|[\s"'`{])text-(emerald|green)-[4-9]00(\/\d+)?(?=[\s"'`}]|$)/;
    const ICON = /(^|[\s"'`])(w-\d|h-\d|size-\d|w-\[|h-\[)/;
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        for (const cls of line.match(/"[^"]*"|`[^`]*`/g) || []) {
          if (LIGHT_GREEN.test(cls) && !ICON.test(cls)) offenders.push(`${path.relative(import.meta.dirname, f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Light-mode red text is the danger colour (owner, 2026-10-08: Phase 2c
 * slice 3) — destructive actions, errors, "Down", "Flagged", money going out.
 * Kept on purpose, each with its reason: red as an IDENTITY colour (a liked
 * heart's count; a category's icon). Rose is the calendar's category hue, not
 * status, and -100..-300 are dark-surface shades. Icons may stay brighter.
 */
describe("red text", () => {
  const IDENTITY = [
    { file: "components/MediaInteractionBar.tsx", has: "hasLiked", why: "a liked heart's count: red is the like's identity" },
    { file: "pages/Notifications.tsx", has: "reaction: { icon: Heart", why: "a category's icon colour (calm Activity, #399)" },
    { file: "pages/WtfIsThis.tsx", has: 'label: "Video"', why: "a content type's icon colour (#400)" },
  ];
  it("in light mode is only ever text-danger", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx") && !p.includes(".test.")) files.push(p); } };
    walk(import.meta.dirname);
    const offenders: string[] = [];
    const LIGHT_RED = /(^|[\s"'`{])text-red-[4-9]00(\/\d+)?(?=[\s"'`}]|$)/;
    const ICON = /(^|[\s"'`])(w-\d|h-\d|size-\d|w-\[|h-\[)/;
    for (const f of files) {
      const rel = path.relative(import.meta.dirname, f);
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (IDENTITY.some((x) => x.file === rel && line.includes(x.has))) return;
        for (const cls of line.match(/"[^"]*"|`[^`]*`/g) || []) {
          if (LIGHT_RED.test(cls) && !ICON.test(cls)) offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
