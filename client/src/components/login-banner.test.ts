/**
 * The sign-in banner's headline must not depend on a decoration to be visible.
 *
 * "Create your account." shipped as `bg-clip-text text-transparent` over a
 * gradient — the glyphs had no colour of their own, and every pixel of them came
 * from a background that was clipped to their shape. Wherever that background
 * does not paint, the most important line on the sign-in screen is not faint,
 * it is GONE: forced-colors mode strips backgrounds, and so do some print paths.
 * There was no fallback colour behind it.
 *
 * It was also the only `bg-clip-text` in the codebase, so nothing was built on
 * the idiom and removing it cost no consistency.
 *
 * The eyebrow is the same screen's other complaint and a different lesson: it
 * MEASURED fine all along (4.61:1 on dark, 5.40:1 on light) and still read
 * washed out, because 0.4em of tracking at 11px puts almost half a character of
 * air between letters and the word stops being a word. Contrast is not the only
 * way text becomes hard to read, and a contrast test alone would have called it
 * healthy. 0.4em was the sole use in the app; 0.2em is the house value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "client", "src", "components", "LoginOptions.tsx"),
  "utf8",
);

/** Strip comments — this file's own prose names the classes it forbids. */
function code(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/[^\n]*/g, blank);
}
const BODY = code(SRC);

describe("the sign-in banner headline", () => {
  it("carries its own colour rather than borrowing one from a clipped background", () => {
    expect(
      BODY.includes("bg-clip-text"),
      "bg-clip-text + text-transparent renders the headline INVISIBLE wherever the background does not paint (forced-colors, print). Give the text a real colour.",
    ).toBe(false);
  });

  it("still renders the headline element", () => {
    // Guards the lazy way to satisfy the test above: deleting the headline.
    expect(BODY).toContain("Create your account.");
    expect(BODY).toMatch(/<h3/);
  });
});

describe("the sign-in banner eyebrow", () => {
  it("is not spaced so wide it stops reading as a word", () => {
    // 0.4em at 11px was the single widest tracking in the app. Anything at or
    // beyond it here is the same mistake returning.
    const wide = [...BODY.matchAll(/tracking-\[(0\.\d+)em\]/g)]
      .map((m) => parseFloat(m[1]))
      .filter((em) => em >= 0.35);
    expect(
      wide,
      `Tracking of ${wide.join(", ")}em in the sign-in banner — at 11px this reads as spaced-out texture rather than a word.`,
    ).toEqual([]);
  });

  it("keeps the eyebrow at full brand strength", () => {
    // It used to be /75 and /85. A kicker this small has no room to be faint,
    // and the faintness was read as the bug even though contrast passed.
    expect(BODY).toMatch(/tracking-\[0\.2em\] text-brand"/);
  });
});
