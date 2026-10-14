/**
 * What Discover shows (owner, 2026-10-10). Discover is a bottom-bar tab and
 * every tile on it is the wider network — a public feed, the public
 * communities directory, articles, live, videos, photos, a marketplace,
 * people to follow. While a new account's wider network is off the tab is
 * YOUR SPACE (owner, 2026-10-13): the news and podcasts (our own sources, not
 * Nostr), your own communities, invite a friend, a rail of shows to play, and
 * the door last. With the wider network on, the tab is exactly what it was.
 */
import { describe, it, expect } from "vitest";
import { discoverSurfaces, DISCOVER_SURFACES_OPEN } from "./discover-surfaces";

describe("discoverSurfaces", () => {
  it("off: your space — the news, podcasts to play, your own communities, invite — then the door", () => {
    expect(discoverSurfaces(false)).toEqual(["news", "podcasts", "communities", "invite", "listen", "door"]);
  });
  it("off: nothing that reads from strangers", () => {
    const off = discoverSurfaces(false);
    for (const wider of ["feed", "articles", "live", "events", "videos", "images", "marketplace", "topics", "people"]) {
      expect(off).not.toContain(wider);
    }
    // The door is last: it is the exit, not the point of the page.
    expect(off[off.length - 1]).toBe("door");
  });
  it("on: the full tab, exactly as before", () => {
    expect(discoverSurfaces(true)).toEqual(DISCOVER_SURFACES_OPEN);
    expect(DISCOVER_SURFACES_OPEN).toEqual(["news", "feed", "communities", "articles", "live", "podcasts", "events", "videos", "images", "marketplace", "topics", "people"]);
  });
  it("no door while the wider network is on", () => {
    expect(discoverSurfaces(true)).not.toContain("door");
  });
});
