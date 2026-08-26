import { describe, it, expect } from "vitest";
import { FEED_KINDS, feedKinds, mediaPageLimit, MEDIA_LIMIT_SHARE } from "./feed-kinds";
import { KIND_PICTURE, KIND_VIDEO, KIND_SHORT_VIDEO } from "./media-frame";

describe("FEED_KINDS", () => {
  it("is exactly this set", () => {
    // Pinned deliberately. Changing what the timeline asks relays for changes
    // what every user sees, so it should take editing a test that says so —
    // not slip in as one more number in a filter literal.
    expect(feedKinds().slice().sort((a, b) => a - b)).toEqual([1, 20, 21, 22, 1068]);
  });

  it("carries the three media kinds", () => {
    expect(FEED_KINDS).toContain(KIND_PICTURE);
    expect(FEED_KINDS).toContain(KIND_VIDEO);
    expect(FEED_KINDS).toContain(KIND_SHORT_VIDEO);
  });

  it("still carries text notes and polls", () => {
    expect(FEED_KINDS).toContain(1);
    expect(FEED_KINDS).toContain(1068);
  });

  it("has no duplicates", () => {
    expect(new Set(FEED_KINDS).size).toBe(FEED_KINDS.length);
  });

  it("reserves a media budget as a share of the page", () => {
    // Measured against live relays: kinds [1,6,20,21,22,1068] with limit 120 in
    // ONE filter returned 117 text, 3 reposts and ZERO media, because NIP-01
    // `limit` is answered with the newest N across all kinds named. Media only
    // gets slots when it has a subscription of its own.
    expect(mediaPageLimit(120)).toBe(Math.round(120 * MEDIA_LIMIT_SHARE));
    expect(mediaPageLimit(30)).toBe(10);
  });

  it("never reserves a zero budget", () => {
    expect(mediaPageLimit(1)).toBeGreaterThanOrEqual(1);
    expect(mediaPageLimit(2)).toBeGreaterThanOrEqual(1);
  });

  it("survives a nonsense page limit rather than requesting zero events", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(mediaPageLimit(bad)).toBeGreaterThanOrEqual(1);
    }
  });

  it("hands out a fresh mutable array each time", () => {
    // Relay filters are handed to nostr-tools and sometimes mutated in place;
    // returning the shared constant would let one subscription's edit leak
    // into every other one.
    const a = feedKinds();
    const b = feedKinds();
    expect(a).not.toBe(b);
    a.push(9999);
    expect(feedKinds()).not.toContain(9999);
    expect(b).not.toContain(9999);
  });
});
