import { describe, it, expect } from "vitest";
import { STARTER_COMMUNITIES, starterSuggestions } from "./starter-communities";

describe("starterSuggestions (curated communities the user hasn't joined yet)", () => {
  it("hides communities the user already joined, tolerating slash/case/protocol drift", () => {
    const joined = ["wss://relay.primal.net/", "WSS://THEFOREST.NOSTR1.COM"];
    const got = starterSuggestions(joined);
    const urls = got.map((c) => c.url);
    expect(urls).not.toContain("wss://relay.primal.net");
    expect(urls).not.toContain("wss://theforest.nostr1.com");
    expect(urls.length).toBe(STARTER_COMMUNITIES.length - 2);
  });

  it("returns the full curated list for a fresh account", () => {
    expect(starterSuggestions([])).toHaveLength(STARTER_COMMUNITIES.length);
  });

  it("every curated entry has a name, a wss url, and a human tagline", () => {
    for (const c of STARTER_COMMUNITIES) {
      expect(c.url).toMatch(/^wss:\/\//);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.tagline.length).toBeGreaterThan(0);
    }
  });
});
