import { describe, it, expect } from "vitest";
import { buildRelayListTags, normalizeRouteUrl } from "./relay-routing";

describe("normalizeRouteUrl", () => {
  it("adds wss:// when no protocol", () => {
    expect(normalizeRouteUrl("relay.damus.io")).toBe("wss://relay.damus.io");
  });
  it("keeps an existing protocol and strips trailing slashes", () => {
    expect(normalizeRouteUrl("wss://nos.lol/")).toBe("wss://nos.lol");
    expect(normalizeRouteUrl("ws://localhost:7777//")).toBe("ws://localhost:7777");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeRouteUrl("   ")).toBe("");
  });
});

describe("buildRelayListTags", () => {
  it("emits a bare r-tag for read+write relays", () => {
    expect(buildRelayListTags([{ url: "wss://a.com", read: true, write: true }])).toEqual([
      ["r", "wss://a.com"],
    ]);
  });

  it("marks read-only and write-only relays", () => {
    expect(
      buildRelayListTags([
        { url: "wss://in.com", read: true, write: false },
        { url: "wss://out.com", read: false, write: true },
      ]),
    ).toEqual([
      ["r", "wss://in.com", "read"],
      ["r", "wss://out.com", "write"],
    ]);
  });

  it("merges duplicate urls into one tag, OR-ing roles", () => {
    expect(
      buildRelayListTags([
        { url: "wss://x.com", read: true, write: false },
        { url: "wss://x.com/", read: false, write: true },
      ]),
    ).toEqual([["r", "wss://x.com"]]);
  });

  it("drops entries with no role and blank urls", () => {
    expect(
      buildRelayListTags([
        { url: "wss://keep.com", read: true, write: false },
        { url: "wss://drop.com", read: false, write: false },
        { url: "   ", read: true, write: true },
      ]),
    ).toEqual([["r", "wss://keep.com", "read"]]);
  });

  it("normalizes bare hostnames to wss://", () => {
    expect(buildRelayListTags([{ url: "relay.example", read: true, write: true }])).toEqual([
      ["r", "wss://relay.example"],
    ]);
  });

  it("returns an empty array for empty input (caller must guard against publishing this)", () => {
    expect(buildRelayListTags([])).toEqual([]);
  });
});
