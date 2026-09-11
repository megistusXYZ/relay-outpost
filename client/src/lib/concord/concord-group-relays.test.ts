/**
 * Which relays a new group lives on: yours first (where you already publish),
 * the app's defaults filling up to five so every member can reach it. It used to
 * be the first five defaults, whatever relays you actually use.
 */
import { describe, it, expect } from "vitest";
import { groupRelays } from "./concord-group-relays";

const DEFAULTS = ["wss://d1.example", "wss://d2.example", "wss://d3.example", "wss://d4.example", "wss://d5.example", "wss://d6.example"];

describe("a new group's relays", () => {
  it("puts your own write relays first, then fills with the defaults up to five", () => {
    expect(groupRelays(["wss://mine.example", "wss://also-mine.example"], DEFAULTS)).toEqual([
      "wss://mine.example", "wss://also-mine.example", "wss://d1.example", "wss://d2.example", "wss://d3.example",
    ]);
  });

  it("keeps room for the defaults: at most three of yours before them", () => {
    const mine = ["wss://m1.example", "wss://m2.example", "wss://m3.example", "wss://m4.example"];
    expect(groupRelays(mine, DEFAULTS)).toEqual(["wss://m1.example", "wss://m2.example", "wss://m3.example", "wss://d1.example", "wss://d2.example"]);
  });

  it("uses more of yours only when the defaults run out", () => {
    const mine = ["wss://m1.example", "wss://m2.example", "wss://m3.example", "wss://m4.example"];
    expect(groupRelays(mine, ["wss://d1.example"])).toEqual(["wss://m1.example", "wss://m2.example", "wss://m3.example", "wss://d1.example", "wss://m4.example"]);
  });

  it("with no relays of your own, the defaults", () => {
    expect(groupRelays([], DEFAULTS)).toEqual(DEFAULTS.slice(0, 5));
  });

  it("only secure relays, each once", () => {
    expect(groupRelays(["ws://insecure.example", "wss://Mine.example/", "not a url", "wss://mine.example"], ["wss://mine.example", "wss://d1.example"])).toEqual([
      "wss://Mine.example", "wss://d1.example",
    ]);
  });
});
