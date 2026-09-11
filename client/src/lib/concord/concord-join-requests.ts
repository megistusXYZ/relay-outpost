/**
 * Asking to join a group chat (Relay Outpost's own; not in the spec).
 *
 * A moderator shares an ask link: their npub in the path, and the group's id,
 * owner and name in the fragment, which no server ever sees. Someone with the
 * link sends a private request (NIP-29's join request, kind 9021, gift-wrapped)
 * to that moderator and the owner, who let them in with a direct invite
 * (CORD-05 §6) or decline. Nothing about the group is published anywhere.
 *
 * Pure, with the moderator's store of received requests in localStorage.
 */
import { nip19 } from "nostr-tools";

export const KIND_JOIN_REQUEST = 9021;

export interface AskInfo {
  communityId: string;
  owner: string;
  /** Shown to the person asking; it's only what the moderator's app knew. */
  name: string;
}

export interface JoinRequest {
  /** The request's rumor id. */
  id: string;
  requester: string;
  /** When it was sent (unix seconds). */
  at: number;
  communityId: string;
  /** What they said, if anything. */
  note: string;
}

/** Fired when a moderator's requests change, so counts and lists refresh. */
export const JOIN_REQUESTS_CHANGED_EVENT = "concord-join-requests-changed";

const HEX64 = /^[0-9a-f]{64}$/;
const NOTE_CAP = 280;
const NAME_CAP = 80;
const STORE_CAP = 100;

function toB64url(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** `${base}/ask/<creator npub>#<group>`. The group rides in the fragment. */
export function askLink(base: string, creator: string, info: AskInfo): string {
  const fragment = toB64url(JSON.stringify({ c: info.communityId, o: info.owner, n: info.name.slice(0, NAME_CAP) }));
  return `${base.replace(/\/+$/, "")}/ask/${nip19.npubEncode(creator)}#${fragment}`;
}

/** Who to ask and which group, or null for a damaged link. */
export function parseAskLink(npub: string, fragment: string): (AskInfo & { creator: string }) | null {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== "npub") return null;
    const j = JSON.parse(fromB64url(fragment.replace(/^#/, "")));
    if (!HEX64.test(j?.c ?? "") || !HEX64.test(j?.o ?? "")) return null;
    return { creator: decoded.data, communityId: j.c, owner: j.o, name: typeof j.n === "string" ? j.n.slice(0, NAME_CAP) : "" };
  } catch {
    return null;
  }
}

/** The link's moderator and the owner, once each. */
export function askRecipients(creator: string, owner: string): string[] {
  return [...new Set([creator, owner])];
}

export function joinRequestTags(communityId: string): string[][] {
  return [["concord", communityId]];
}

/** A received request, or null when it doesn't name a group. */
export function parseJoinRequest(u: { senderPubkey: string; content: string; timestamp: number; rumorId: string; tags?: string[][] }): JoinRequest | null {
  const where = (u.tags ?? []).find((t) => t[0] === "concord");
  if (!where || !HEX64.test(where[1] ?? "")) return null;
  return {
    id: u.rumorId,
    requester: u.senderPubkey,
    at: u.timestamp,
    communityId: where[1],
    note: (u.content ?? "").trim().slice(0, NOTE_CAP),
  };
}

// ── A moderator's requests, on this device ──────────────────────────────────
interface RequestStore { requests: JoinRequest[]; resolved: string[] }
const storeKey = (owner: string) => `ro_concord_join_requests_${owner}`;

function load(owner: string): RequestStore {
  try {
    const s = JSON.parse(localStorage.getItem(storeKey(owner)) ?? "null");
    return {
      requests: Array.isArray(s?.requests) ? s.requests : [],
      resolved: Array.isArray(s?.resolved) ? s.resolved.filter((r: unknown) => typeof r === "string") : [],
    };
  } catch {
    return { requests: [], resolved: [] };
  }
}

function save(owner: string, s: RequestStore): void {
  try { localStorage.setItem(storeKey(owner), JSON.stringify(s)); } catch { /* full or private mode */ }
  try { window.dispatchEvent(new Event(JOIN_REQUESTS_CHANGED_EVENT)); } catch { /* no window */ }
}

/**
 * Keep a received request: one per person per group, the latest. False when
 * it's already here, was handled, or is older than one we have.
 */
export function stashJoinRequest(owner: string, request: JoinRequest): boolean {
  const s = load(owner);
  if (s.resolved.includes(request.id) || s.requests.some((r) => r.id === request.id)) return false;
  const same = s.requests.find((r) => r.requester === request.requester && r.communityId === request.communityId);
  if (same && same.at >= request.at) return false;
  const requests = [request, ...s.requests.filter((r) => r !== same)].sort((a, b) => b.at - a.at).slice(0, STORE_CAP);
  save(owner, { ...s, requests });
  return true;
}

/** A group's waiting requests, newest first. */
export function listJoinRequests(owner: string, communityId: string): JoinRequest[] {
  return load(owner).requests.filter((r) => r.communityId === communityId).sort((a, b) => b.at - a.at);
}

/** Let in or declined: it leaves the list, and stays gone if it's delivered again. */
export function resolveJoinRequest(owner: string, id: string): void {
  const s = load(owner);
  save(owner, {
    requests: s.requests.filter((r) => r.id !== id),
    resolved: [...s.resolved.filter((r) => r !== id), id].slice(-STORE_CAP * 2),
  });
}
