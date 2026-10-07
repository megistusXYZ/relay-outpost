/**
 * The device list in Postgres (push_devices), so a restart forgets nobody.
 * Same contract as memoryPushStore (push-devices.ts).
 */
import { arrayContains, eq, isNotNull } from "drizzle-orm";
import { pushDevices } from "@shared/schema";
import { db } from "../db";
import type { PushDevice, PushDeviceStore } from "./push-devices";

const toDevice = (r: typeof pushDevices.$inferSelect): PushDevice => ({
  endpoint: r.endpoint,
  keys: { p256dh: r.p256dh, auth: r.auth },
  watch: r.watch,
  inboxRelays: r.inboxRelays,
  rooms: r.rooms,
  updatedAt: r.updatedAt.getTime(),
});

export function dbPushStore(): PushDeviceStore {
  return {
    async get(endpoint) {
      const [r] = await db.select().from(pushDevices).where(eq(pushDevices.endpoint, endpoint)).limit(1);
      return r ? toDevice(r) : null;
    },
    async put(d) {
      const row = { endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth, watch: d.watch, inboxRelays: d.inboxRelays, rooms: d.rooms, updatedAt: new Date(d.updatedAt) };
      await db.insert(pushDevices).values(row).onConflictDoUpdate({ target: pushDevices.endpoint, set: row });
    },
    async remove(endpoint) {
      await db.delete(pushDevices).where(eq(pushDevices.endpoint, endpoint));
    },
    async inRoom(room) {
      return (await db.select().from(pushDevices).where(arrayContains(pushDevices.rooms, [room]))).map(toDevice);
    },
    async watching(pubkey) {
      return (await db.select().from(pushDevices).where(eq(pushDevices.watch, pubkey))).map(toDevice);
    },
    async allWatching() {
      return (await db.select().from(pushDevices).where(isNotNull(pushDevices.watch))).map(toDevice);
    },
  };
}
