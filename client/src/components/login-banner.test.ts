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
 * The eyebrow above it was the same screen's other lesson (0.4em of tracking at
 * 11px measured fine and still stopped reading as a word). The eyebrow itself
 * is gone since 2026-11-18, when the chooser became the heading, two buttons
 * and one "Other ways to sign in" link; the tracking rule stays.
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

describe("the sign-in chooser is the heading, two buttons and one link (owner, 2026-11-18)", () => {
  it("is not spaced so wide it stops reading as a word", () => {
    // 0.4em at 11px was the single widest tracking in the app. Anything at or
    // beyond it here is the same mistake returning.
    const wide = [...BODY.matchAll(/tracking-\[(0\.\d+)em\]/g)]
      .map((m) => parseFloat(m[1]))
      .filter((em) => em >= 0.35);
    expect(
      wide,
      `Tracking of ${wide.join(", ")}em in the sign-in chooser — at small sizes this reads as spaced-out texture rather than a word.`,
    ).toEqual([]);
  });

  it("has no eyebrow, pitch or reassurance row above and below the buttons", () => {
    // "Less is more": the "Welcome" label, the explainer under the buttons and
    // the "Yours alone · Help & guides" row were removed on purpose.
    expect(BODY).not.toContain("text-banner-eyebrow");
    expect(BODY).not.toContain("text-existing-account-gloss");
    expect(BODY).not.toMatch(/Yours alone/);
  });

  it("keeps the other sign-in methods behind one link that says whether it is open", () => {
    expect(BODY).toMatch(/aria-expanded=\{moreOpen\}[\s\S]{0,300}data-testid="button-other-signin"/);
    expect(BODY).toMatch(/\{moreOpen && \([\s\S]{0,400}data-testid="container-signin-options"/);
  });

  it("the check can fail: the old eyebrow would be caught", () => {
    const old = BODY + '<p className="text-brand" data-testid="text-banner-eyebrow">Welcome</p>';
    expect(old).toContain("text-banner-eyebrow");
  });
});
