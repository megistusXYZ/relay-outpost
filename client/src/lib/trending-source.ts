/**
 * Trending's ranking comes from one outside service (Primal's "Overall").
 * Owner's rule (2026-09-30): Primal supports, it never leads, so nothing else
 * in the app waits on this, and Trending itself must say plainly when the
 * ranking can't be had.
 *
 * Asking has three outcomes, and they are kept apart: posts, an answer with
 * nothing in it (quiet), and no answer at all (never reached). A fully
 * unreachable Primal doesn't fail, its client keeps retrying, so the ranking
 * gets OVERALL_WAIT_MS and no more.
 *
 * Until 2026-11-21 a second outside service stood in when the first could not
 * answer ("most replied today"). It closed, and with it the stand-in.
 */
/** How long the ranking gets before it counts as not reached (a down Primal can hang, not fail). */
export const OVERALL_WAIT_MS = 6_000;

const NOT_REACHED = Symbol("not reached");

export async function overallRanking<T>(
  overall: () => Promise<T[]>,
  waitMs = OVERALL_WAIT_MS,
): Promise<{ posts: T[]; reached: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const got = await Promise.race([
      overall(),
      new Promise<typeof NOT_REACHED>((resolve) => { timer = setTimeout(() => resolve(NOT_REACHED), waitMs); }),
    ]);
    if (got === NOT_REACHED) return { posts: [], reached: false };
    return { posts: got, reached: true };
  } catch {
    return { posts: [], reached: false };
  } finally {
    clearTimeout(timer);
  }
}
