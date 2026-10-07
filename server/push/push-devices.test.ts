/**
 * Signing up a device for notifications when the app is closed (owner,
 * 2026-10-06). Our server is a doorbell: it keeps only the device's push
 * address and what to ring it for, and forgets everything when asked.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { registerPushRoutes, memoryPushStore, type PushDeviceStore } from "./push-devices";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

async function start(store: PushDeviceStore) {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  registerPushRoutes(app, { store });
  server = app.listen(0);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const nip98 = (sk: Uint8Array, url: string, method: string) => {
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", url], ["method", method]], content: "" }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
};
const post = (url: string, body: unknown, auth?: string) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });

describe("signing up a device for messages", () => {
  it("watches your messages only when you sign the request with your own key", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    const me = generateSecretKey();
    const url = `${base}/api/push/device`;
    const body = { subscription: { endpoint: ENDPOINT, keys: KEYS }, watch: { pubkey: getPublicKey(me), inboxRelays: ["wss://inbox.example"] } };

    expect((await post(url, body)).status).toBe(401);
    // Someone else's signature can't sign you up: they'd learn when you get messages.
    expect((await post(url, body, nip98(generateSecretKey(), url, "POST"))).status).toBe(403);
    expect(await store.get(ENDPOINT)).toBeNull();

    expect((await post(url, body, nip98(me, url, "POST"))).status).toBe(204);
    expect(await store.get(ENDPOINT)).toMatchObject({ endpoint: ENDPOINT, watch: getPublicKey(me), inboxRelays: ["wss://inbox.example"], rooms: [] });
  });

  it("forgets the device entirely when asked", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    const me = generateSecretKey();
    const url = `${base}/api/push/device`;
    await post(url, { subscription: { endpoint: ENDPOINT, keys: KEYS }, watch: { pubkey: getPublicKey(me), inboxRelays: [] } }, nip98(me, url, "POST"));
    const res = await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: ENDPOINT }) });
    expect(res.status).toBe(204);
    expect(await store.get(ENDPOINT)).toBeNull();
  });
});

describe("signing up a device for calls", () => {
  // A room's call key is held only by its members; the device proves it holds
  // each room's key by signing its own push address with it.
  const roomKey = () => { const sk = generateSecretKey(); return { sk, room: getPublicKey(sk) }; };
  const proof = (sk: Uint8Array, endpoint: string) => bytesToHex(schnorr.sign(sha256(utf8ToBytes(`concord-push:${endpoint}`)), sk));

  it("rings for a room only with proof from that room's own key", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    const a = roomKey(), b = roomKey(), stranger = roomKey();
    const res = await post(`${base}/api/push/device`, {
      subscription: { endpoint: ENDPOINT, keys: KEYS },
      rooms: [
        { room: a.room, proof: proof(a.sk, ENDPOINT) },
        { room: b.room, proof: proof(b.sk, ENDPOINT) },
        // Someone who only knows a room's id can't ask to be rung for it.
        { room: stranger.room, proof: proof(generateSecretKey(), ENDPOINT) },
        // A proof made for another device's address doesn't carry over.
        { room: roomKey().room, proof: proof(stranger.sk, "https://fcm.googleapis.com/fcm/send/other") },
      ],
    });
    expect(res.status).toBe(204);
    expect((await store.get(ENDPOINT))?.rooms.sort()).toEqual([a.room, b.room].sort());
    expect((await store.inRoom(a.room)).map((d) => d.endpoint)).toEqual([ENDPOINT]);
  });
});

describe("only real push services", () => {
  // Our server sends to whatever address a device gives it, so it must only
  // ever be a real push service — never an address inside a network.
  it("refuses a push address that isn't Google's, Mozilla's, Apple's or Microsoft's", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    for (const endpoint of ["https://127.0.0.1/x", "http://fcm.googleapis.com/fcm/send/a", "https://evil.example/push", "https://fcm.googleapis.com.evil.example/x", "https://metadata.internal/x"]) {
      expect((await post(`${base}/api/push/device`, { subscription: { endpoint, keys: KEYS } })).status).toBe(400);
    }
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/wpush/v2/a", "https://web.push.apple.com/a", "https://wns2-par02p.notify.windows.com/w/?token=a"]) {
      expect((await post(`${base}/api/push/device`, { subscription: { endpoint, keys: KEYS } })).status).toBe(204);
    }
  });

  it("keeps only real inbox relays, at most ten", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    const me = generateSecretKey();
    const url = `${base}/api/push/device`;
    const relays = ["wss://inbox.example", "ws://plain.example", "wss://localhost:7777", "not a url", ...Array.from({ length: 12 }, (_, i) => `wss://r${i}.example`)];
    await post(url, { subscription: { endpoint: ENDPOINT, keys: KEYS }, watch: { pubkey: getPublicKey(me), inboxRelays: relays } }, nip98(me, url, "POST"));
    const saved = (await store.get(ENDPOINT))?.inboxRelays ?? [];
    expect(saved[0]).toBe("wss://inbox.example");
    expect(saved).toHaveLength(10);
    expect(saved.some((r) => r.startsWith("ws:") || r.includes("localhost"))).toBe(false);
  });
});

describe("keeping a device's rooms current", () => {
  it("updates the rooms without a new signature, and keeps the message watch it already has", async () => {
    const store = memoryPushStore();
    const base = await start(store);
    const me = generateSecretKey();
    const url = `${base}/api/push/device`;
    await post(url, { subscription: { endpoint: ENDPOINT, keys: KEYS }, watch: { pubkey: getPublicKey(me), inboxRelays: ["wss://inbox.example"] } }, nip98(me, url, "POST"));
    const sk = generateSecretKey();
    const proof = bytesToHex(schnorr.sign(sha256(utf8ToBytes(`concord-push:${ENDPOINT}`)), sk));
    expect((await post(url, { subscription: { endpoint: ENDPOINT, keys: KEYS }, keepWatch: true, rooms: [{ room: getPublicKey(sk), proof }] })).status).toBe(204);
    expect(await store.get(ENDPOINT)).toMatchObject({ watch: getPublicKey(me), inboxRelays: ["wss://inbox.example"], rooms: [getPublicKey(sk)] });
  });
});
