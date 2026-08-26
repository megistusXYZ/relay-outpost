// NIP-65 relay selection — the pure logic behind getReadRelays/getWriteRelays
// (outbox model). Extracted so it's testable without the relay/eventStore graph.
import { describe, it, expect } from "vitest";
import { selectRelaysByMode, type RelayPreference } from "./relay-prefs";

const prefs: RelayPreference[] = [
  { url: "wss://read-only.example", mode: "read" },
  { url: "wss://write-only.example", mode: "write" },
  { url: "wss://both.example", mode: "both" },
];

describe("selectRelaysByMode (NIP-65)", () => {
  it("write mode returns write + both relays (not read-only)", () => {
    expect(selectRelaysByMode(prefs, "write")).toEqual([
      "wss://write-only.example",
      "wss://both.example",
    ]);
  });

  it("read mode returns read + both relays (not write-only)", () => {
    expect(selectRelaysByMode(prefs, "read")).toEqual([
      "wss://read-only.example",
      "wss://both.example",
    ]);
  });

  it("caps the result at the limit (default 5)", () => {
    const many: RelayPreference[] = Array.from({ length: 8 }, (_, i) => ({
      url: `wss://r${i}.example`,
      mode: "both" as const,
    }));
    expect(selectRelaysByMode(many, "write")).toHaveLength(5);
    expect(selectRelaysByMode(many, "write", 2)).toHaveLength(2);
  });

  it("returns [] for empty/undefined prefs (caller applies fallback)", () => {
    expect(selectRelaysByMode([], "read")).toEqual([]);
    expect(selectRelaysByMode(undefined, "write")).toEqual([]);
  });
});
