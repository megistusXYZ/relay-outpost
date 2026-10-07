/**
 * Message alerts for a closed app (owner, 2026-10-06). Our server listens on
 * your inbox relays for sealed messages addressed to your key — it can't see
 * who sent them or what they say — and alerts your devices: "New message".
 * A flood costs one alert a quarter-hour: more within 15 minutes add nothing,
 * and the next alert after that says "New messages".
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import { generateSecretKey, getPublicKey, type Event } from "nostr-tools";
import { wrapEvent } from "nostr-tools/nip59";
import { memoryPushStore, type PushDevice } from "./push-devices";
import { createMessageWatcher } from "./push-messages";
import type { PushSend } from "./push-ring";

/** A relay in this process: stores nothing, streams each new event to matching subscriptions. */
function localRelay() {
  const wss = new WebSocketServer({ port: 0 });
  const subs = new Set<{ ws: import("ws").WebSocket; id: string; filters: Array<Record<string, unknown>> }>();
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === "REQ") { subs.add({ ws, id: msg[1], filters: msg.slice(2) }); ws.send(JSON.stringify(["EOSE", msg[1]])); }
      if (msg[0] === "CLOSE") for (const s of subs) if (s.ws === ws && s.id === msg[1]) subs.delete(s);
    });
    ws.on("close", () => { for (const s of subs) if (s.ws === ws) subs.delete(s); });
  });
  const matches = (f: Record<string, unknown>, e: Event) =>
    (!f.kinds || (f.kinds as number[]).includes(e.kind)) &&
    (!f["#p"] || e.tags.some((t) => t[0] === "p" && (f["#p"] as string[]).includes(t[1])));
  return {
    url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}`,
    publish(e: Event) { for (const s of subs) if (s.filters.some((f) => matches(f, e))) s.ws.send(JSON.stringify(["EVENT", s.id, e])); },
    subscribers: () => subs.size,
    close: () => wss.close(),
  };
}

const sealedTo = (recipient: string) => wrapEvent({ kind: 14, content: "hi", tags: [["p", recipient]], created_at: Math.floor(Date.now() / 1000) }, generateSecretKey(), recipient);
const until = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); };

let cleanup: Array<() => void> = [];
afterEach(() => { for (const c of cleanup) c(); cleanup = []; });

describe("message alerts", () => {
  it("alerts once for a sealed message to you, then at most once a quarter-hour", async () => {
    const relay = localRelay();
    const me = getPublicKey(generateSecretKey());
    const store = memoryPushStore();
    const phone: PushDevice = { endpoint: "https://fcm.googleapis.com/fcm/send/phone", keys: { p256dh: "p", auth: "a" }, watch: me, inboxRelays: [relay.url], rooms: [], updatedAt: 0 };
    await store.put(phone);
    const sent: Array<{ payload: unknown; ttl: number; topic?: string }> = [];
    const send: PushSend = async (_d, payload, o) => { sent.push({ payload: JSON.parse(payload), ttl: o.ttl, topic: o.topic }); return "sent"; };
    let clock = 1_789_240_000_000;
    const watcher = createMessageWatcher({ store, send, now: () => clock, allowLocalRelays: true });
    cleanup.push(() => watcher.stop(), () => relay.close());
    await watcher.refresh();
    await until(() => relay.subscribers() > 0);

    relay.publish(sealedTo(me));
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ payload: { t: "msg", more: false }, ttl: 86400, topic: "messages" }]);

    // A flood within 15 minutes adds nothing.
    clock += 60_000;
    relay.publish(sealedTo(me));
    relay.publish(sealedTo(me));
    // Someone else's messages never ring this phone.
    relay.publish(sealedTo(getPublicKey(generateSecretKey())));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(1);

    // After a quarter-hour, the next one says there's more.
    clock += 15 * 60_000;
    relay.publish(sealedTo(me));
    await until(() => sent.length > 1);
    expect(sent[1]).toEqual({ payload: { t: "msg", more: true }, ttl: 86400, topic: "messages" });
  });

  it("stops listening for a device that turned notifications off", async () => {
    const relay = localRelay();
    const me = getPublicKey(generateSecretKey());
    const store = memoryPushStore();
    await store.put({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" }, watch: me, inboxRelays: [relay.url], rooms: [], updatedAt: 0 });
    const watcher = createMessageWatcher({ store, send: async () => "sent", allowLocalRelays: true });
    cleanup.push(() => watcher.stop(), () => relay.close());
    await watcher.refresh();
    await until(() => relay.subscribers() > 0);
    await store.remove("https://fcm.googleapis.com/fcm/send/x");
    await watcher.refresh();
    await until(() => relay.subscribers() === 0);
    expect(relay.subscribers()).toBe(0);
  });
});
