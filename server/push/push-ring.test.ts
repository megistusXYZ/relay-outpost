/**
 * Ringing a closed app (owner, 2026-10-06): when the first seat in a room is
 * taken on our call service, the devices registered for that room ring once.
 * The push says only "a call, in room <id>"; the phone finds the group's name
 * itself. A ring that can't arrive within 30 seconds is dropped, not late.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { memoryPushStore, type PushDevice } from "./push-devices";
import { createRinger, type PushSend } from "./push-ring";

const device = (endpoint: string, rooms: string[]): PushDevice => ({
  endpoint, keys: { p256dh: "p", auth: "a" }, watch: null, inboxRelays: [], rooms, updatedAt: 0,
});

let server: Server | null = null;
const saved = { ...process.env };
afterEach(() => { server?.close(); server = null; process.env = { ...saved }; });

describe("a call starting rings the room's devices", () => {
  it("rings once when the first seat is taken; a second person joining doesn't ring again", async () => {
    process.env.LIVEKIT_API_KEY = "APItest";
    process.env.LIVEKIT_API_SECRET = "s".repeat(48);
    process.env.LIVEKIT_URL = "wss://livekit.example";
    const roomSk = generateSecretKey();
    const room = getPublicKey(roomSk);
    const store = memoryPushStore();
    await store.put(device("https://fcm.googleapis.com/fcm/send/in-room", [room]));
    await store.put(device("https://fcm.googleapis.com/fcm/send/elsewhere", ["b".repeat(64)]));
    const sent: Array<{ endpoint: string; payload: unknown; ttl: number; urgency: string }> = [];
    const send: PushSend = async (d, payload, o) => { sent.push({ endpoint: d.endpoint, payload: JSON.parse(payload), ttl: o.ttl, urgency: o.urgency }); return "sent"; };

    const express = (await import("express")).default;
    const { registerConcordAvRoutes } = await import("../concord-av");
    const { createCallCapacity } = await import("../call-capacity");
    const app = express();
    const ringer = createRinger({ store, send });
    registerConcordAvRoutes(app, {
      ownOrigins: [],
      capacity: createCallCapacity({ maxCalls: 50, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set() }),
      onCallStarted: (r) => ringer.ringRoom(r),
    });
    server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const seat = async () => {
      const url = `${base}/.well-known/concord/av/${room}`;
      const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", url], ["method", "GET"], ["nonce", randomBytes(32).toString("hex")]], content: "" }, roomSk);
      return fetch(url, { headers: { Authorization: `Concord ${Buffer.from(JSON.stringify(ev)).toString("base64")}` } });
    };

    expect((await seat()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/in-room", payload: { t: "call", room }, ttl: 30, urgency: "high" }]);

    expect((await seat()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
  });

  it("forgets a device its push service says is gone", async () => {
    const store = memoryPushStore();
    await store.put(device("https://fcm.googleapis.com/fcm/send/gone", ["c".repeat(64)]));
    const ringer = createRinger({ store, send: async () => "gone" });
    await ringer.ringRoom("c".repeat(64));
    expect(await store.get("https://fcm.googleapis.com/fcm/send/gone")).toBeNull();
  });
});
