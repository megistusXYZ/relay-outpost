/**
 * Look events up by id across several relays — a reply's parent, a quoted
 * note — batched: one request per relay carries every id wanted from it.
 *
 * Two measurements shaped this (2026-10-01, a busy profile, one relay stuck):
 *
 *  1. The first lookup settled only when EVERY relay had finished. Parents that
 *     were found still took 4.2–8.0 s to appear, because the answer sat in hand
 *     while the slowest relay timed out; and when that relay outlasted the 8 s
 *     cap, a parent five relays had already said they don't have came back as
 *     "didn't load — tap to retry" (34 of 90 notes on a bad run).
 *  2. With that fixed, each reply still made its own request to every relay:
 *     90 replies × 7 relays = 630 requests through the pool's throttle, and
 *     context took 3–7 s to fill in. Asked together, it is one request per
 *     relay.
 *
 * The three honest outcomes (lib/parent-resolve.ts) are judged per id, by the
 * relays that actually answered:
 *
 *  - found     the moment the event arrives. One id, one event: nothing a
 *              slower relay says can change it.
 *  - missing   most of the relays that could answer really did (a real EOSE),
 *              and none had it. A short grace follows the majority, for the
 *              relay that has it but answers last.
 *  - unreached too few answered to conclude anything. Declines (rate limit,
 *              failed connection, a relay the pool is resting) are never an
 *              answer: the caller offers a retry and does not claim absence.
 *
 * `subscribe` is called with ONE relay at a time, in lib/collect-once.ts'
 * subscribe shape, so each relay's real answer and each decline is seen.
 */
import type { Event } from "nostr-tools";
import type { Subscribe } from "./collect-once";

/** After most relays have said "not here", how long a late find may still win. */
export const MISSING_GRACE_MS = 1200;
/** Lookups asked within this window travel together. A frame or two: unseen. */
export const BATCH_WINDOW_MS = 30;

export type LookupOutcome = "found" | "missing" | "unreached";
export interface LookupResult { outcome: LookupOutcome; event: Event | null }

interface Entry {
  id: string;
  relays: Set<string>;
  answered: Set<string>;
  declined: Set<string>;
  /** Relays whose request has ended, one way or the other. */
  finished: Set<string>;
  resolvers: Array<(r: LookupResult) => void>;
  done: boolean;
  sent: boolean;
  grace?: ReturnType<typeof setTimeout>;
  cap?: ReturnType<typeof setTimeout>;
  /** The open requests this id is part of: told when it settles. */
  requests: Set<Request>;
}
interface Request { open: number; close: () => void }

export function createIdBatcher(
  subscribe: Subscribe,
  opts: { windowMs?: number; capMs?: number; maxIdsPerRequest?: number } = {},
): { lookup: (id: string, relays: readonly string[]) => Promise<LookupResult> } {
  const windowMs = opts.windowMs ?? BATCH_WINDOW_MS;
  const capMs = opts.capMs ?? 8000;
  const maxIds = opts.maxIdsPerRequest ?? 100;
  /** Ids in flight, so the same id asked twice shares one lookup. */
  const live = new Map<string, Entry>();
  let queue: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const mostAnswered = (e: Entry) => {
    const canAnswer = e.relays.size - e.declined.size;
    return e.answered.size > 0 && e.answered.size >= Math.floor(canAnswer / 2) + 1;
  };
  const finish = (e: Entry, outcome: LookupOutcome, event: Event | null = null) => {
    if (e.done) return;
    e.done = true;
    clearTimeout(e.grace);
    clearTimeout(e.cap);
    live.delete(e.id);
    // A request with nothing left to wait for is closed.
    for (const req of e.requests) { if (--req.open === 0) req.close(); }
    e.requests.clear();
    for (const resolve of e.resolvers) resolve({ outcome, event });
  };
  const judge = (e: Entry) => {
    if (e.done) return;
    // Every relay is done: absent if anyone really answered.
    if (e.finished.size >= e.relays.size) { finish(e, e.answered.size > 0 ? "missing" : "unreached"); return; }
    if (!e.grace && mostAnswered(e)) e.grace = setTimeout(() => finish(e, "missing"), MISSING_GRACE_MS);
  };

  const flush = () => {
    timer = undefined;
    const batch = queue; queue = [];
    const byRelay = new Map<string, Entry[]>();
    for (const e of batch) {
      e.sent = true;
      e.cap = setTimeout(() => finish(e, mostAnswered(e) ? "missing" : "unreached"), capMs);
      for (const relay of e.relays) (byRelay.get(relay) ?? byRelay.set(relay, []).get(relay)!).push(e);
    }
    for (const [relay, entries] of byRelay) {
      for (let i = 0; i < entries.length; i += maxIds) {
        const chunk = entries.slice(i, i + maxIds).filter((e) => !e.done);
        if (chunk.length === 0) continue;
        const byId = new Map(chunk.map((e) => [e.id, e]));
        let sub: { close: () => void } | undefined;
        let closed = false;
        const req: Request = { open: chunk.length, close: () => { closed = true; try { sub?.close(); } catch { /* already closed */ } } };
        for (const e of chunk) e.requests.add(req);
        const each = (fn: (e: Entry) => void) => { for (const e of chunk) if (!e.done) fn(e); };
        sub = subscribe([relay], { ids: [...byId.keys()] }, {
          onevent: (ev) => { const e = byId.get(ev.id); if (e && !e.done) finish(e, "found", ev); },
          onrelayeose: () => each((e) => { e.answered.add(relay); e.declined.delete(relay); judge(e); }),
          onrelaydeclined: () => each((e) => { if (!e.answered.has(relay)) e.declined.add(relay); judge(e); }),
          // The request is over. A relay that ended without a real answer
          // (nostr-tools invents an EOSE for a failed connection) declined.
          // Judged a microtask later: the app's subscribe reports "over"
          // synchronously and "really answered" from a queued microtask, and
          // judging first would call a relay that answered "declined".
          oneose: () => queueMicrotask(() => each((e) => {
            if (!e.answered.has(relay)) e.declined.add(relay);
            e.finished.add(relay);
            judge(e);
          })),
        });
        // Settled while subscribing (a synchronous answer): close what just opened.
        if (closed) { try { sub.close(); } catch { /* already closed */ } }
      }
    }
  };

  return {
    lookup(id, relays) {
      if (relays.length === 0) return Promise.resolve({ outcome: "unreached", event: null });
      return new Promise((resolve) => {
        const existing = live.get(id);
        // Joined while still queued: its relays widen. Already sent: share
        // the answer that is on its way.
        if (existing) {
          existing.resolvers.push(resolve);
          if (!existing.sent) for (const r of relays) existing.relays.add(r);
          return;
        }
        const entry: Entry = { id, relays: new Set(relays), answered: new Set(), declined: new Set(), finished: new Set(), resolvers: [resolve], done: false, sent: false, requests: new Set() };
        live.set(id, entry);
        queue.push(entry);
        if (!timer) timer = setTimeout(flush, windowMs);
      });
    },
  };
}
