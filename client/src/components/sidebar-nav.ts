/**
 * Pure active-state predicate for the sidebar's primary nav (Search / Feed /
 * Media / News). Extracted from app-sidebar.tsx so the "exactly one item is
 * active" invariant can be unit-tested (the mobile "multiple items lit" bug).
 *
 * News and Media both live under /search?tab=media (split by ?type=), and
 * Search is any other /search view. `location` is the pathname (wouter's
 * useLocation is pathname-only); `search` is the query string (wouter's
 * useSearch), with or without a leading "?".
 */
export function isNavItemActive(
  location: string,
  search: string,
  item: { title: string; path: string },
): boolean {
  const params = new URLSearchParams(search);
  const onSearchPath = location.startsWith("/search");
  // /news is a real route again (Discover bento); the query-scoped view stays.
  const isNewsView = location === "/news" || (onSearchPath && params.get("type") === "news");
  const isMediaView = onSearchPath && params.get("tab") === "media" && !isNewsView;

  if (item.title === "News") return isNewsView;
  if (item.title === "Media") return isMediaView;
  if (item.path === "/") return location === "/";
  if (item.path === "/search") return onSearchPath && params.get("tab") !== "media";
  return location.startsWith(item.path);
}
