import { describe, it, expect } from "vitest";
import { getDiscoverFeedRelays, getDiscoverRelayPool, blendDiscoverRelays } from "./discover-relays";
import { isBridgeRelay } from "./relay-discovery";

describe("getDiscoverRelayPool", () => {
  it("returns a curated, non-empty, bridge-free seed pool", () => {
    const pool = getDiscoverRelayPool(["en"]);
    expect(pool.length).toBeGreaterThan(5);
    expect(pool.every((u) => /^wss:\/\//.test(u))).toBe(true);
    expect(pool.some((u) => isBridgeRelay({ url: u }))).toBe(false);
  });
});

describe("getDiscoverFeedRelays", () => {
  it("returns base relays unchanged when Discover is off", () => {
    const base = ["wss://a.example", "wss://b.example"];
    expect(getDiscoverFeedRelays(base, false, ["en"])).toEqual(base);
  });

  it("broadens with the pool, deduping and capping when on", () => {
    const base = ["wss://relay.damus.io"]; // also in the seed → must not duplicate
    const out = getDiscoverFeedRelays(base, true, ["en"], 6);
    expect(out.length).toBe(6);
    expect(out[0]).toBe("wss://relay.damus.io");
    // no normalized duplicates
    const norm = out.map((u) => u.toLowerCase().replace(/\/$/, ""));
    expect(new Set(norm).size).toBe(norm.length);
    // base was broadened with additional relays
    expect(out.length).toBeGreaterThan(base.length);
  });

  it("folds outbox + community sources before the discover pool when asked", () => {
    const out = getDiscoverFeedRelays(["wss://base.example"], true, ["en"], 5, {
      outbox: ["wss://outbox.example"],
      community: ["wss://community.example"],
      foldOutbox: true,
      foldCommunity: true,
    });
    // base → outbox → community come first, before the curated discover pool.
    expect(out.slice(0, 3)).toEqual([
      "wss://base.example",
      "wss://outbox.example",
      "wss://community.example",
    ]);
    expect(out.length).toBe(5);
  });
});

describe("blendDiscoverRelays", () => {
  const discover = ["wss://d1.example", "wss://d2.example", "wss://d3.example"];

  it("orders base → outbox → community → discover, deduped and capped", () => {
    const out = blendDiscoverRelays({
      base: ["wss://base.example"],
      outbox: ["wss://outbox.example"],
      community: ["wss://community.example"],
      discover,
      cap: 20,
      foldOutbox: true,
      foldCommunity: true,
    });
    expect(out).toEqual([
      "wss://base.example",
      "wss://outbox.example",
      "wss://community.example",
      ...discover,
    ]);
  });

  it("excludes outbox/community when their fold flags are false (Strict = network-centered)", () => {
    const out = blendDiscoverRelays({
      base: ["wss://base.example"],
      outbox: ["wss://outbox.example"],
      community: ["wss://community.example"],
      discover,
      cap: 20,
      foldOutbox: false,
      foldCommunity: false,
    });
    expect(out).toEqual(["wss://base.example", ...discover]);
  });

  it("dedupes across sources by normalized URL and enforces the cap", () => {
    const out = blendDiscoverRelays({
      base: ["wss://dup.example"],
      outbox: ["wss://dup.example/"], // trailing slash → same normalized url
      community: ["wss://community.example"],
      discover,
      cap: 3,
      foldOutbox: true,
      foldCommunity: true,
    });
    expect(out.length).toBe(3);
    const norm = out.map((u) => u.toLowerCase().replace(/\/$/, ""));
    expect(new Set(norm).size).toBe(norm.length);
    expect(out[0]).toBe("wss://dup.example");
  });
});
