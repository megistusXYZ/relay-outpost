/**
 * Delivering a push (owner, 2026-10-06). push-send.test.ts.
 *
 * Encrypted to the device (Web Push, RFC 8291: the push service carries it but
 * can't read it), signed as ours (VAPID), with the expiry and urgency given.
 * Keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, a cluster secret like
 * the call service's.
 */
import webpush from "web-push";
import type { Agent } from "node:https";
import type { PushSend } from "./push-ring";

export interface VapidKeys { publicKey: string; privateKey: string; subject: string }

export function webPushSend(vapid: VapidKeys, opts: { agent?: Agent } = {}): PushSend {
  return async (device, payload, push) => {
    try {
      await webpush.sendNotification({ endpoint: device.endpoint, keys: device.keys }, payload, {
        TTL: push.ttl,
        urgency: push.urgency,
        ...(push.topic ? { topic: push.topic } : {}),
        vapidDetails: vapid,
        timeout: 10_000,
        ...(opts.agent ? { agent: opts.agent } : {}),
      });
      return "sent";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

/** The keys from the environment, or null when push isn't set up here. */
export function vapidFromEnv(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "", privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "https://relayop.xyz" };
}
