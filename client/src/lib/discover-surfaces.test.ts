/**
 * What Discover shows (owner, 2026-10-10). Discover is a bottom-bar tab and
 * every tile on it is the wider network — a public feed, the public
 * communities directory, articles, live, videos, photos, a marketplace,
 * people to follow. While a new account's wider network is off the tab is
 * the DOOR: the news (our own curated outlets, not Nostr) and one card that
 * opens the switch. With the wider network on, the tab is exactly what it
 * was.
 */
import { describe, it, expect } from "vitest";
import { discoverSurfaces, DISCOVER_SURFACES_OPEN } from "./discover-surfaces";

describe("discoverSurfaces", () => {
  it("off: the news and the door, nothing from the wider network", () => {
    expect(discoverSurfaces(false)).toEqual(["news", "door"]);
  });
  it("on: the full tab, exactly as before", () => {
    expect(discoverSurfaces(true)).toEqual(DISCOVER_SURFACES_OPEN);
    expect(DISCOVER_SURFACES_OPEN).toEqual(["news", "feed", "communities", "articles", "live", "podcasts", "events", "videos", "images", "marketplace", "topics", "people"]);
  });
  it("no door while the wider network is on", () => {
    expect(discoverSurfaces(true)).not.toContain("door");
  });
});
