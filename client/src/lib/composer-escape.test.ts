/**
 * Escape closes the note composer, the way its ✕ does (nothing typed is lost:
 * the ✕ keeps the text too). The composer is the bottom of a stack, so Escape
 * belongs to whatever is on top of it first: the mention list, a media
 * preview, an emoji/GIF picker or a dialog. Those claim the key
 * (preventDefault) before it reaches the composer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { composerEscapeAction } from "./composer-escape";

const esc = (over: Partial<{ key: string; defaultPrevented: boolean; isComposing: boolean }> = {}) =>
  ({ key: "Escape", defaultPrevented: false, isComposing: false, ...over });

describe("composerEscapeAction", () => {
  it("Escape closes the composer", () => {
    expect(composerEscapeAction(esc(), { mentionActive: false })).toBe("close");
  });

  it("other keys do nothing", () => {
    expect(composerEscapeAction(esc({ key: "Enter" }), { mentionActive: false })).toBe("ignore");
    expect(composerEscapeAction(esc({ key: "Esc" }), { mentionActive: false })).toBe("close");
  });

  it("an Escape something on top already took (mention list, picker, dialog, preview) leaves the composer open", () => {
    expect(composerEscapeAction(esc({ defaultPrevented: true }), { mentionActive: false })).toBe("ignore");
  });

  it("an Escape that ends IME composition (Japanese, Chinese, Korean input) never closes it", () => {
    expect(composerEscapeAction(esc({ isComposing: true }), { mentionActive: false })).toBe("ignore");
  });

  it("an open mention lookup with nothing to pick closes first, then the composer", () => {
    expect(composerEscapeAction(esc(), { mentionActive: true })).toBe("close-mention");
  });
});

describe("the wiring", () => {
  const composer = readFileSync(path.resolve(import.meta.dirname, "../components/CreatePost.tsx"), "utf8");

  it("the composer listens while open, and Escape and ✕ share one close", () => {
    expect(composer).toMatch(/composerEscapeAction\(e, \{ mentionActive/);
    expect(composer).toMatch(/data-testid="button-close-compose"/);
    expect(composer).toMatch(/onClick=\{closeComposer\}\s*\n\s*data-testid="button-close-compose"/);
  });

  it("the media preview claims its Escape so the composer stays open behind it", () => {
    expect(composer).toMatch(/if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); setPreviewMedia\(null\); \}/);
  });
});
