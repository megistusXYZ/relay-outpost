import { describe, it, expect } from "vitest";
import { getMyNotificationRelays, NOTIF_FALLBACK_RELAYS, parseRelayList } from "./outbox";

// getMyNotificationRelays feeds the always-on notification subscription. Its
// load-bearing guarantee is that it NEVER returns an empty list (that would
// silently kill all notifications) and never returns duplicates or an over-cap
// set (that would fan out redundant REQs). The NIP-65 read-relay union is
// exercised live; here we pin the cache-independent safety properties, which
// hold for any pubkey with no cached relay list (the common cold-start case).
const NOBODY = "0".repeat(64); // a pubkey with no cached NIP-65 list

describe("getMyNotificationRelays", () => {
  it("never returns an empty list, even with no cached relay list", () => {
    const relays = getMyNotificationRelays(NOBODY);
    expect(relays.length).toBeGreaterThan(0);
  });

  it("falls back to the popular set when the user has no NIP-65 read relays", () => {
    const relays = getMyNotificationRelays(NOBODY);
    // Every returned relay is a known fallback (no NIP-65 read relays to union in).
    for (const r of relays) expect(NOTIF_FALLBACK_RELAYS).toContain(r);
    // And it surfaces the fallbacks rather than dropping them.
    expect(relays.length).toBe(NOTIF_FALLBACK_RELAYS.length);
  });

  it("never returns duplicates", () => {
    const relays = getMyNotificationRelays(NOBODY);
    expect(new Set(relays).size).toBe(relays.length);
  });

  it("honors the max cap", () => {
    expect(getMyNotificationRelays(NOBODY, 2).length).toBeLessThanOrEqual(2);
    expect(getMyNotificationRelays(NOBODY, 2).length).toBeGreaterThan(0);
  });
});

describe("parseRelayList rejects malformed relay URLs", () => {
  const ev = (urls: string[]) => ({ tags: urls.map(u => ["r", u]) }) as any;

  it("the literal 'wss://' (no host) is dropped — it crashed new URL() on profiles", () => {
    expect(parseRelayList(ev(["wss://"]))).toEqual([]);
    expect(parseRelayList(ev(["wss:// "]))).toEqual([]);
  });

  it("valid relays still parse", () => {
    expect(parseRelayList(ev(["wss://relay.damus.io"]))).toEqual([{ url: "wss://relay.damus.io", mode: "both" }]);
  });

  it("garbage that merely starts with wss:// is dropped", () => {
    expect(parseRelayList(ev(["wss://?", "wss://#x"]))).toEqual([]);
  });
});
