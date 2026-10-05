/**
 * Relays that just refused to connect, and how long to leave them be.
 *
 * Every read, publish and probe goes through the pool's ensureRelay, and the
 * pool dialed afresh each time — so a relay that's down (relay.primal.net
 * answering 502s, 2026-10-04) was dialed 9 times in 15 s by one page. After a
 * refused dial the relay is left alone for a while, longer each time it
 * refuses again: 15 s, 30 s, 1 min, 2 min, then 5 min. One success forgets it;
 * so does the network coming back (lib/nostr.ts listens for `online`).
 */
const STEPS_MS = [15_000, 30_000, 60_000, 120_000, 300_000];

export function createDialMemory() {
  const refused = new Map<string, { times: number; until: number }>();
  const key = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");
  return {
    /** Milliseconds left before this relay may be dialed again (0 = go ahead). */
    waitFor(url: string, now: number): number {
      const r = refused.get(key(url));
      return r && r.until > now ? r.until - now : 0;
    },
    failed(url: string, now: number) {
      const k = key(url);
      const times = (refused.get(k)?.times ?? 0) + 1;
      refused.set(k, { times, until: now + STEPS_MS[Math.min(times, STEPS_MS.length) - 1] });
    },
    succeeded(url: string) { refused.delete(key(url)); },
    forgetAll() { refused.clear(); },
  };
}
