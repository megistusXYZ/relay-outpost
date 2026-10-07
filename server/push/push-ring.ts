/**
 * Ringing a closed app (owner, 2026-10-06). push-ring.test.ts.
 *
 * When the first seat in a room is taken on our call service, every device
 * registered for that room gets one push. It says only "a call, in room
 * <id>": the phone looks the group's name up itself, so our server never
 * learns it. A ring that can't arrive within 30 seconds is dropped rather
 * than ringing late.
 */
import type { PushDevice, PushDeviceStore } from "./push-devices";

export type PushResult = "sent" | "gone" | "failed";
/** Deliver one push to a device. "gone": its push service says it no longer exists. */
export type PushSend = (device: PushDevice, payload: string, opts: { ttl: number; urgency: "high" | "normal"; topic?: string }) => Promise<PushResult>;

export const RING_TTL_SECONDS = 30;

export function createRinger(o: { store: PushDeviceStore; send: PushSend }) {
  return {
    async ringRoom(room: string): Promise<void> {
      const devices = await o.store.inRoom(room);
      const payload = JSON.stringify({ t: "call", room });
      await Promise.all(devices.map(async (d) => {
        const r = await o.send(d, payload, { ttl: RING_TTL_SECONDS, urgency: "high" }).catch((): PushResult => "failed");
        if (r === "gone") await o.store.remove(d.endpoint).catch(() => {});
      }));
    },
  };
}
