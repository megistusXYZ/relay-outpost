/**
 * The sign-in backdrop must not be painted in a theme it was not drawn for.
 *
 * `/login` laid a flat `bg-black/50` over the whole viewport in BOTH themes. A
 * reader who had chosen light mode — arriving from the light Help pages, which
 * is exactly the route this was reported on — got 50% black over a light canvas
 * and landed on neither: a muddy off-white with the cockpit photo ghosting
 * through, the eyebrow and the "takes 30 seconds" line washed to nearly nothing.
 *
 * The cause is worth stating precisely, because it is not "this page is
 * dark-only". LoginOptions picks light values throughout (`text-brand/85`,
 * `from-foreground … dark:from-white`) — the CONTENT was theme-aware and the
 * BACKDROP never was. That mismatch is the defect, and it is the thing this
 * guards: a full-bleed dark layer on a surface whose content already adapts.
 *
 * Source-reading, because jsdom cannot evaluate the `dark:` variant any more
 * than it can a media query — a render test would report the same computed
 * style before and after the fix. Both themes were checked in a real browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LOGIN = readFileSync(join(process.cwd(), "client", "src", "pages", "Login.tsx"), "utf8");

/** Strip comments — this file explains the bug using the very string it forbids. */
function code(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);
}

describe("the /login cockpit backdrop", () => {
  const src = code(LOGIN);

  it("never paints a black scrim outside dark mode", () => {
    // Every bg-black/NN here must carry a dark: prefix. Without one it is
    // applied in light mode too, which is the bug that was reported.
    const scrims = [...src.matchAll(/(?<![\w-])((?:[a-z-]+:)*)bg-black\/\d+/g)];
    const unguarded = scrims.filter((m) => !m[1].includes("dark:")).map((m) => m[0]);
    expect(
      unguarded,
      `A full-bleed black scrim with no dark: prefix covers the light theme too:\n${unguarded.join("\n")}`,
    ).toEqual([]);
    // And the dark one must still exist — "fixed" by deleting the treatment
    // would be a different regression, not a fix.
    expect(scrims.length, "the dark-mode scrim disappeared entirely").toBeGreaterThan(0);
  });

  it("keeps the white scanline texture out of light mode", () => {
    // The lines are rgba(255,255,255,.08). On a light canvas they are either
    // invisible or a haze that lifts the page for no reason.
    expect(src).toMatch(/hidden dark:block/);
  });

  it("still shows the cockpit in light, rather than hiding the page's identity", () => {
    // The fix is "stop painting a dark scrim", not "remove the artwork". The
    // image stays, fainter, so /login is still recognisably itself in light.
    expect(src).toMatch(/opacity-\[0\.0\d\] dark:opacity-\d+/);
    expect(src).toContain("cockpit-bg.webp");
  });
});
