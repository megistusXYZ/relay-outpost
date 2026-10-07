/**
 * Notifications while the app is closed (owner, 2026-10-06): this device's
 * side. Turning it on asks the browser for permission, subscribes to push,
 * and signs the device up with our server (server/push/push-devices.ts):
 *
 *  - messages: your key, and the inbox relays our server can read without
 *    signing in as you (Q9); signed with your key, so nobody else can ask;
 *  - calls: the rooms in push-rooms.ts, each with proof you hold its key.
 *
 * Group names stay on this phone (IndexedDB ro-push/rooms), where the service
 * worker looks them up to say "Call in Bali crew" (client/public/sw.js).
 */
import { nip98 } from "nostr-tools";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { isIOSDevice } from "@/lib/is-ios";
import { getMyDMReceiveRelays } from "@/lib/outbox";
import { fetchNip11 } from "@/lib/nip11";
import { getCommunities } from "@/lib/concord/concord-keys";
import { isConcordCallsEnabled } from "@/lib/concord/concord-prefs";
import { isCommunityMuted, isChannelMuted } from "@/lib/concord/concord-mute";
import { ringRooms, type RingRoom } from "@/lib/push-rooms";

const ON_KEY = "ro_push_on";
const SENT_KEY = "ro_push_sent";
export const PUSH_CHANGED_EVENT = "ro-push-changed";

export type PushReadiness = "ready" | "install-first" | "unsupported";

/** Can this browser get notifications while the app is closed? An iPhone can, once the app is on the Home Screen. */
export function pushReadiness(): PushReadiness {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const standalone = (() => {
    try { if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true; } catch { /* old browser */ }
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  })();
  if (isIOSDevice() && !standalone) return "install-first";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return "unsupported";
  return "ready";
}

export function isClosedAppNotifyOn(): boolean {
  try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; }
}

function setOn(on: boolean) {
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else { localStorage.removeItem(ON_KEY); localStorage.removeItem(SENT_KEY); }
  } catch { /* private window */ }
  try { window.dispatchEvent(new Event(PUSH_CHANGED_EVENT)); } catch { /* no window */ }
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (reg) return reg;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5_000))]);
}

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Inbox relays our server can listen on: those that don't require signing in to read. */
async function readableInboxRelays(pubkey: string): Promise<string[]> {
  const relays = getMyDMReceiveRelays(pubkey, 10);
  const open = await Promise.all(relays.map(async (r) => {
    const doc = await fetchNip11(r).catch(() => null);
    return doc?.limitation?.auth_required ? null : r;
  }));
  return open.filter((r): r is string => !!r);
}

/** The group names this phone shows, for the service worker. Names never leave the phone. */
async function keepRoomNames(rooms: RingRoom[]): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.open("ro-push", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("rooms");
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const tx = req.result.transaction("rooms", "readwrite");
        const store = tx.objectStore("rooms");
        store.clear();
        for (const r of rooms) store.put({ label: r.label, open: r.open }, r.room);
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => { req.result.close(); resolve(); };
      };
    } catch { resolve(); }
  });
}

async function roomsFor(pubkey: string, endpoint: string): Promise<RingRoom[]> {
  const communities = await getCommunities(pubkey).catch(() => []);
  return ringRooms(communities, {
    endpoint,
    callsOn: isConcordCallsEnabled(),
    muted: (cid, chid) => (chid ? isChannelMuted(cid, chid) : isCommunityMuted(cid)),
  });
}

async function send(body: object, signed: boolean): Promise<Response> {
  const url = `${window.location.origin}/api/push/device`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signed) {
    const signer = getGlobalSigner();
    if (!signer) throw new Error("Sign in to turn this on");
    headers.Authorization = await nip98.getToken(url, "POST", (e) => signer.signEvent(e as never) as never, true);
  }
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

export type TurnOnResult =
  | { ok: true; messages: "on" | "inbox-needs-sign-in" }
  | { ok: false; reason: "denied" | "unavailable" | "failed" };

export async function turnOnClosedAppNotify(pubkey: string): Promise<TurnOnResult> {
  if (pushReadiness() !== "ready") return { ok: false, reason: "unavailable" };
  const permission = await Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  if (permission !== "granted") return { ok: false, reason: "denied" };
  try {
    const keyRes = await fetch("/api/push/key");
    if (!keyRes.ok) return { ok: false, reason: "unavailable" };
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    const reg = await registration();
    if (!reg) return { ok: false, reason: "unavailable" };
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const subscription = sub.toJSON();
    const inboxRelays = await readableInboxRelays(pubkey);
    const rooms = await roomsFor(pubkey, sub.endpoint);
    await keepRoomNames(rooms);
    const res = await send({
      subscription,
      ...(inboxRelays.length ? { watch: { pubkey, inboxRelays } } : {}),
      rooms: rooms.map(({ room, proof }) => ({ room, proof })),
    }, inboxRelays.length > 0);
    if (!res.ok) return { ok: false, reason: "failed" };
    setOn(true);
    try { localStorage.setItem(SENT_KEY, rooms.map((r) => r.room).sort().join(",")); } catch { /* private window */ }
    return { ok: true, messages: inboxRelays.length ? "on" : "inbox-needs-sign-in" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export async function turnOffClosedAppNotify(): Promise<void> {
  setOn(false);
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/device", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  } catch { /* nothing more to forget here */ }
  await keepRoomNames([]);
}

/**
 * Keep the rooms that ring this device current (calls switched, a group
 * muted, a new group): only when they changed, and without a new signature —
 * the message watch stays as it was (keepWatch).
 */
export async function syncClosedAppRooms(pubkey: string): Promise<void> {
  if (!isClosedAppNotifyOn() || pushReadiness() !== "ready") return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) { setOn(false); return; }
  const rooms = await roomsFor(pubkey, sub.endpoint);
  const sig = rooms.map((r) => r.room).sort().join(",");
  let sent: string | null = null;
  try { sent = localStorage.getItem(SENT_KEY); } catch { /* private window */ }
  await keepRoomNames(rooms);
  if (sig === sent) return;
  const res = await send({ subscription: sub.toJSON(), keepWatch: true, rooms: rooms.map(({ room, proof }) => ({ room, proof })) }, false).catch(() => null);
  if (res?.ok) { try { localStorage.setItem(SENT_KEY, sig); } catch { /* private window */ } }
}

const OFFERED_KEY = "ro_push_offered";

/**
 * Offer this once, at the moment it pays off (owner, 2026-10-06: Q4): the
 * first message or call that arrives while the app is open. Never on a first
 * visit, never again once answered or shown.
 */
export function takeClosedAppNotifyOffer(): PushReadiness | null {
  if (isClosedAppNotifyOn()) return null;
  const readiness = pushReadiness();
  if (readiness === "unsupported") return null;
  try {
    if (localStorage.getItem(OFFERED_KEY)) return null;
    localStorage.setItem(OFFERED_KEY, "1");
  } catch { return null; }
  return readiness;
}
