/**
 * What the calendar shows when nothing is on it. Three outcomes, not two
 * (RELAY_REACHABILITY.md): content, genuinely empty, and "we never got to
 * ask" — the last must never be stated as the second. QA 2026-10-01: with
 * the relays unreachable the page said "Your calendar is empty".
 */
export type CalendarEmptyState = "loading" | "unreachable" | "empty" | "content";

export function calendarEmptyState(env: {
  /** The first load is still running. */
  loading: boolean;
  /** Anything at all to show, from any source. */
  hasItems: boolean;
  /** Did the published-posts lookup reach a relay? null = not asked (signed out, no relays). */
  reachedRelays: boolean | null;
}): CalendarEmptyState {
  if (env.hasItems) return "content";
  if (env.loading) return "loading";
  if (env.reachedRelays === false) return "unreachable";
  return "empty";
}
