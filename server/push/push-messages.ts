/**
 * Message alerts for a closed app (owner, 2026-10-06). push-messages.test.ts.
 *
 * Listens on the inbox relays of everyone who turned notifications on, for
 * sealed messages (kind 1059 gift wraps) addressed to their key. A sealed
 * message names only its recipient: our server never learns who sent it or
 * what it says, and the alert says only "New message".
 *
 * A flood costs one alert a quarter-hour per device: more within 15 minutes
 * add nothing, and the next alert after that says "New messages". Gift wraps
 * are back-dated on purpose (NIP-59), so this listens for new arrivals
 * (`limit: 0`) rather than by date, and remembers ids it has already seen.
 */
import WebSocket from "ws";
import { verifyEvent, type Event } from "nostr-tools";
import { isJunkRelay } from "../../shared/relay-junk";
import type { PushDevice, PushDeviceStore } from "./push-devices";
import type { PushResult, PushSend } from "./push-ring";

export const MESSAGE_ALERT_GAP_MS = 15 * 60_000;
export const MESSAGE_TTL_SECONDS = 86_400;
const SUB_ID = "ro-push";
const SEEN_KEEP = 5_000;

interface RelayConn { ws: WebSocket | null; pubkeys: Set<string>; retryMs: number; timer?: ReturnType<typeof setTimeout>; wanted: boolean }

export function createMessageWatcher(o: {
  store: PushDeviceStore;
  send: PushSend;
  now?: () => number;
  /** Tests only: a relay on this machine. */
  allowLocalRelays?: boolean;
}) {
  const now = o.now ?? Date.now;
  const conns = new Map<string, RelayConn>();
  const lastAlert = new Map<string, number>();
  const missed = new Set<string>();
  const seen = new Set<string>();

  const req = (c: RelayConn) => {
    if (c.ws?.readyState !== WebSocket.OPEN) return;
    c.ws.send(JSON.stringify(["REQ", SUB_ID, { kinds: [1059], "#p": [...c.pubkeys], limit: 0 }]));
  };

  const connect = (url: string, c: RelayConn) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { return retry(url, c); }
    c.ws = ws;
    ws.on("open", () => { c.retryMs = 5_000; req(c); });
    ws.on("message", (raw) => {
      let msg: unknown;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (Array.isArray(msg) && msg[0] === "EVENT" && msg[1] === SUB_ID) void arrived(msg[2] as Event, c);
    });
    ws.on("error", () => {});
    ws.on("close", () => { if (c.ws === ws) { c.ws = null; retry(url, c); } });
  };

  const retry = (url: string, c: RelayConn) => {
    if (!c.wanted) return;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => { if (c.wanted && !c.ws) connect(url, c); }, c.retryMs);
    c.retryMs = Math.min(c.retryMs * 2, 5 * 60_000);
  };

  const alert = async (d: PushDevice) => {
    const t = now();
    const last = lastAlert.get(d.endpoint);
    if (last !== undefined && t - last < MESSAGE_ALERT_GAP_MS) { missed.add(d.endpoint); return; }
    const more = missed.delete(d.endpoint);
    lastAlert.set(d.endpoint, t);
    const r = await o.send(d, JSON.stringify({ t: "msg", more }), { ttl: MESSAGE_TTL_SECONDS, urgency: "normal", topic: "messages" })
      .catch((): PushResult => "failed");
    if (r === "gone") { await o.store.remove(d.endpoint).catch(() => {}); lastAlert.delete(d.endpoint); }
  };

  const arrived = async (e: Event, c: RelayConn) => {
    if (!e || e.kind !== 1059 || typeof e.id !== "string" || seen.has(e.id)) return;
    if (!verifyEvent(e)) return;
    seen.add(e.id);
    if (seen.size > SEEN_KEEP) seen.delete(seen.values().next().value as string);
    const to = new Set(e.tags.filter((t) => t[0] === "p" && c.pubkeys.has(t[1])).map((t) => t[1]));
    for (const pubkey of to) {
      for (const d of await o.store.watching(pubkey)) await alert(d);
    }
  };

  return {
    /** Re-read who wants alerts, and listen (or stop listening) to match. */
    async refresh(): Promise<void> {
      const want = new Map<string, Set<string>>();
      for (const d of await o.store.allWatching()) {
        for (const url of d.inboxRelays) {
          if (!o.allowLocalRelays && isJunkRelay(url)) continue;
          if (!want.has(url)) want.set(url, new Set());
          want.get(url)!.add(d.watch!);
        }
      }
      for (const [url, c] of conns) {
        if (want.has(url)) continue;
        c.wanted = false;
        clearTimeout(c.timer);
        try { c.ws?.close(); } catch { /* gone */ }
        conns.delete(url);
      }
      for (const [url, pubkeys] of want) {
        const c = conns.get(url);
        if (!c) {
          const fresh: RelayConn = { ws: null, pubkeys, retryMs: 5_000, wanted: true };
          conns.set(url, fresh);
          connect(url, fresh);
        } else if ([...pubkeys].sort().join() !== [...c.pubkeys].sort().join()) {
          c.pubkeys = pubkeys;
          req(c);
        }
      }
    },
    stop(): void {
      for (const c of conns.values()) { c.wanted = false; clearTimeout(c.timer); try { c.ws?.close(); } catch { /* gone */ } }
      conns.clear();
    },
  };
}
