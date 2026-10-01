/**
 * The profile's Media shelf title (owner, 2026-10-01): no glyph beside the
 * word, and the app's one label style (components/discover-tile-title), like
 * the Discover tiles and the podcast sections.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "IdentityProfileMain.tsx"), "utf8");

describe("profile Media shelf title", () => {
  it("is the shared label style with no icon", () => {
    expect(src).toMatch(/<h2 className=\{TILE_TITLE\}>\s*Media\s*<\/h2>/);
    expect(src).toMatch(/import \{ TILE_TITLE \} from "@\/components\/discover-tile-title"/);
    expect(src).not.toMatch(/<Images\b/);
  });
});
