/**
 * The one way the app checks a relay (2026-10-03; there were four).
 *
 * `probeRelay` opens its own socket, signs in if your setting for the relay
 * allows, asks one small question, and reports what happened (relay-connection.ts
 * reads it). With `question: false` it only times the connection — what the
 * relay lists and health monitors need.
 *
 * It also keeps, per relay and on this device: the recent probes (the
 * connection panel's speed history) and the relay's notices — from probes,
 * the console and the app's own connections.
 */
import { getGlobalSigner, shouldAutoAuth } from "./nip42-auth";
import { openWire } from "./wire-client";
import { probeOutcome, type ProbeResult } from "./relay-connection";
import { publishResults, type PublishRow } from "@/lib/publisher-model";
import type { WireFrame } from "./wire-transcript";

const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
const HISTORY_KEY = (u: string) => `ro_relay_probes:${norm(u)}`;
const NOTICES_KEY = (u: string) => `ro_relay_notices:${norm(u)}`;
const KEEP = 50;

export interface Notice { at: number; text: string }

const listeners = new Map<string, Set<() => void>>();
function changed(url: string) { listeners.get(norm(url))?.forEach((fn) => fn()); }
/** Hear when a relay's probes or notices change. */
export function onRelayRecord(url: string, fn: () => void): () => void {
  const k = norm(url);
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k)!.add(fn);
  return () => { listeners.get(k)?.delete(fn); };
}

function read<T>(key: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write<T>(key: string, list: T[]) {
  try { localStorage.setItem(key, JSON.stringify(list.slice(-KEEP))); } catch { /* private mode */ }
}

export const probeHistory = (url: string): ProbeResult[] => read<ProbeResult>(HISTORY_KEY(url));
export const relayNotices = (url: string): Notice[] => read<Notice>(NOTICES_KEY(url));

/** A notice from a relay, wherever it was heard. Repeats within a minute are kept once. */
export function recordNotice(url: string, text: string, at = Date.now()) {
  const list = relayNotices(url);
  if (list.some((n) => n.text === text && at - n.at < 60_000)) return;
  write(NOTICES_KEY(url), [...list, { at, text }]);
  changed(url);
}

export function clearNotices(url: string) {
  write(NOTICES_KEY(url), []);
  changed(url);
}

interface ProbeOptions {
  timeoutMs?: number;
  /** false: only time the connection. */
  question?: boolean;
  /** Keep the result in the relay's history (the panel's checks do; one-off list checks don't). */
  record?: boolean;
}

/** Will we sign in to this relay when it asks? (Decided before signing starts — see probeRelay.) */
const willSignIn = (relay: string) => !!getGlobalSigner() && shouldAutoAuth(relay);

/** Sign a sign-in for this relay if your setting allows; returns the event to send. */
async function signInEvent(relay: string, challenge: string): Promise<{ id: string } | null> {
  const signer = getGlobalSigner();
  if (!signer || !shouldAutoAuth(relay)) return null;
  try {
    return await signer.signEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", relay], ["challenge", challenge]], content: "" } as never) as { id: string };
  } catch { return null; }
}

export function probeRelay(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const { timeoutMs = 8000, question = true, record = false } = opts;
  const startedAt = Date.now();
  const frames: WireFrame[] = [];
  return new Promise((resolve) => {
    let finished = false;
    let reqSent = false;
    let waitingForSignIn = false;
    let answeredOnce = false;
    const authIds = new Set<string>();
    const req = ["REQ", `probe${Math.random().toString(36).slice(2, 7)}`, { limit: 1 }];
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      session.close();
      const result = probeOutcome(frames, startedAt);
      for (const n of result.notices) recordNotice(url, n);
      if (record) { write(HISTORY_KEY(url), [...probeHistory(url), result]); changed(url); }
      resolve(result);
    };
    const session = openWire(url, (f) => {
      frames.push(f);
      if (f.dir === "conn") {
        if (f.state === "open" && !question) finish();
        else if (f.state === "open" && !reqSent) { reqSent = true; session.send(req); }
        else if (f.state === "error" || f.state === "closed") finish();
        return;
      }
      if (f.dir !== "in") return;
      const [verb, a, b] = f.msg as [string, unknown, unknown];
      if (verb === "AUTH" && typeof a === "string") {
        // Mark it now, not when the signature comes back: the relay's
        // "auth-required" answer can land while a signer is still signing,
        // and the probe must wait for the signed-in answer, not stop there.
        if (willSignIn(url)) waitingForSignIn = true;
        void signInEvent(url, a).then((ev) => {
          if (finished) return;
          if (ev) { authIds.add(ev.id); session.send(["AUTH", ev]); }
          else { waitingForSignIn = false; if (answeredOnce) finish(); }
        });
      } else if (verb === "OK" && authIds.has(String(a))) {
        waitingForSignIn = false;
        if (b === true) session.send(req); // ask again, signed in
        else finish();
      } else if (verb === "EOSE" || verb === "CLOSED") {
        answeredOnce = true;
        const needsSignIn = verb === "CLOSED" && /^auth-required/i.test(String(b ?? ""));
        // If a sign-in is on its way, wait for it and the second answer.
        if (!(needsSignIn && waitingForSignIn)) finish();
      }
    }, timeoutMs);
    const timer = setTimeout(finish, timeoutMs + 2000);
  });
}

