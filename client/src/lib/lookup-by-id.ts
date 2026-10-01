/**
 * Look ONE event up by id across several relays — a reply's parent.
 *
 * The lookup it replaces settled only when every relay had finished. Measured
 * on a profile with one relay stuck (2026-10-01): parents that were found
 * still took 4.2–8.0 s to appear, because the answer sat in hand while the
 * slowest relay timed out; and when that relay outlasted the caller's 8 s,
 * a parent five relays had already said they don't have came back as "didn't
 * load — tap to retry" (34 of 90 notes on a bad run).
 *
 * The three honest outcomes (lib/parent-resolve.ts) are kept, judged by the
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
 * Same subscribe shape and per-relay signals as lib/collect-once.ts.
 */
import type { Event } from "nostr-tools";
import type { Subscribe } from "./collect-once";

/** After most relays have said "not here", how long a late find may still win. */
export const MISSING_GRACE_MS = 1200;

export type LookupOutcome = "found" | "missing" | "unreached";

export function lookupById(
  subscribe: Subscribe,
  relays: string[],
  id: string,
  capMs: number,
): Promise<{ outcome: LookupOutcome; event: Event | null }> {
  if (relays.length === 0) return Promise.resolve({ outcome: "unreached", event: null });
  return new Promise((resolve) => {
    let done = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let sub: { close: () => void } | undefined;
    const answered = new Set<string>();
    const declined = new Set<string>();

    const finish = (outcome: LookupOutcome, event: Event | null = null) => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      clearTimeout(grace);
      try { sub?.close(); } catch { /* already closed */ }
      resolve({ outcome, event });
    };
    const mostAnswered = () => {
      const canAnswer = relays.length - declined.size;
      return answered.size > 0 && answered.size >= Math.floor(canAnswer / 2) + 1;
    };
    const maybeMissing = () => {
      if (done || grace || !mostAnswered()) return;
      grace = setTimeout(() => finish("missing"), MISSING_GRACE_MS);
    };

    const cap = setTimeout(() => finish(mostAnswered() ? "missing" : "unreached"), capMs);
    sub = subscribe(relays, { ids: [id] }, {
      onevent: (e) => { if (!done && e.id === id) finish("found", e); },
      // Every relay is done: absent if anyone really answered.
      oneose: () => finish(answered.size > 0 ? "missing" : "unreached"),
      onrelayeose: (relay) => { if (done) return; answered.add(relay); maybeMissing(); },
      onrelaydeclined: (relay) => { if (done || answered.has(relay)) return; declined.add(relay); maybeMissing(); },
    });
    // Settled while subscribing (a synchronous answer): close what just opened.
    if (done) { try { sub.close(); } catch { /* already closed */ } }
  });
}
