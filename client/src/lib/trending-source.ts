/**
 * Trending's "Overall" ranking comes only from Primal. Owner's rule
 * (2026-09-30): Primal supports, it never leads. So when Overall can't be
 * reached (its main host answers 502 at times; measured 2026-10-03), Trending
 * shows our own server's chart instead, most replied today, and says so,
 * rather than an empty page that looks like nobody posted. A fully
 * unreachable Primal doesn't fail, its client keeps retrying, so Overall
 * gets OVERALL_WAIT_MS and no more.
 */
/** How long Overall gets before our chart stands in (a down Primal can hang, not fail). */
export const OVERALL_WAIT_MS = 6_000;

export async function overallOrOurs<T>(
  overall: () => Promise<T[]>,
  ours: () => Promise<T[]>,
  waitMs = OVERALL_WAIT_MS,
): Promise<{ posts: T[]; fellBack: boolean }> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const got = await Promise.race([
      overall(),
      new Promise<T[]>((resolve) => { timer = setTimeout(() => resolve([]), waitMs); }),
    ]);
    clearTimeout(timer);
    if (got.length > 0) return { posts: got, fellBack: false };
  } catch {}
  try {
    const got = await ours();
    if (got.length > 0) return { posts: got, fellBack: true };
  } catch {}
  return { posts: [], fellBack: false };
}
