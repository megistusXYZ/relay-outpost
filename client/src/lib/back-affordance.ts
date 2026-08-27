/**
 * One back arrow per screen.
 *
 * Owner reports (2026-08-14, News + What's New screenshots): pages kept
 * growing second back arrows — a "← Discover" header back over the
 * feed-level back-to-all, hero backs under the app chrome's back. The
 * resolution, in order of what survived:
 *
 * 1. A page's own drill-in (a selected feed) keeps its contextual back.
 * 2. Persistent navigation (the bottom bar's Discover tab) beats a header
 *    back that says the same thing — News's "← Discover" was removed
 *    outright once the gate proved it redundant.
 * 3. For everything else, the app chrome's back is THE back: full pages —
 *    What's New, every help guide, the settings/tools sub-pages, Community,
 *    the stream detail — had their own hero backs deleted. Chrome's is a
 *    full-size target in the standard top-left spot, and it pops real
 *    history (a "Back to Search" link rebuilt /search and lost the query;
 *    chrome restores the results you left).
 *
 * The one thing the deleted page backs knew that chrome didn't was where UP
 * is on a cold deep link — a shared help article should climb to the help
 * index, not fall back to the messages tab. This map preserves exactly that:
 * it is ONLY the chrome back's cold-entry fallback; with history present,
 * popping still wins. Null means the caller keeps its own default.
 */
const PARENT_ROUTES: Array<[RegExp, string]> = [
  [/^\/help\/./, "/help"],
  [/^\/whats-new$/, "/"],
  [/^\/settings\/danger$/, "/settings"],
  [/^\/(key-backup|muted|media-servers|trust-reviews|tickets)$/, "/tools"],
  [/^\/community\//, "/search"],
  [/^\/live\/./, "/live"],
  // Marketplace is Discover's commerce door — chrome back returns there.
  [/^\/marketplace$/, "/discover"],
];

export function parentRouteOf(path: string): string | null {
  for (const [re, parent] of PARENT_ROUTES) {
    if (re.test(path)) return parent;
  }
  return null;
}
