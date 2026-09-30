/**
 * The per-IP limit on trust-score lookups (/api/brainstorm/wot-batch).
 *
 * The limit protects the score relay, which is slow and not ours (3-5 s for
 * a lookup it hasn't served lately, measured 2026-09-30). The server now
 * answers almost every lookup from the full list it keeps in memory
 * (score-cards.ts), and those cost nothing, so only a lookup that will ask
 * the relay counts. Every request still counts against the general API limit
 * (server/index.ts).
 *
 * Before this, a cold Discover load's 6-9 lookups all counted: the fourth
 * load in a minute from one IP was refused and tiles said "Couldn't reach".
 */
export function createScoreLookupGate(opts: { max: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  /** Per IP: when its counted (relay-backed) lookups happened, oldest first. */
  const counted = new Map<string, number[]>();
  let lastSweep = -Infinity;

  /** IPs with nothing inside the window are dropped, so the map can't grow forever. */
  function sweep(t: number) {
    if (t - lastSweep < opts.windowMs) return;
    lastSweep = t;
    for (const [ip, times] of counted) {
      if (times.length === 0 || times[times.length - 1] <= t - opts.windowMs) counted.delete(ip);
    }
  }

  /** May this lookup go ahead? Counts it when it will ask the relay and is allowed. */
  function allow(ip: string, lookup: { needsRelay: boolean }): boolean {
    if (!lookup.needsRelay) return true;
    const t = now();
    sweep(t);
    const recent = (counted.get(ip) ?? []).filter((at) => at > t - opts.windowMs);
    if (recent.length >= opts.max) { counted.set(ip, recent); return false; }
    recent.push(t);
    counted.set(ip, recent);
    return true;
  }

  return { allow, tracked: () => counted.size };
}
