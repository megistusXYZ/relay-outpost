// Pure decision logic for the shared WoT score store (GrapeRankScoresContext).
//
// Two backends feed one Map<pubkey, influence>:
//   • GLOBAL  — Meili wot_rank via POST /api/brainstorm/wot-batch (fast, batched,
//               fixed root observer). Values are PROVISIONAL: good enough to
//               render a dot immediately, but not the per-observer truth.
//   • PER-OBSERVER — GrapeRank influence via GET /api/graperank/user/{target}
//               (per-target, authenticated, same source the profile HUD shows).
//               Always authoritative: it must overwrite a provisional value.
//
// The bug this module exists to prevent (July 2026): Meili misses (-1) were
// written into the shared map as terminal values, so feed/thread authors showed
// an authoritative "No data" verdict until a profile visit happened to inject
// the per-observer score. Rules encoded here:
//   1. A global miss is never written to the map — no data renders as neutral,
//      not as a verdict.
//   2. Every author that got a global answer (hit OR miss) is still queued for
//      per-observer resolution; only per-observer resolution is terminal.
//   3. Once per-observer resolution has landed for a pubkey ("resolved"), late
//      global results must not clobber it.
//   4. Terminal per-observer misses retry after a cooldown instead of sticking
//      forever.

export interface BulkPlan {
  /** Provisional global scores to write into the shared map right away. */
  writes: Map<string, number>;
  /**
   * Pubkeys to queue for per-observer resolution, global misses first (a miss
   * has no dot at all; a provisional hit merely has an approximate one).
   */
  refine: string[];
}

/**
 * Turn a global (Meili) batch response into map writes + a per-observer
 * refinement queue.
 *
 * @param requested pubkeys the batch was asked about
 * @param results   global response; value >= 0 is wot_rank/100, value < 0 is a
 *                  server-cached "Meili has no data" miss marker
 * @param resolved  pubkeys whose per-observer resolution already completed —
 *                  never written or re-queued (per-observer wins)
 * @param room      remaining capacity of the refinement queue; overflow is
 *                  dropped (misses are kept preferentially)
 */
export function planBulkResults(
  requested: readonly string[],
  results: ReadonlyMap<string, number>,
  resolved: ReadonlySet<string>,
  room: number = Infinity,
): BulkPlan {
  const writes = new Map<string, number>();
  const missPks: string[] = [];
  const hitPks: string[] = [];
  const seen = new Set<string>();

  for (const pk of requested) {
    if (seen.has(pk)) continue;
    seen.add(pk);
    if (resolved.has(pk)) continue;
    const v = results.get(pk);
    if (v !== undefined && v >= 0) {
      writes.set(pk, v);
      hitPks.push(pk);
    } else {
      // Global miss (or chunk failure): write nothing — absent renders neutral.
      missPks.push(pk);
    }
  }

  const refine = [...missPks, ...hitPks].slice(0, Math.max(0, room));
  return { writes, refine };
}

export type ScoreRequestDecision =
  /** Already have what we need (or a retry is still cooling down). */
  | "skip"
  /** Not yet requested — put it on the bulk pipeline. */
  | "enqueue"
  /** A terminal miss whose cooldown expired — clear bookkeeping, then enqueue. */
  | "retry";

export interface ScoreRequestState {
  /** Current value in the shared map, if any. */
  existing: number | undefined;
  /** Per-observer resolution completed (score landed OR terminal miss). */
  resolved: boolean;
  /** Timestamp of the terminal per-observer miss, if that's how it resolved. */
  missAt: number | undefined;
  now: number;
  cooldownMs: number;
}

/**
 * Decide what a badge's score request should do. Works with a null shared map
 * (pass existing: undefined) — requests must hydrate the store, not require it.
 */
export function decideScoreRequest(state: ScoreRequestState): ScoreRequestDecision {
  const { existing, resolved, missAt, now, cooldownMs } = state;

  // A real (non-negative) score is present — either per-observer truth or a
  // provisional global value whose refinement was queued when it was written.
  if (existing !== undefined && existing >= 0) return "skip";

  if (resolved) {
    // Resolved with a score but the map lost it (shouldn't happen) — skip; or
    // resolved as a terminal miss — retry only after the cooldown.
    if (missAt === undefined) return "skip";
    return now - missAt < cooldownMs ? "skip" : "retry";
  }

  // Defensive: a legacy negative marker in the map (older sessions wrote -1).
  // Treat it like a miss: honor any recorded cooldown, otherwise retry so the
  // per-observer path can replace the stale verdict.
  if (existing !== undefined && existing < 0) {
    if (missAt !== undefined && now - missAt < cooldownMs) return "skip";
    return "retry";
  }

  return "enqueue";
}
