/**
 * The podcasts surfaces (owner, 2026-10-01):
 *  - no glyphs standing in for emoji next to text (the mic before "Podcasts",
 *    the headphones before the episode count);
 *  - section titles in the app's one label style (components/discover-tile-title);
 *  - a suggested show can be OPENED and listened to before it is followed —
 *    the same in-app preview the Add-feed dialog already has.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const dialog = readFileSync(path.resolve(import.meta.dirname, "AddRssFeedDialog.tsx"), "utf8");
const listen = readFileSync(path.resolve(import.meta.dirname, "../../pages/RSSFeed.tsx"), "utf8");

describe("Add-feed dialog", () => {
  it("draws no mic or headphones glyphs beside text (the mic standing in for missing artwork is a picture, and stays)", () => {
    expect(dialog).not.toMatch(/<Mic className="w-3/);
    expect(dialog).not.toMatch(/<Headphones/);
    expect(dialog).toMatch(/<Mic className=\{`\$\{iconDims\}/);
  });

  it("titles its Podcasts section with the shared label style", () => {
    expect(dialog).toMatch(/<span className=\{TILE_TITLE\}>Podcasts<\/span>/);
    // Using the label without importing it is a runtime crash of the whole
    // dialog (found in the browser harness, not by this file's first draft).
    expect(dialog).toMatch(/import \{ TILE_TITLE \} from "@\/components\/discover-tile-title"/);
  });

  it("shares its show preview", () => {
    expect(dialog).toMatch(/export function FeedPreviewPanel\(/);
  });
});

describe("Listen tab: suggested shows", () => {
  it("open into the preview (episodes, play, follow) rather than follow blindly", () => {
    expect(listen).toMatch(/data-testid=\{`button-open-show-\$\{feed\.id\}`\}/);
    expect(listen).toMatch(/<FeedPreviewPanel/);
    expect(listen).toMatch(/addLabel="Follow"/);
  });

  it("titles the trending section with the shared label style", () => {
    expect(listen).toMatch(/className=\{`px-2 \$\{TILE_TITLE\}`\}>Trending on Podcast Index</);
  });
});
