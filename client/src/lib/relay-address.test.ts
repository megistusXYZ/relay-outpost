import { describe, it, expect } from "vitest";
import { normalizeRelayAddress } from "./relay-address";

describe("reading a relay address someone pasted", () => {
  it("takes a bare host, a web address or a relay address alike", () => {
    expect(normalizeRelayAddress("relay-op.nostr1.com")).toBe("wss://relay-op.nostr1.com");
    expect(normalizeRelayAddress("https://relay-op.nostr1.com/")).toBe("wss://relay-op.nostr1.com");
    expect(normalizeRelayAddress("  wss://relay-op.nostr1.com// ")).toBe("wss://relay-op.nostr1.com");
  });

  it("keeps a path, which some relays live under", () => {
    expect(normalizeRelayAddress("wss://haven.example.com/chat")).toBe("wss://haven.example.com/chat");
  });

  it("refuses what isn't an address", () => {
    expect(normalizeRelayAddress("")).toBeNull();
    expect(normalizeRelayAddress("my relay")).toBeNull();
    expect(normalizeRelayAddress("relay")).toBeNull();
  });
});
