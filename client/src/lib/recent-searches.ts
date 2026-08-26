/**
 * Per-account MRU of recent search queries, feeding the Stories menu's
 * empty-search suggestions. LOCAL only (never synced or published): recorded
 * when a search is submitted / "See all results" is tapped / a typeahead
 * result is chosen, read synchronously when the search input focuses empty.
 *
 * The list logic (`pushRecentSearch`) is pure and unit-tested; the
 * localStorage wrappers are guarded for tests/SSR/quota.
 */

export const RECENT_SEARCHES_CAP = 5;
/** Queries longer than this are noise (pasted blobs) — never recorded. */
export const RECENT_SEARCH_MAX_LEN = 120;

const keyFor = (pubkey: string | null | undefined) =>
  `ro_recent_searches_${pubkey ?? "anon"}`;

/**
 * Pure MRU push: whitespace-normalized, newest first, deduped
 * case-insensitively (re-searching "Nostr" moves the earlier "nostr" row up
 * but keeps the newest casing), capped. Empty/oversized queries are ignored.
 */
export function pushRecentSearch(
  list: readonly string[],
  query: string,
  cap: number = RECENT_SEARCHES_CAP,
): string[] {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q || q.length > RECENT_SEARCH_MAX_LEN) return [...list].slice(0, cap);
  const rest = list.filter((x) => x.toLowerCase() !== q.toLowerCase());
  return [q, ...rest].slice(0, cap);
}

export function getRecentSearches(pubkey: string | null | undefined): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(keyFor(pubkey));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .slice(0, RECENT_SEARCHES_CAP);
  } catch {
    return [];
  }
}

export function recordRecentSearch(
  pubkey: string | null | undefined,
  query: string,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const next = pushRecentSearch(getRecentSearches(pubkey), query);
    localStorage.setItem(keyFor(pubkey), JSON.stringify(next));
  } catch {}
}

export function clearRecentSearches(pubkey: string | null | undefined): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(keyFor(pubkey));
  } catch {}
}
