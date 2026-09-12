/**
 * The emoji button sits in seven composers. On a phone it was 32px, under the
 * ~44px a fingertip needs, so it gets `.touch-target` (index.css): a 44px hit
 * area on touch screens only, leaving the dense desktop layout alone.
 *
 * Source-reading for the same reason as hover-reach.test.ts: jsdom can't
 * evaluate `@media (hover: none), (pointer: coarse)`, so a rendered size check
 * would pass whether or not the class is there. The size was measured in a
 * browser with an emulated phone; this stops the class quietly going missing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PICKER = join(process.cwd(), "client", "src", "components", "ComposeEmojiPicker.tsx");

/** The emoji button's own JSX: from its `<button` to its test id. */
function triggerJsx(): string {
  const src = readFileSync(PICKER, "utf8");
  const id = src.indexOf('data-testid="button-compose-emoji-picker"');
  expect(id).toBeGreaterThan(0);
  return src.slice(src.lastIndexOf("<button", id), id);
}

describe("emoji button", () => {
  it("is a 44px touch target on phones", () => {
    expect(triggerJsx()).toMatch(/className="[^"]*\btouch-target\b/);
  });
});
