/**
 * Did the relay answer, or did we never get to ask?
 *
 * Nostr fetches in this codebase are overwhelmingly written as
 * `new Promise(resolve => …)` over a subscription, resolving on EOSE and again
 * on a timeout. None of them reject. That is reasonable for a protocol where
 * partial answers are normal — but it collapses two different facts into one
 * value, and the UI then states the wrong one confidently:
 *
 *   "No Chat Rooms Found — be the first, create a channel!"   (relay was offline)
 *   "This community doesn't have chat yet"                      (NIP-11 502'd)
 *
 * Both shipped. Both invited someone to act on a claim we had no basis for.
 *
 * EOSE CANNOT TELL YOU THIS, and it is the obvious wrong answer — I built on it
 * first. nostr-tools' SimplePool fires `oneose` when a relay FAILS to connect,
 * because across a relay set it means "everyone has answered or given up". A
 * dead relay EOSEs in ~143ms with zero events, byte-identical to a healthy relay
 * that hosts nothing.
 *
 * Connecting is the signal. `pool.ensureRelay` rejects on a relay that is down
 * (~140ms, "connection failed") and resolves instantly for an already-open
 * socket, so this costs nothing on the happy path. Both figures measured against
 * real relays, not assumed.
 */
import type { Event as NostrEvent, Filter } from "nostr-tools";
import { pool, DEFAULT_READ_MAX_WAIT_MS } from "./nostr";
import { getAuthStatus } from "./nip42-auth";

/** A result that knows whether it is an answer or an absence of one. */
export interface Reached<T> {
  data: T;
  /**
   * We got a connection. The payload is then the relay's real answer, however
   * sparse. False means we never reached it, and NOTHING may be concluded about
   * what it holds.
   */
  reached: boolean;
  /**
   * Set when the socket opened and the relay then REFUSED to serve us — today
   * that means it declined our NIP-42 AUTH. Carries the relay's own words.
   *
   * This is a third outcome and it caught me out on my own fix. An
   * auth-required relay accepts the TCP/WebSocket connection perfectly happily,
   * so `ensureRelay` resolves and `reached` is true; it only refuses once the
   * REQ arrives. Observed live against Buzz: the socket opened in 453ms, the
   * relay answered our AUTH with "restricted: not a relay member", the
   * subscription returned nothing, and the UI said "No Chat Rooms Found — be
   * the first, create a channel!" about a room full of people.
   *
   * When this is set, `data` is NOT an answer, even though `reached` is true.
   */
  refusedReason?: string;
}

/**
 * Did this relay open a socket and then decline to serve us?
 *
 * The app already knows — nip42-auth records `status: "failed"` along with the
 * relay's own message. It was being logged at debug level and dropped, so the
 * one sentence that would have explained an empty screen never reached it.
 */
export function relayRefusedUs(relayUrl: string): string | undefined {
  const state = getAuthStatus(relayUrl);
  if (state.status !== "failed") return undefined;
  return state.error || "the relay declined our sign-in";
}

/**
 * Can we open a socket to this relay right now? Never throws, never hangs:
 * a connect that hasn't settled inside `timeoutMs` counts as unreachable —
 * measured live (2026-08-18), ensureRelay can stay PENDING indefinitely for
 * a relay that neither accepts nor refuses, and an unsettled probe is worse
 * than a false one because every aggregate built on it inherits the hang.
 */
