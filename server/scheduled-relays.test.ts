/**
 * Scheduled posts are published later by this server, which opens a socket to
 * each relay the person chose. So a relay address is checked twice: its shape
 * when the post is scheduled, and where its name points when the server
 * actually connects (a public name can be pointed at a private address later).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "net";
import WebSocket, { WebSocketServer } from "ws";
import { Relay } from "nostr-tools";
import { isSchedulableRelayUrl, connectScheduledRelay, openRelay, type RelayOptions } from "./scheduled-relays";

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

  // One scheduler run publishes one batch at a time, and the next run waits for
  // it. A relay that never finished connecting held that run forever, so no one's
  // scheduled post went out again until the server restarted.
  it("gives up on a relay that never finishes connecting, within the time limit", async () => {
    const deps = { isPublicHost: async () => true, connect: () => new Promise<never>(() => {}) };
    const t0 = Date.now();
    await expect(connectScheduledRelay("wss://relay.example.com", deps, 300)).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("closes a relay that connects only after it was given up on", async () => {
    let closed = false;
    const late = { url: "wss://slow.example.com", close: () => { closed = true; } };
    const deps = { isPublicHost: async () => true, connect: () => new Promise<never>((ok) => setTimeout(() => ok(late as never), 500)) };
    await expect(connectScheduledRelay("wss://slow.example.com", deps, 100)).rejects.toThrow(/timed out/);
    await new Promise((r) => setTimeout(r, 700));
    expect(closed).toBe(true);
  });
});

describe("openRelay, on a real socket", () => {
  // A host that accepts the connection and never answers the WebSocket upgrade.
  const held: net.Socket[] = [];
  let tarpit: net.Server;
  let tarpitUrl = "";
  // A relay that answers normally.
  let relay: WebSocketServer;
  let relayUrl = "";

  const gone = new WeakSet<net.Socket>();
  beforeAll(async () => {
    // Reads (and discards) what arrives, so it sees the other end hang up.
    tarpit = net.createServer((s) => { held.push(s); s.on("error", () => {}); s.on("data", () => {}); s.on("close", () => gone.add(s)); });
    await new Promise<void>((ok) => tarpit.listen(0, "127.0.0.1", ok));
    tarpitUrl = `ws://127.0.0.1:${(tarpit.address() as net.AddressInfo).port}`;
    relay = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((ok) => relay.on("listening", ok));
    relayUrl = `ws://127.0.0.1:${(relay.address() as net.AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const s of held) s.destroy();
    await new Promise((ok) => tarpit.close(ok));
    await new Promise((ok) => relay.close(ok));
  });

  it("the stalling host really stalls a plain connect (or the next check proves nothing)", async () => {
    const plainRelay = new Relay(tarpitUrl, { websocketImplementation: WebSocket as unknown as typeof globalThis.WebSocket } as RelayOptions);
    const plain = plainRelay.connect().then(() => "connected", () => "failed");
    const outcome = await Promise.race([plain, new Promise((ok) => setTimeout(() => ok("still waiting"), 700))]);
    expect(outcome).toBe("still waiting");
    (plainRelay as unknown as { ws?: WebSocket }).ws?.terminate();
  });

  it("gives up on that host within the time limit and lets the socket go", async () => {
    const before = held.length;
    const t0 = Date.now();
    await expect(openRelay(tarpitUrl, 400)).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 300));
    const mine = held.slice(before);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((s) => gone.has(s))).toBe(true);
  });

  it("still connects to a relay that answers", async () => {
    const r = await openRelay(relayUrl, 2000);
    expect(r.connected).toBe(true);
    r.close();
  });
});
