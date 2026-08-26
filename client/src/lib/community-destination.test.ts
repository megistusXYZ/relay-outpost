import { describe, it, expect } from "vitest";
import { buildDestinationLabel, relayHostname } from "./community-destination";

describe("relayHostname", () => {
  it("strips the wss:// scheme", () => {
    expect(relayHostname("wss://relay-op.nostr1.com")).toBe("relay-op.nostr1.com");
  });
  it("strips the ws:// scheme and trailing slashes", () => {
    expect(relayHostname("ws://relay.example.com/")).toBe("relay.example.com");
  });
});

describe("buildDestinationLabel", () => {
  it("uses the community name when present", () => {
    expect(
      buildDestinationLabel({ communityName: "Relay Outpost", relayUrl: "wss://relay-op.nostr1.com" }),
    ).toBe("Relay Outpost");
  });

  it("appends '+ your feed' when also sharing to feed", () => {
    expect(
      buildDestinationLabel({
        communityName: "Relay Outpost",
        relayUrl: "wss://relay-op.nostr1.com",
        alsoShareToFeed: true,
      }),
    ).toBe("Relay Outpost + your feed");
  });

  it("falls back to the relay hostname when no name is resolvable", () => {
    expect(buildDestinationLabel({ communityName: null, relayUrl: "wss://relay-op.nostr1.com" })).toBe(
      "relay-op.nostr1.com",
    );
  });

  it("treats a blank/whitespace name as no name", () => {
    expect(buildDestinationLabel({ communityName: "   ", relayUrl: "wss://relay-op.nostr1.com" })).toBe(
      "relay-op.nostr1.com",
    );
  });

  it("falls back to hostname + feed suffix when no name and sharing to feed", () => {
    expect(
      buildDestinationLabel({ relayUrl: "wss://relay-op.nostr1.com", alsoShareToFeed: true }),
    ).toBe("relay-op.nostr1.com + your feed");
  });
});
