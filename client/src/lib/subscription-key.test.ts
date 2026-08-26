import { describe, it, expect } from "vitest";
import type { Filter } from "nostr-tools";
import { subscriptionKey, normalizeFilter, normalizeRelayUrl } from "./subscription-key";

describe("normalizeRelayUrl", () => {
  it("lowercases and strips trailing slashes", () => {
    expect(normalizeRelayUrl("wss://Relay.Damus.io/")).toBe("wss://relay.damus.io");
    expect(normalizeRelayUrl("wss://nos.lol///")).toBe("wss://nos.lol");
  });
});

describe("normalizeFilter", () => {
  it("is independent of key order", () => {
    const a: Filter = { kinds: [1], authors: ["x"], since: 5 };
    const b: Filter = { since: 5, authors: ["x"], kinds: [1] };
    expect(normalizeFilter(a)).toBe(normalizeFilter(b));
  });

  it("is independent of array element order", () => {
    const a: Filter = { kinds: [7, 1, 6], authors: ["b", "a"] };
    const b: Filter = { kinds: [1, 6, 7], authors: ["a", "b"] };
    expect(normalizeFilter(a)).toBe(normalizeFilter(b));
  });

  it("normalizes tag-query arrays (#e/#p)", () => {
    const a: Filter = { "#e": ["e2", "e1"] } as Filter;
    const b: Filter = { "#e": ["e1", "e2"] } as Filter;
    expect(normalizeFilter(a)).toBe(normalizeFilter(b));
  });

  it("distinguishes different scalar values", () => {
    expect(normalizeFilter({ kinds: [1], since: 5 })).not.toBe(normalizeFilter({ kinds: [1], since: 6 }));
    expect(normalizeFilter({ kinds: [1], limit: 10 })).not.toBe(normalizeFilter({ kinds: [1], limit: 20 }));
  });

  it("ignores explicit undefined values", () => {
    expect(normalizeFilter({ kinds: [1], until: undefined } as Filter)).toBe(normalizeFilter({ kinds: [1] }));
  });
});

describe("subscriptionKey", () => {
  it("matches when relays differ only in order/case/dedup", () => {
    const f: Filter = { kinds: [1], "#p": ["p1"] } as Filter;
    const k1 = subscriptionKey(["wss://a.example", "wss://b.example"], f);
    const k2 = subscriptionKey(["wss://B.example/", "wss://a.example", "wss://a.example"], f);
    expect(k1).toBe(k2);
  });

  it("differs when the relay set differs", () => {
    const f: Filter = { kinds: [1] };
    expect(subscriptionKey(["wss://a.example"], f)).not.toBe(subscriptionKey(["wss://c.example"], f));
  });

  it("differs when the filter differs (e.g. since window)", () => {
    const rels = ["wss://a.example"];
    expect(subscriptionKey(rels, { kinds: [1], since: 100 })).not.toBe(subscriptionKey(rels, { kinds: [1], since: 200 }));
  });

  it("treats a single filter and a one-element array identically", () => {
    const rels = ["wss://a.example"];
    const f: Filter = { kinds: [1] };
    expect(subscriptionKey(rels, f)).toBe(subscriptionKey(rels, [f]));
  });

  it("is independent of filter order within a multi-filter array", () => {
    const rels = ["wss://a.example"];
    const f1: Filter = { kinds: [1] };
    const f2: Filter = { kinds: [7] };
    expect(subscriptionKey(rels, [f1, f2])).toBe(subscriptionKey(rels, [f2, f1]));
  });
});
