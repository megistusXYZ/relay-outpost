import type { Event } from "nostr-tools";

export type Subscribe = (
  relays: string[],
  filter: object,
  handlers: {
    onevent: (e: Event) => void;
    oneose: () => void;
    /** One relay genuinely finished answering (not a failed connection). */
    onrelayeose?: (relay: string) => void;
    /** One relay said no (rate limit, auth, failed connection): it won't answer. */
    onrelaydeclined?: (relay: string) => void;
  },
) => { close: () => void };

/** Give the fast relays this long before settling on what's in hand. */
const MIN_WAIT_MS = 1000;
/** Settle once posts have stopped arriving for this long. */
const QUIET_MS = 700;

/**
 * A one-shot relay lookup for a preview (Discover's tiles). Resolves when
 * every relay has finished (EOSE), or at the cap, as before, and now also
 * once it has posts and they've stopped arriving: one slow relay no longer
 * holds a tile for the full cap (measured: the Feed tile's two lookups took
 * ~8 s each, 17.7 s in all). With nothing in hand it settles only once most
 * relays have genuinely answered, so a dead relay can't hold an empty answer
 * for the full cap (measured with relay.primal.net down: the trusted-people
 * lookups sat 8 s after three relays had said "nothing"), and an empty answer
 * still means relays answered.
 */
export function collectOnce(
  subscribe: Subscribe,
  relays: string[],
  filter: object,
  capMs: number,
  opts: { onEvent?: (e: Event) => void } = {},
): Promise<Event[]> {
  return new Promise((resolve) => {
    const collected: Event[] = [];
    const startedAt = Date.now();
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let sub: { close: () => void } | undefined;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(cap);
      clearTimeout(quiet);
      try { sub?.close(); } catch { /* already closed */ }
      resolve(collected);
    };
    // Settle on what's in hand once it's gone quiet (never before MIN_WAIT_MS).
    const armQuiet = () => {
      clearTimeout(quiet);
      const wait = Math.max(QUIET_MS, MIN_WAIT_MS - (Date.now() - startedAt));
      quiet = setTimeout(finish, wait);
    };

    const answered = new Set<string>();
    const declined = new Set<string>();
    // Empty in hand: settle once a majority of the relays that can still
    // answer have (a relay that declined, e.g. damus's per-IP rate limit, has
    // given its answer); at least one real answer, never on declines alone.
    const maybeSettleEmpty = () => {
      if (collected.length > 0 || answered.size === 0) return;
      const canAnswer = relays.length - declined.size;
      if (answered.size >= Math.floor(canAnswer / 2) + 1) armQuiet();
    };

    const cap = setTimeout(finish, capMs);
    sub = subscribe(relays, filter, {
      onevent: (e) => {
        if (done) return;
        opts.onEvent?.(e);
        collected.push(e);
        armQuiet();
      },
      oneose: finish,
      onrelayeose: (relay) => {
        if (done) return;
        answered.add(relay);
        maybeSettleEmpty();
      },
      onrelaydeclined: (relay) => {
        if (done || answered.has(relay)) return;
        declined.add(relay);
        maybeSettleEmpty();
      },
    });
    // Finished while subscribing (a synchronous EOSE): close what just opened.
    if (done) { try { sub.close(); } catch { /* already closed */ } }
  });
}
