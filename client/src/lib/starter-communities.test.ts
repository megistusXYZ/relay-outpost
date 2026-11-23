import { describe, it, expect } from "vitest";
import { starterSuggestions, type StarterCommunity } from "./starter-communities";

const FEATURED: StarterCommunity[] = [
  { url: "wss://harbour.example", name: "Harbour", tagline: "Boats and tides" },
  { url: "wss://orchard.example", name: "Orchard", tagline: "Fruit growers" },
  { url: "wss://quarry.example", name: "Quarry", tagline: "Stone and tools" },
];

describe("starterSuggestions (featured communities the user hasn't joined yet)", () => {
  it("hides communities the user already joined, tolerating slash/case/protocol drift", () => {
    const got = starterSuggestions(["wss://harbour.example/", "WSS://QUARRY.EXAMPLE"], FEATURED);
    expect(got.map((c) => c.url)).toEqual(["wss://orchard.example"]);
  });

  it("returns the whole list, in its order, for a fresh account", () => {
    expect(starterSuggestions([], FEATURED)).toEqual(FEATURED);
  });

  it("with nothing featured there is nothing to suggest", () => {
    expect(starterSuggestions(["wss://harbour.example"], [])).toEqual([]);
  });
});
