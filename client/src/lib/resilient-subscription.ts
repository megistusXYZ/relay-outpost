import type { Event, Filter } from "nostr-tools";

/**
 * Self-healing wrapper for "persistent" relay subscriptions.
 *
 * A nostr-tools subscription is only as alive as its websocket: when the socket
 * dies (idle NAT/proxy timeout, mobile backgrounding, relay restart) or the
 * initial connect fails, every open REQ on it is closed and nothing reopens it.
 * Consumers like the Concord chat pane sat on a dead subscription and simply
 * stopped receiving — the "messages only appear after backing out and
 * re-entering" bug.
 *
 * This wrapper supervises one underlying subscription: when the underlying sub
 * reports that it closed underneath the consumer (i.e. NOT via the caller's own
 * `close()`), it reopens with the original relays + filters on an exponential
 * backoff, and `kick()` fast-forwards a pending retry (wired to `online` /
 * visibilitychange in nostr.ts). Reopens replay some relay history — every
 * consumer of persistent subscriptions already dedupes by event id (Concord's
 * stream ledger, DM decrypt-once ledger, Map-by-id folds), so replays are safe.
 *
 * Pure and injectable (the opener is a parameter) so it unit-tests with fake
 * timers and a fake opener.
 */
export interface ResilientConsumer {
  onevent?: (e: Event) => void;
  /** Fired at most ONCE across all reopens (EOSE is a loading-state signal). */
  oneose?: () => void;
}

export interface ResilientHandle {
  close(): void;
  /** Fast-forward a scheduled reopen (no-op while the sub is believed alive). */
  kick(): void;
}

/** Opener for the underlying subscription. `onclose` MUST fire when the
 *  subscription ends for any reason other than the returned `close()`. */
export type ResilientOpener = (
  relays: string[],
  filters: Filter | Filter[],
  handlers: { onevent: (e: Event) => void; oneose: () => void; onclose: () => void },
) => { close(): void };

const BASE_DELAY_MS = 1_500;
const MAX_DELAY_MS = 30_000;
// A generation that stays open this long is treated as genuinely healthy and
// resets the backoff. We deliberately do NOT reset on the first `onevent`:
// every `since`-based reopen replays stored events, so resetting on a replayed
// event would peg a persistently-flapping relay at the retry floor forever (a
// ~1.5s reopen→replay→reset loop that never backs off — the DM/notif tails that
// took the browser down).
const STABLE_RESET_MS = 10_000;

export function openResilientSub(
  open: ResilientOpener,
  relays: string[],
  filters: Filter | Filter[],
  consumer: ResilientConsumer,
  opts?: { baseDelayMs?: number; maxDelayMs?: number; stableResetMs?: number },
): ResilientHandle {
  const baseDelay = opts?.baseDelayMs ?? BASE_DELAY_MS;
  const maxDelay = opts?.maxDelayMs ?? MAX_DELAY_MS;
  const stableResetMs = opts?.stableResetMs ?? STABLE_RESET_MS;
  let closedByCaller = false;
  let eoseFired = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let current: { close(): void } | null = null;

  const scheduleReopen = (delayMs: number) => {
    if (closedByCaller || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      openOnce();
    }, delayMs);
  };

  const openOnce = () => {
    if (closedByCaller) return;
    // Guards this generation: a late onclose from a superseded/closed instance
    // must not schedule another reopen.
    let stale = false;
    // Health is measured by uptime, not by event flow (see STABLE_RESET_MS): a
    // generation that survives this long without closing resets the backoff.
    let stableTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      stableTimer = null;
      if (!closedByCaller && !stale) attempt = 0;
    }, stableResetMs);
    const clearStable = () => {
      if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
    };
    const sub = open(relays, filters, {
      onevent: (e) => {
        if (closedByCaller || stale) return;
        consumer.onevent?.(e);
      },
      oneose: () => {
        if (eoseFired) return;
        eoseFired = true;
        consumer.oneose?.();
      },
      onclose: () => {
        if (closedByCaller || stale) return;
        stale = true;
        clearStable();
        current = null;
        const delay = Math.min(maxDelay, baseDelay * 2 ** Math.min(attempt, 8));
        attempt++;
        scheduleReopen(delay);
      },
    });
    current = {
      close: () => {
        stale = true;
        clearStable();
        sub.close();
      },
    };
    if (stale) current = null; // onclose fired synchronously during open
  };

  openOnce();

  return {
    close() {
      if (closedByCaller) return;
      closedByCaller = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      current?.close();
      current = null;
    },
    kick() {
      if (closedByCaller || !retryTimer) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      openOnce();
    },
  };
}
