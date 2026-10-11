/**
 * One recommendation per screen (owner, 2026-10-10, from the first-use
 * review): the sign-in chooser carried "Recommended for desktop" on one
 * option and "most secure" on another, and the next screen called Touch ID
 * "Recommended" — three bests across two screens, in words only Nostr
 * people carry. The chooser keeps its one platform badge; no caption
 * competes with it. Source-reading: the words are the design.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "client", "src", "components", "LoginOptions.tsx"), "utf8");

describe("the sign-in chooser recommends one thing", () => {
  it("has its platform badge", () => {
    expect(src).toMatch(/Recommended for desktop/);
  });
  it("has no second best competing with it", () => {
    expect(src).not.toMatch(/most secure/i);
    expect(src).not.toMatch(/\bbest\b/i);
  });
});
