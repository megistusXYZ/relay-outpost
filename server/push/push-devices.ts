/**
 * Notifications when the app is closed (owner, 2026-10-06): signing up a
 * device. push-devices.test.ts.
 *
 * Our server is a doorbell. It keeps only a device's push address and what to
 * ring it for — your key, to hear that a sealed message arrived for you (never
 * who sent it or what it says), and the anonymous call rooms you're in — and
 * forgets all of it when the device turns notifications off.
 *
 *  - Watching your messages needs a request signed with your own key:
 *    otherwise anyone could learn when you get messages.
 *  - Being rung for a call room needs proof from that room's own key (held
 *    only by its members): its signature over this device's push address.
 *  - Push addresses must be a real push service's: our server sends to
 *    whatever it is given, so never an address inside a network.
 */
import type { Express, Request, Response } from "express";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyNip98 } from "../nip98-auth";
import { isJunkRelay } from "../../shared/relay-junk";

export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The key whose sealed messages ring this device; null for calls only. */
  watch: string | null;
  /** Where that key's messages arrive (its inbox relays). */
  inboxRelays: string[];
  /** Call rooms (voice keys' public keys) that ring this device. */
  rooms: string[];
  updatedAt: number;
}

export interface PushDeviceStore {
  get(endpoint: string): Promise<PushDevice | null>;
  put(device: PushDevice): Promise<void>;
  remove(endpoint: string): Promise<void>;
  /** Devices to ring for a call starting in this room. */
  inRoom(room: string): Promise<PushDevice[]>;
  /** Devices that hear about this key's messages. */
  watching(pubkey: string): Promise<PushDevice[]>;
  /** Every device watching messages (to know which inboxes to listen to). */
  allWatching(): Promise<PushDevice[]>;
}

export function memoryPushStore(): PushDeviceStore {
  const devices = new Map<string, PushDevice>();
  return {
    async get(endpoint) { return devices.get(endpoint) ?? null; },
    async put(device) { devices.set(device.endpoint, device); },
    async remove(endpoint) { devices.delete(endpoint); },
    async inRoom(room) { return [...devices.values()].filter((d) => d.rooms.includes(room)); },
    async watching(pubkey) { return [...devices.values()].filter((d) => d.watch === pubkey); },
    async allWatching() { return [...devices.values()].filter((d) => d.watch !== null); },
  };
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_ROOMS = 200;
const MAX_INBOX_RELAYS = 10;

/** Google (Chrome, Android), Mozilla (Firefox), Apple (Safari, iPhone), Microsoft (Edge). */
export function isPushService(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com"
    || h === "web.push.apple.com" || h.endsWith(".push.apple.com") || h.endsWith(".notify.windows.com");
}

/** The device's proof that it holds a room's key: that key's signature over its push address. */
export function roomProofMessage(endpoint: string): Uint8Array {
  return sha256(utf8ToBytes(`concord-push:${endpoint}`));
}

function provenRooms(raw: unknown, endpoint: string): string[] {
  if (!Array.isArray(raw)) return [];
  const msg = roomProofMessage(endpoint);
  const out: string[] = [];
  for (const entry of raw.slice(0, MAX_ROOMS)) {
    const room = typeof entry?.room === "string" ? entry.room.toLowerCase() : "";
    const proof = typeof entry?.proof === "string" ? entry.proof : "";
    if (!HEX64.test(room) || !/^[0-9a-f]{128}$/i.test(proof) || out.includes(room)) continue;
    try { if (schnorr.verify(hexToBytes(proof), msg, hexToBytes(room))) out.push(room); } catch { /* not a proof */ }
  }
  return out;
}

function readSubscription(body: unknown): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const s = (body as { subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } })?.subscription;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

export function registerPushRoutes(app: Express, opts: {
  store: PushDeviceStore;
  onChange?: () => void;
  /** Our push key (VAPID public key), which a device subscribes with; none when push isn't set up. */
  publicKey?: string | null;
}): void {
  const { store } = opts;

  app.get("/api/push/key", (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    if (!opts.publicKey) return res.status(503).json({ error: "Notifications aren't set up on this server" });
    return res.json({ publicKey: opts.publicKey });
  });

  app.post("/api/push/device", async (req: Request, res: Response) => {
    const subscription = readSubscription(req.body);
    if (!subscription) return res.status(400).json({ error: "Expected a push subscription" });
    if (!isPushService(subscription.endpoint)) return res.status(400).json({ error: "That isn't a push service this server sends to" });

    const watchIn = (req.body as { watch?: { pubkey?: unknown; inboxRelays?: unknown } }).watch;
    let watch: string | null = null;
    let inboxRelays: string[] = [];
    if (watchIn) {
      const pubkey = typeof watchIn.pubkey === "string" ? watchIn.pubkey.toLowerCase() : "";
      if (!HEX64.test(pubkey)) return res.status(400).json({ error: "Expected the key to watch" });
      const who = verifyNip98(req);
      if ("error" in who) return res.status(who.status).json({ error: who.error });
      if (who.pubkey.toLowerCase() !== pubkey) return res.status(403).json({ error: "Only you can ask to hear about your messages" });
      watch = pubkey;
      inboxRelays = Array.isArray(watchIn.inboxRelays)
        ? [...new Set(watchIn.inboxRelays.filter((r): r is string => typeof r === "string" && !isJunkRelay(r)))].slice(0, MAX_INBOX_RELAYS)
        : [];
    }
    else if ((req.body as { keepWatch?: unknown }).keepWatch === true) {
      // Only the rooms changed (a mute, a new group): the message watch this
      // device was signed up for stays, without asking for a signature again.
      const before = await store.get(subscription.endpoint);
      watch = before?.watch ?? null;
      inboxRelays = before?.inboxRelays ?? [];
    }

    const rooms = provenRooms((req.body as { rooms?: unknown }).rooms, subscription.endpoint);
    await store.put({ ...subscription, watch, inboxRelays, rooms, updatedAt: Date.now() });
    opts.onChange?.();
    return res.status(204).end();
  });

  app.delete("/api/push/device", async (req: Request, res: Response) => {
    const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
    if (typeof endpoint !== "string") return res.status(400).json({ error: "Expected the device's push address" });
    await store.remove(endpoint);
    opts.onChange?.();
    return res.status(204).end();
  });
}
