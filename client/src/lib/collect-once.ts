import type { Event } from "nostr-tools";

export type Subscribe = (
  relays: string[],
  filter: object,
  handlers: { onevent: (e: Event) => void; oneose: () => void },
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
 * ~8 s each, 17.7 s in all). It never settles early with nothing in hand, so
 * an empty answer still means the relays answered (or the cap ran out).
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

    const cap = setTimeout(finish, capMs);
    sub = subscribe(relays, filter, {
      onevent: (e) => {
        if (done) return;
        opts.onEvent?.(e);
        collected.push(e);
        armQuiet();
      },
      oneose: finish,
    });
    // Finished while subscribing (a synchronous EOSE): close what just opened.
    if (done) { try { sub.close(); } catch { /* already closed */ } }
  });
}
