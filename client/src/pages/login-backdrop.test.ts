/**
 * The sign-in screens are a plain page in the visitor's theme (owner,
 * 2026-11-18): "if users click in light mode make these screens light mode, if
 * they are dark mode make them dark mode", and "simplified to match the new
 * brand". That covers /login and the sign-in screen behind the landing's
 * "Create your space".
 *
 * History this replaces: /login used to lay a black scrim, white scanlines and
 * a cockpit photo over both themes (2026-08), then kept them for dark only.
 * The overlay behind the landing was always a black starfield with the same
 * photo, whatever the theme. Both are gone; the browser check
 * (landing-links-e2e) measures what is painted, and this is its source backstop.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), "client", "src", p), "utf8");
/** Strip comments: the prose in these files names what it forbids. */
const code = (src: string) => {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);
};
const login = code(read("pages/Login.tsx"));
const overlay = code(read("components/GalaxyWarpOverlay.tsx"));
const css = read("index.css");

const spaceArt = (src: string) => [/cockpit-bg/, /Scanline/i, /scanline/].filter((re) => re.test(src)).map(String);

describe("the sign-in screens are a plain page in the visitor's theme", () => {
  it("/login has no cockpit photo, scanlines or scrim", () => {
    expect(spaceArt(login)).toEqual([]);
    expect(login).not.toMatch(/bg-black\/\d+/);
    expect(login).toContain("signin-surface");
  });

  it("the screen behind \"Create your space\" covers the starfield with the page background, and has no photo", () => {
    expect(spaceArt(overlay)).toEqual([]);
    expect(overlay).toMatch(/\(isCockpit \|\| isWarpingToCockpit\) && \([\s\S]{0,160}bg-background signin-surface/);
    // …and it hands LoginOptions the theme-aware look, not the white-on-black one.
    expect(overlay).not.toMatch(/<LoginOptions[\s\S]{0,80}variant="overlay"/);
  });

  it("the shared surface is built from theme tokens, so it cannot be dark in light mode", () => {
    const rule = css.slice(css.indexOf(".signin-surface {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("hsl(var(--brand)");
    expect(body).not.toMatch(/#0|black|rgba\(0, 0, 0/);
  });

  it("the check can fail: the old photo and scrim would be caught", () => {
    const old = login + '<div className="absolute inset-0 dark:bg-black/50" /><div style={{ backgroundImage: "url(/images/landing/cockpit-bg.webp)" }} />';
    expect(spaceArt(old)).not.toEqual([]);
    expect(old).toMatch(/bg-black\/\d+/);
  });
});
