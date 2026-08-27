/**
 * What a Needs-you queue actually managed to ask.
 *
 * Both operator queues walk `getOutpostRelays()` and swallow each failure, on
 * purpose — one dead relay must not blank a queue the other relays answered.
 * The cost of that correct choice is that a partial sweep and a complete one
 * produce the same screen, and an empty queue means "nobody is waiting" and
 * "we couldn't ask" in exactly the same pixels.
 *
 * That is this project's oldest defect (`RELAY_REACHABILITY.md`): a fetch has
 * three outcomes and most code is written with two. The hooks already compute
 * the third — `use-admission-queue.ts` even says so in a comment, "Unreached is
 * not 'you run nothing here'" — and then dropped it on the floor.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY: nothing when zero relays were swept.
 *
 * That is the Concord-only operator, and it is a PERMANENT state for them —
 * they created a group chat, which registers no relay outpost, and Concord has
 * no knock event at all because the invite link is the door. A line explaining
 * that on every visit is a standing banner about a feature that does not apply
 * to them, which is noise, not honesty. Silence is right there; the fix for
 * *that* gap is giving Concord a door, not narrating its absence.
 *
 * A relay that was asked and did not answer is the opposite: transient, real,
 * and something the operator can act on.
 */
export interface QueueSweep {
  /** Outpost relays this run attempted. */
  relaysAttempted: number;
  /** Of those, how many never answered. */
  relaysUnreached: number;
  /** The urls that never answered — what the notice can NAME and act on. */
  unreachedUrls?: string[];
}

export const EMPTY_SWEEP: QueueSweep = { relaysAttempted: 0, relaysUnreached: 0, unreachedUrls: [] };

/**
 * One plain line, or null when silence is accurate.
 *
 * Applies whether or not the queue is empty: a partial sweep understates a
 * populated queue exactly as much as it understates an empty one.
 *
 * `subject` names WHAT could not be checked ("reports", "join requests").
 * Pass it wherever the notice can render without its queue's rows around it
 * — with an empty queue the notice is the component's ONLY output, and on
 * the Activity page a context-free "may be incomplete" read as "your
 * notifications are broken" (live report, 2026-08-26). The subject form
 * still claims nothing about what exists on the unreached relay.
 */
export function sweepNotice(sweep: QueueSweep, subject?: string): string | null {
  const { relaysAttempted, relaysUnreached } = sweep;
  if (relaysUnreached <= 0) return null;
  // Guard the nonsense case rather than rendering "2 of 1".
  if (relaysAttempted <= 0 || relaysUnreached > relaysAttempted) return null;
  const tail = subject ? `so ${subject} there can't be checked.` : "so this may be incomplete.";
  const noun = subject ? "community relay" : "relay";
  if (relaysUnreached === relaysAttempted) {
    return relaysAttempted === 1
      ? `Couldn't reach your ${noun}, ${tail}`
      : `Couldn't reach any of your ${noun}s, ${tail}`;
  }
  return `Couldn't reach ${relaysUnreached} of ${relaysAttempted} ${noun}s, ${tail}`;
}

/**
 * The Activity page's ONE notice over several queue sweeps — "join requests
 * and reports" in a single line instead of two stacked near-duplicates, with
 * the failing relay urls so the card can name them and offer actions.
 * Subjects join only for sweeps that actually failed; urls are the union.
 */
export function combinedSweepNotice(
  entries: { sweep: QueueSweep; subject: string }[],
): { text: string; urls: string[] } | null {
  const failing = entries.filter(
    (e) => e.sweep.relaysUnreached > 0 && e.sweep.relaysAttempted > 0 && e.sweep.relaysUnreached <= e.sweep.relaysAttempted,
  );
  if (failing.length === 0) return null;

  const urls = [...new Set(failing.flatMap((e) => e.sweep.unreachedUrls ?? []))];
  const attempted = Math.max(...failing.map((e) => e.sweep.relaysAttempted));
  // With urls the union is the honest count; without them fall back to the max.
  const unreached = urls.length > 0 ? urls.length : Math.max(...failing.map((e) => e.sweep.relaysUnreached));
  const subject = [...new Set(failing.map((e) => e.subject))].join(" and ");

  const text = sweepNotice({ relaysAttempted: attempted, relaysUnreached: Math.min(unreached, attempted) }, subject);
  return text ? { text, urls } : null;
}
