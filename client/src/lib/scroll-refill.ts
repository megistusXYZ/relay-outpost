/**
 * When must an infinite-scroll sentinel fire AGAIN by itself?
 *
 * IntersectionObserver only reports TRANSITIONS. The community trust filter
 * exposed the gap (owner repro, 2026-08-13): a page of 30 arrives, the filter
 * hides 29, the list grows one row, the sentinel never LEAVES the viewport —
 * so no transition ever comes and the feed is dead with "Hiding 29 on this
 * tab" showing exactly why. Filtering must starve the PAGE, not the SCROLL:
 * the refill decision has to come from the data side — "a load just finished
 * and the sentinel is still on screen" — not from the observer.
 *
 * Pure, because the only thing this rule needs to be is impossible to get
 * wrong in a component: fire exactly once per completed load, only while
 * visible, only while there is more.
 */
export interface RefillInput {
  /** isLoading on the PREVIOUS render — a completed load is true → false. */
  wasLoading: boolean;
  isLoading: boolean;
  /** Is the sentinel currently within the observer's expanded viewport? */
  intersecting: boolean;
  hasMore: boolean;
}

export function shouldRetriggerLoad({ wasLoading, isLoading, intersecting, hasMore }: RefillInput): boolean {
  // Only the completion edge — anything else double-fires or fires mid-load.
  if (!wasLoading || isLoading) return false;
  if (!intersecting) return false; // content pushed us away: normal scrolling resumes
  return hasMore;
}
