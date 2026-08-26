import { describe, it, expect } from "vitest";
import { relayCooldownMs, isValidRelayUrl, sanitizeRelayUrls } from "./relay-health";

const MIN = 60 * 1000;

describe("isValidRelayUrl", () => {
  it("accepts well-formed ws/wss relay URLs", () => {
    expect(isValidRelayUrl("wss://relay.damus.io")).toBe(true);
    expect(isValidRelayUrl("wss://relay.example.com/")).toBe(true);
    expect(isValidRelayUrl("ws://localhost:7777")).toBe(true);
  });

  it("accepts a bare host (scheme assumed, matching nostr-tools)", () => {
    expect(isValidRelayUrl("relay.example.com")).toBe(true);
  });

  it("rejects the empty-host forms that throw 'Invalid URL: wss://'", () => {
    expect(isValidRelayUrl("wss://")).toBe(false);
    expect(isValidRelayUrl("ws://")).toBe(false);
    expect(isValidRelayUrl("")).toBe(false);
    expect(isValidRelayUrl("   ")).toBe(false);
  });

  it("rejects non-string / non-ws garbage", () => {
    expect(isValidRelayUrl(undefined as unknown as string)).toBe(false);
    expect(isValidRelayUrl("https://example.com" as string)).toBe(false);
  });
});

describe("sanitizeRelayUrls", () => {
  it("drops malformed entries and keeps the valid originals verbatim", () => {
    expect(
      sanitizeRelayUrls(["wss://relay.damus.io", "wss://", "", "wss://nos.lol"]),
    ).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });
});

describe("relayCooldownMs (per-relay backoff curve)", () => {
  it("escalates 3 → 5 → 10 minutes over consecutive failures", () => {
    expect(relayCooldownMs(1)).toBe(3 * MIN);
    expect(relayCooldownMs(2)).toBe(5 * MIN);
    expect(relayCooldownMs(3)).toBe(10 * MIN);
  });

  it("caps at 10 minutes for further failures", () => {
    expect(relayCooldownMs(4)).toBe(10 * MIN);
    expect(relayCooldownMs(50)).toBe(10 * MIN);
  });

  it("treats a zero/negative failure count as the first-failure floor", () => {
    expect(relayCooldownMs(0)).toBe(3 * MIN);
    expect(relayCooldownMs(-1)).toBe(3 * MIN);
  });

  it("is monotonically non-decreasing", () => {
    let prev = 0;
    for (let f = 0; f <= 12; f++) {
      const c = relayCooldownMs(f);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});
