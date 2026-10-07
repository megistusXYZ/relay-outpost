/**
 * Which call service a group's call uses (owner, 2026-10-06; CORD-07 §5 and
 * concord PR #22, which Armada ships). concord-av-brokers.test.ts.
 *
 *  - A group's details may list its call services (`av_brokers`, https
 *    origins). Every app orders them by sha256(voice room's 32 bytes ||
 *    origin), smallest first, and takes the first that answers — so members
 *    of any app meet in one call.
 *  - No list: join the service people are already in (the call's presence
 *    names it); nobody there → ours.
 *  - A service that isn't ours is used only after the person agrees, once
 *    per group: that service can see when they join (media stays end-to-end
 *    encrypted).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { callRoster } from "./concord-presence";
import { effectiveTime } from "./concord-events";

/** The RFC 6454 form the spec hashes: lowercase https origin, default port dropped, no path. Null if not one. */
export function canonicalOrigin(input: unknown): string | null {
  if (typeof input !== "string") return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || !u.hostname) return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Our own call service: this page's origin, when it is https. A laptop on
 * http://localhost has none to offer other apps, so nothing is listed there.
 */
export function ownCallService(): string | null {
  return canonicalOrigin((globalThis as { location?: { origin?: string } }).location?.origin);
}

/** A group's `av_brokers`, cleaned: readable https origins only, each once, at most 5. */
export function readAvBrokers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const o = canonicalOrigin(entry);
    if (o && !out.includes(o)) out.push(o);
    if (out.length === 5) break;
  }
  return out;
}

/** The shared order: sha256(room bytes || utf8(origin)), smallest first. */
export function rankBrokers(roomHex: string, origins: string[]): string[] {
  const room = hexToBytes(roomHex);
  const rank = (o: string) => bytesToHex(sha256(concatBytes(room, utf8ToBytes(o))));
  return [...origins].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
}

export interface CallBrokerPlan {
  /** Services to try, in order; the first that answers is the call's. */
  candidates: string[];
  /** Of those, the ones that aren't ours and the person hasn't agreed to for this group. */
  ask: string[];
}

export function planCallBroker(o: {
  /** The voice room (hex of its 32-byte key). */
  room: string;
  /** The group's listed services (readAvBrokers). */
  listed: string[];
  /** Services named by people already in this room's call. */
  present: string[];
  /** Ours (this app's origin). */
  own: string;
  /** Services the person already agreed to for this group. */
  agreed: string[];
}): CallBrokerPlan {
  let candidates: string[];
  if (o.listed.length) candidates = rankBrokers(o.room, o.listed);
  else if (o.present.length) candidates = rankBrokers(o.room, [...new Set(o.present)]);
  else candidates = [o.own];
  return { candidates, ask: candidates.filter((c) => c !== o.own && !o.agreed.includes(c)) };
}

/**
 * The service this call uses: the first candidate that answers its probe.
 * Ours is never probed (joining says so itself if it's down). A group that
 * lists services and none answers gets null — a separate call on ours would
 * leave the person alone while the group talks elsewhere. With no list, ours
 * is the last resort.
 */
export async function chooseCallService(o: {
  room: string; listed: string[]; present: string[]; own: string; agreed: string[];
  probe: (origin: string) => Promise<boolean>;
}): Promise<{ origin: string; ask: boolean } | null> {
  const plan = planCallBroker(o);
  const tries = o.listed.length || plan.candidates.includes(o.own) ? plan.candidates : [...plan.candidates, o.own];
  for (const origin of tries) {
    if (origin === o.own || (await o.probe(origin).catch(() => false))) return { origin, ask: plan.ask.includes(origin) };
  }
  return null;
}

/** Is this call service up? `/.well-known/concord/av` answers 204 (CORD-07 §5), within 5 s. */
export async function probeCallService(origin: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5_000);
  try {
    const res = await fetchFn(`${origin}/.well-known/concord/av`, { signal: ctl.signal });
    return res.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── Who's already in a room's call, and on which service ──────────────────────
// Presence is never stored by relays, so only a listener that was already
// running heard it: the room's call bar and the ringer note what they hear
// here, and joining reads it.

type PresenceWord = { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] };
const heard = new Map<string, PresenceWord[]>();
const HEARD_KEEP_MS = 3 * 60_000;

export function noteCallPresence(roomKey: string, rumor: PresenceWord): void {
  const at = effectiveTime(rumor);
  const kept = (heard.get(roomKey) ?? []).filter((r) => at - effectiveTime(r) < HEARD_KEEP_MS);
  kept.push(rumor);
  heard.set(roomKey, kept.slice(-200));
}

/** The services people in this room's call are on right now: https only, each once. */
export function callServicesIn(roomKey: string, nowMs: number): string[] {
  const out: string[] = [];
  for (const seat of callRoster(heard.get(roomKey) ?? [], nowMs).values()) {
    const o = canonicalOrigin(seat.broker);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

// ── Ask once per group ────────────────────────────────────────────────────────
const AGREED_KEY = (communityId: string) => `ro_call_service_ok:${communityId}`;

/** Services the person agreed to for this group's calls. */
export function agreedCallServices(communityId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(AGREED_KEY(communityId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function agreeCallService(communityId: string, origin: string): void {
  try {
    const now = agreedCallServices(communityId);
    if (!now.includes(origin)) localStorage.setItem(AGREED_KEY(communityId), JSON.stringify([...now, origin]));
  } catch { /* private window: we ask again next time */ }
}