/**
 * Can you read from it, and can you write to it? Writing sends a short-lived
 * event (kind 20000 — relays pass it on and don't keep it), signed as you.
 */
export async function testReadWrite(url: string): Promise<{ read: ProbeResult; write: PublishRow }> {
  const readResult = await probeRelay(url, { record: true });
  const signer = getGlobalSigner();
  if (!signer) return { read: readResult, write: { relay: url, status: "refused", reason: "sign in to Relay Outpost to test writing" } };
  let event: { id: string };
  try {
    event = await signer.signEvent({ kind: 20000, created_at: Math.floor(Date.now() / 1000), tags: [], content: "Relay Outpost connection test — safe to ignore" } as never) as { id: string };
  } catch (err) {
    return { read: readResult, write: { relay: url, status: "refused", reason: err instanceof Error ? err.message : "couldn't sign" } };
  }
  const frames: WireFrame[] = [];
  const write = await new Promise<PublishRow>((resolve) => {
    const authIds = new Set<string>();
    let done = false;
    let signingIn = false;
    const end = () => { if (done) return; done = true; clearTimeout(timer); session.close(); resolve(publishResults([url], event.id, frames).rows[0]); };
    const session = openWire(url, (f) => {
      frames.push(f);
      if (f.dir === "conn" && (f.state === "error" || f.state === "closed")) { end(); return; }
      if (f.dir !== "in") return;
      const [verb, a, b, c] = f.msg as [string, unknown, unknown, unknown];
      if (verb === "NOTICE") recordNotice(url, String(a ?? ""));
      if (verb === "AUTH" && typeof a === "string") {
        if (willSignIn(url)) signingIn = true;
        void signInEvent(url, a).then((ev) => { if (ev && !done) { authIds.add(ev.id); session.send(["AUTH", ev]); } else { signingIn = false; } });
      } else if (verb === "OK" && authIds.has(String(a))) {
        signingIn = false;
        if (b === true) session.send(["EVENT", event]);
        else end();
      } else if (verb === "OK" && a === event.id) {
        const waitForSignIn = b !== true && /^auth-required/i.test(String(c ?? "")) && (signingIn || (authIds.size === 0 && willSignIn(url)));
        if (!waitForSignIn) end();
      }
    });
    session.send(["EVENT", event]);
    const timer = setTimeout(end, 10_000);
  });
  return { read: readResult, write };
}

/** Just "does it connect, and how fast" — for relay lists and health monitors. */
export async function timeConnection(url: string, timeoutMs = 5000): Promise<{ connected: boolean; latency: number | null; error: string | null }> {
  const r = await probeRelay(url, { question: false, timeoutMs });
  return r.opened
    ? { connected: true, latency: r.openMs ?? null, error: null }
    : { connected: false, latency: null, error: r.error ?? "Connection failed" };
}
