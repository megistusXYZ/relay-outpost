// On-device scheduling — the privacy-preserving alternative to the server scheduler.
//
// Scheduled posts live ONLY in this browser (localStorage). A lightweight runner
// publishes each one when its time arrives *while the app is open* — nothing is ever
// sent to the operator's server. Mirrors the public shape of `schedule.ts` so the
// existing scheduled-post UI can render local items unchanged.

import type { ScheduledPostWithDecrypted } from "@/lib/schedule";
import { publishEvent } from "@/lib/nostr";

export interface LocalScheduledPost {
  id: number;
  pubkey: string;
  encryptedEvent: string; // JSON of the signed event — local only, never transmitted to a server
  relayUrls: string[];
  scheduledAt: string; // ISO
  status: "pending" | "published" | "failed";
  kind: number;
  contentPreview: string;
  createdAt: string;
  publishedAt: string | null;
  failureReason: string | null;
  backend: "device";
}

const keyFor = (pubkey: string) => `relay-outpost-local-scheduled:${pubkey}`;

// ── Backend preference ────────────────────────────────────────────────────────
// "server" = operator's scheduler (reliable, fires while you're away, but the
// operator's process can read the scheduled content). "device" = on this device
// only (private; fires when the app is open). Default stays "server".
export type ScheduleBackend = "device" | "server";
const BACKEND_KEY = "relay-outpost-schedule-backend";

export function getScheduleBackend(): ScheduleBackend {
  try {
    return localStorage.getItem(BACKEND_KEY) === "device" ? "device" : "server";
  } catch {
    return "server";
  }
}

export function setScheduleBackend(b: ScheduleBackend): void {
  try {
    localStorage.setItem(BACKEND_KEY, b);
  } catch {}
}

function read(pubkey: string): LocalScheduledPost[] {
  try {
    const raw = localStorage.getItem(keyFor(pubkey));
    return raw ? (JSON.parse(raw) as LocalScheduledPost[]) : [];
  } catch {
    return [];
  }
}

function write(pubkey: string, items: LocalScheduledPost[]) {
  try {
    localStorage.setItem(keyFor(pubkey), JSON.stringify(items));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("scheduled-post-updated"));
  } catch {}
}

export function createLocalScheduledPost(
  signedEvent: any,
  relayUrls: string[],
  scheduledAt: Date,
  pubkey: string,
  contentPreview: string,
): LocalScheduledPost {
  const items = read(pubkey);
  const post: LocalScheduledPost = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    pubkey,
    encryptedEvent: JSON.stringify(signedEvent),
    relayUrls,
    scheduledAt: scheduledAt.toISOString(),
    status: "pending",
    kind: signedEvent.kind,
    contentPreview: contentPreview.slice(0, 80),
    createdAt: new Date().toISOString(),
    publishedAt: null,
    failureReason: null,
    backend: "device",
  };
  items.push(post);
  write(pubkey, items);
  return post;
}

export function getLocalScheduledPosts(pubkey: string): ScheduledPostWithDecrypted[] {
  return read(pubkey).map((p) => {
    let decryptedEvent: any;
    try {
      decryptedEvent = JSON.parse(p.encryptedEvent);
    } catch {}
    return { ...p, decryptedEvent } as unknown as ScheduledPostWithDecrypted;
  });
}

export function cancelLocalScheduledPost(id: number, pubkey: string): void {
  write(pubkey, read(pubkey).filter((p) => p.id !== id));
}

export function updateLocalScheduledPost(
  id: number,
  pubkey: string,
  updates: { scheduledAt?: Date; signedEvent?: any; contentPreview?: string; relayUrls?: string[]; kind?: number },
): void {
  const items = read(pubkey).map((p) => {
    if (p.id !== id) return p;
    return {
      ...p,
      scheduledAt: updates.scheduledAt ? updates.scheduledAt.toISOString() : p.scheduledAt,
      encryptedEvent: updates.signedEvent ? JSON.stringify(updates.signedEvent) : p.encryptedEvent,
      contentPreview: updates.contentPreview !== undefined ? updates.contentPreview.slice(0, 80) : p.contentPreview,
      relayUrls: updates.relayUrls ?? p.relayUrls,
      kind: updates.kind ?? p.kind,
      status: "pending" as const, // re-arm on edit
      failureReason: null,
    };
  });
  write(pubkey, items);
}

// ── Runner ──────────────────────────────────────────────────────────────────
// Publishes due items via the normal publish path (the event is already signed, so
// no signer is needed at fire time; its future created_at is ≈now once it fires).

let currentPubkey: string | null = null;
let started = false;

export function setSchedulerPubkey(pk: string | null) {
  currentPubkey = pk;
}

async function runDue(pubkey: string | null) {
  if (!pubkey) return;
  const items = read(pubkey);
  const now = Date.now();
  let changed = false;
  for (const p of items) {
    if (p.status !== "pending") continue;
    if (new Date(p.scheduledAt).getTime() > now) continue;
    try {
      const signed = JSON.parse(p.encryptedEvent);
      await publishEvent(signed, p.relayUrls, undefined, true);
      p.status = "published";
      p.publishedAt = new Date().toISOString();
    } catch (e: any) {
      p.status = "failed";
      p.failureReason = e?.message || "Publish failed";
    }
    changed = true;
  }
  if (changed) write(pubkey, items);
}

export function startLocalScheduleRunner(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => { void runDue(currentPubkey); };
  tick();
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
}
