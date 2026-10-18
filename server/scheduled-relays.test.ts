/**
 * Scheduled posts are published later by this server, which opens a socket to
 * each relay the person chose. So a relay address is checked twice: its shape
 * when the post is scheduled, and where its name points when the server
 * actually connects (a public name can be pointed at a private address later).
 */
import { describe, it, expect } from "vitest";
import { isSchedulableRelayUrl, connectScheduledRelay } from "./scheduled-relays";

describe("isSchedulableRelayUrl", () => {
  it("accepts ordinary relay addresses", () => {
    for (const u of ["wss://relay.damus.io", "wss://nos.lol/", "wss://relay.example.com:7777/path", "ws://relay.example.org"]) {
      expect(isSchedulableRelayUrl(u), u).toBe(true);
    }
  });

  it("refuses an address whose real host hides behind a user part", () => {
    expect(isSchedulableRelayUrl("wss://relay.example.com@127.0.0.1/")).toBe(false);
    expect(isSchedulableRelayUrl("wss://user:pass@relay.example.com/")).toBe(false);
  });

  it("refuses local names, bare addresses and other schemes", () => {
    for (const u of ["wss://localhost", "wss://127.0.0.1", "wss://[::1]/", "wss://10.0.0.5", "wss://printer.local", "https://relay.example.com", "wss://intranet", "not a url", 42]) {
      expect(isSchedulableRelayUrl(u as string), String(u)).toBe(false);
    }
  });
});

describe("connectScheduledRelay", () => {
  it("connects only when the name points somewhere public", async () => {
    const connected: string[] = [];
    const deps = {
      isPublicHost: async (h: string) => h === "relay.example.com",
      connect: async (u: string) => { connected.push(u); return { url: u } as never; },
    };
    expect(await connectScheduledRelay("wss://relay.example.com", deps)).not.toBeNull();
    expect(await connectScheduledRelay("wss://rebound.example.com", deps)).toBeNull();
    expect(await connectScheduledRelay("wss://relay.example.com@127.0.0.1", deps)).toBeNull();
    expect(connected).toEqual(["wss://relay.example.com"]);
  });
});
