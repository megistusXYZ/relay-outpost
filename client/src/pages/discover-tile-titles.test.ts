/**
 * Discover's tile titles are plain section labels — no icon before the name.
 *
 * Owner, 2026-09-30: "remove all these emojis from the discovery page and
 * make sure the titles are nicer and more pro looking." The little brand-purple
 * icons before Feed / Communities / Articles / News / Marketplace / Images read
 * as emoji next to the content; the label alone, set as an eyebrow, does not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "Discover.tsx"), "utf8");
const strip = readFileSync(path.resolve(import.meta.dirname, "../components/PeopleToFollowStrip.tsx"), "utf8");
const shared = readFileSync(path.resolve(import.meta.dirname, "../components/discover-tile-title.ts"), "utf8");

describe("Discover tile titles", () => {
  it("TileShell takes no icon and draws none before the label", () => {
    expect(src).not.toMatch(/icon: ComponentType/);
    expect(src).not.toMatch(/icon=\{/);
    expect(src).not.toMatch(/<Icon className/);
  });

  it("the News tile's title has no icon either", () => {
    expect(src).not.toMatch(/<Newspaper /);
  });

  it("every section title is the one shared label — tiles, the News hero, and People to follow", () => {
    expect(src.match(/className=\{TILE_TITLE\}/g) ?? []).toHaveLength(2); // TileShell + the News hero
    expect(strip.match(/className=\{TILE_TITLE\}/g) ?? []).toHaveLength(1);
    expect(strip).not.toMatch(/<UserPlus /);
    expect(shared).toMatch(/export const TILE_TITLE = "text-\[11px\] font-semibold uppercase tracking-\[0\.14em\] text-muted-foreground"/);
  });

  it("the Live tile's chip says what is true now rather than repeating the tile's name", () => {
    expect(src).toMatch(/live-dot" \/>\s*On air\s*<\/span>/);
  });
});