export async function canReachRelay(relayUrl: string, timeoutMs = 8_000): Promise<boolean> {
  try {
    await Promise.race([
      pool.ensureRelay(relayUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a relay fetch only if the relay is reachable, and report which happened.
 *
 * The `empty` value is what the caller gets when we could not connect — it
 * exists so the shape stays honest (an empty list, a null) without the caller
 * having to invent one at each site.
 *
 *   const { data: groups, reached } = await withReach(url, [], () => fetchGroups(url));
 *   if (!reached) return <CouldntReach />;   // NOT "no groups"
 *
 * Deliberately does not swallow errors from `run` — a fetch that genuinely
 * throws is a different problem from a relay that is down, and hiding it here
 * would recreate the defect one layer up.
 */
export async function withReach<T>(
  relayUrl: string,
  empty: T,
  run: () => Promise<T>,
): Promise<Reached<T>> {
  if (!(await canReachRelay(relayUrl))) return { data: empty, reached: false };
  const data = await run();
  // Checked AFTER the fetch, not before: the AUTH round-trip happens while the
  // subscription is opening, so asking first would race it.
  return { data, reached: true, refusedReason: relayRefusedUs(relayUrl) };
}

/**
 * The same question across several relays: reached if ANY of them answered.
 *
 * For a set, "we couldn't ask" only holds when nobody was reachable. One live
 * relay out of five is a thin answer but it IS an answer, and telling someone
 * their community is unreachable because four of five are down would be its own
 * false claim.
 */
export async function canReachAny(relayUrls: string[]): Promise<boolean> {
  if (relayUrls.length === 0) return false;
  // First success settles the verdict IMMEDIATELY — the question is "can we
  // reach ANY", and waiting for the slowest relay to also answer made every
  // caller as slow as the worst relay in the set (and, before canReachRelay
  // grew its timeout, as slow as a relay that never answers at all).
  return new Promise((resolve) => {
    let pending = relayUrls.length;
    for (const url of relayUrls) {
      canReachRelay(url).then((ok) => {
        if (ok) resolve(true);
        else if (--pending === 0) resolve(false);
      });
    }
  });
}

/**
 * How far past our own timer the library's made-up end of stream is pushed.
 * It only has to lose the race; the margin covers timer jitter.
 */
const MADE_UP_EOSE_MARGIN_MS = 5_000;

/**
 * A one-shot read that reports whether the relays ANSWERED, not just what came back.
 *
 * The reason this exists as a primitive: three separate code paths were found
 * building a REPLACEABLE event out of a read that had returned `[]`, where the
 * `[]` might equally have meant "we never got an answer". An empty replaceable
 * event is a DELETE, so each of them could erase something the user owns —
 * their NIP-65 relay list, their community list, their DM inbox routing. The
 * codebase had already learned this three times over (kind-3, kind-10009,
 * kind-10073); it kept happening because "did anyone answer?" was not a thing a
 * caller could ask.
 *
 * `answered` is true when at least one of these relays sent its OWN end of
 * stream. Nothing else counts, because a stream ends in four other ways and
 * each of them has been read as an answer here:
 *
 *  - the relay never connected, or its dial was skipped because it refused
 *    moments ago: the pool fires `oneose` regardless (measured 2026-11-18, a
 *    refused connection read as answered in a millisecond);
 *  - the relay connected and turned the REQ down (CLOSED), or asked for a
 *    sign-in and refused ours;
 *  - the relay connected and then dropped the socket. WebKit reports that as
 *    an error, the library ends every read on the relay at once, and a re-dial
 *    succeeds a moment later (measured 2026-11-19: answered, in ~100 ms, with
 *    zero events). Chromium reports only a close and the library reconnects
 *    quietly, so the same relay read differently in the two engines;
 *  - the relay connected and said nothing, and the library ended the stream
 *    itself at its `maxWait`.
 *
 * An earlier fix asked "is any of them connected?" when the stream ended. That
 * caught the first of these and none of the rest: in the other three the relay
 * IS connected, it just has not answered.
 *
 * So each relay is asked in a read of its own, and the library tells the two
 * endings apart by what follows: when it ends a stream on a relay's behalf, the
 * close arrives in the same turn; behind a relay's own EOSE there is none.
 * (`relay-reach-answered.test.ts` pins that ordering against the library; the
 * health credit in nostr.ts leans on it too.) The library's own made-up ending
 * is pushed out past our timer, so it can never arrive at all.
 *
 * How long it waits: until every relay has answered or dropped out, or until
 * `timeoutMs`. Once one relay has answered, the rest get no longer than the
 * pool's usual wait (DEFAULT_READ_MAX_WAIT_MS), so one silent relay cannot hold
 * a read that already has its answer. When the timer ends the read, `answered`
 * is whatever is true by then: one real answer among silent relays is an
 * answer, and none is not.
 *
 * Events that DID arrive are always returned, answered or not: a relay that
 * sent three entries and then went quiet still told us about three entries.
 */
export async function queryAnswered(
  relayUrls: string[],
  filter: Filter,
  timeoutMs = 15_000,
): Promise<{ events: NostrEvent[]; answered: boolean }> {
  const urls = Array.from(new Set(relayUrls));
  if (urls.length === 0) return { events: [], answered: false };
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    const seen = new Set<string>();
    const subs: { close(): void }[] = [];
    let settled = false;
    let answeredBy = 0;
    let waitingOn = urls.length;
    let restHadTheirTime = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(restTimer);
      for (const sub of subs) { try { sub.close(); } catch {} }
      resolve({ events, answered: answeredBy > 0 });
    };
    const relayDone = (answered: boolean) => {
      if (settled) return;
      if (answered) answeredBy++;
      waitingOn--;
      if (waitingOn === 0 || (answeredBy > 0 && restHadTheirTime)) settle();
    };
    for (const url of urls) {
      let counted = false;
      let closed = false;
      const done = (answered: boolean) => { if (!counted) { counted = true; relayDone(answered); } };
      try {
        subs.push(pool.subscribeMany([url], filter, {
          maxWait: timeoutMs + MADE_UP_EOSE_MARGIN_MS,
          onevent(e: NostrEvent) {
            if (settled || seen.has(e.id)) return;
            seen.add(e.id);
            events.push(e);
          },
          // Decided one microtask on: a close in the same turn means the
          // library ended this stream for the relay, not the relay itself.
          oneose() { queueMicrotask(() => done(!closed)); },
          onclose() { closed = true; },
        }));
      } catch {
        // Not a relay address at all: one more relay that did not answer.
        done(false);
      }
    }
    if (settled) return;
    timer = setTimeout(settle, timeoutMs);
    restTimer = setTimeout(() => {
      restHadTheirTime = true;
      if (answeredBy > 0) settle();
    }, Math.min(timeoutMs, DEFAULT_READ_MAX_WAIT_MS));
  });
}
