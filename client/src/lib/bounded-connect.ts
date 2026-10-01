/**
 * Every relay connect is bounded, whoever starts it.
 *
 * nostr-tools keeps ONE connection promise per relay and hands it to every
 * caller. Its timeout is a property of whichever call created that promise:
 * start a connect without one (a direct `ensureRelay(url)`, or the library's
 * own reconnect) against a relay whose socket then sits in CONNECTING — no
 * open, no error, which a browser will leave that way for minutes — and every
 * later read that includes the relay waits on a promise nothing will settle.
 * A multi-relay `querySync` needs every relay to finish, so it never returns.
 *
 * Measured 2026-10-01: a socket to one default relay created at 0.4 s and
 * still CONNECTING at 20 s; the profile's repost lookup across six relays
 * never returned although two had answered in 0.2 s, so profiles showed no
 * reposts at all.
 *
 * Two guards, because either alone leaves a hole:
 *  - the timeout is passed down, so on a FIRST connect the library's own
 *    timer rejects the shared promise and tears the relay down;
 *  - the call is also raced against our own timer, which covers a promise the
 *    library created without a timeout. When ours fires the relay is dropped,
 *    so the next attempt starts a fresh socket rather than joining the stuck one.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
/** Our timer fires a little after the library's, so its cleaner path wins when it can. */
const GRACE_MS = 500;

export function boundEnsureRelay<R, P extends { connectionTimeout?: number }>(
  ensureRelay: (url: string, params?: P) => Promise<R>,
  dropRelay: (url: string) => void,
  defaultMs: number = DEFAULT_CONNECT_TIMEOUT_MS,
): (url: string, params?: P) => Promise<R> {
  return (url, params) => {
    const timeout = params?.connectionTimeout ?? defaultMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stuck = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try { dropRelay(url); } catch {}
        reject(new Error("relay connection timed out"));
      }, timeout + GRACE_MS);
    });
    const attempt = ensureRelay(url, { ...(params as P), connectionTimeout: timeout });
    // The attempt may reject after our timer already did; that rejection has
    // been answered and must not surface as unhandled.
    attempt.catch(() => {});
    return Promise.race([attempt, stuck]).finally(() => clearTimeout(timer));
  };
}
