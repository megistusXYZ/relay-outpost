/**
 * Pure route predicates for the mobile footer's tab active-states and the
 * chat-overlay hide contract. Extracted from MobileFooter.tsx so the behavior
 * is unit-testable (see footer-nav.test.ts), mirroring sidebar-nav.ts.
 *
 * `location` is wouter's pathname-only location string.
 */

/**
 * Routes that host a full-screen chat overlay (DM thread, Concord group chat).
 * These manage the footer hide via dm-thread-open/close events; every OTHER
 * route must reset the hidden state. This predicate IS the hide-contract
 * whitelist — Messages.tsx and ConcordOutpost.tsx both rely on it.
 */
export function isChatOverlayRoute(location: string): boolean {
  return location.startsWith("/messages") || location.startsWith("/outposts/c/");
}

/**
 * Chats tab: active on the conversation list, a DM thread, or a Concord group
 * chat (group chats live under /outposts/c/ but belong to Chats now).
 * Intentionally the same route set as the chat-overlay whitelist.
 */
export function isChatsTabActive(location: string): boolean {
  return isChatOverlayRoute(location);
}

/**
 * Communities tab: the public NIP-29 hub and outpost detail pages — every
 * /outposts route EXCEPT Concord group chats (/outposts/c/), which highlight
 * the Chats tab instead.
 */
export function isCommunitiesTabActive(location: string): boolean {
  if (!(location === "/outposts" || location.startsWith("/outposts/"))) return false;
  return !location.startsWith("/outposts/c/");
}

/**
 * News tab: the RSS news reader, which renders under /search with the media tab
 * and a `type=news` query (see Search.tsx). This is a query-scoped tab, so it
 * takes BOTH the pathname and the raw query string — wouter's `useSearch()`
 * value (no leading "?"; URLSearchParams tolerates one anyway).
 */
export function isNewsTabActive(location: string, search: string): boolean {
  // The standalone route is back (Discover bento restored it); the
  // query-scoped /search path remains for embedded and legacy links.
  if (location === "/news") return true;
  if (location !== "/search") return false;
  return new URLSearchParams(search).get("type") === "news";
}

/**
 * Media tab: the media view of /search — which is the same route News uses, so
 * the `type=news` query wins when both are present.
 */
export function isMediaTabActive(location: string, search: string): boolean {
  // Standalone /articles is back (Discover bento); under the EXPANDED IA it
  // belongs to Media, exactly where its old redirect
  // (/search?tab=media&type=articles) used to land it.
  if (location === "/articles") return true;
  if (location !== "/search") return false;
  const params = new URLSearchParams(search);
  return params.get("tab") === "media" && params.get("type") !== "news";
}

/**
 * THE active-state predicate for every nav surface — mobile footer and desktop
 * rail both — keyed by `NavDestination.id`.
 *
 * It is keyed by id on purpose. The rail used to carry its own copy that
 * special-cased on nav TITLE strings ("Feed"/"Media"/"News"); when the collapsed
 * IA renamed home to "Discover" that list matched nothing, so the fallback
 * `location.startsWith(path)` ran against path "/" — true on every route — and
 * the rail marked Discover as the current page everywhere, next to whichever
 * destination was actually current. Titles are copy and copy changes; ids are
 * identity. Adding a destination means adding a case here, once.
 *
 * The `collapsed` argument only changes one thing, but it's the interesting one:
 * with no Communities tab, the whole `/outposts` namespace belongs to Chats.
 * That isn't a fallback — it's the governing idea made concrete. A community you
 * are IN is a conversation; finding a new one is Discover's job.
 */
export function isNavDestinationActive(
  id: string,
  location: string,
  search: string,
  collapsed = false,
): boolean {
  switch (id) {
    case "feed":
      return location === "/";
    case "media":
      return isMediaTabActive(location, search);
    case "news":
      return isNewsTabActive(location, search);
    case "communities":
      return isCommunitiesTabActive(location);
    case "calendar":
      return location.startsWith("/calendar");
    case "chats":
      return collapsed
        ? location.startsWith("/messages") || location.startsWith("/outposts")
        : isChatsTabActive(location);
    // "alerts" is the expanded IA's name for the same destination as "activity".
    case "alerts":
    case "activity":
      return location.startsWith("/notifications");
    case "discover":
      // The bento, its lanes, and search. `/` (the feed) deliberately lights
      // NOTHING under the collapsed IA: since the bento, the feed is a place
      // you VISIT FROM Discover, and lighting the Discover tab while reading
      // the feed would claim you are somewhere you are not. /news and
      // /articles ARE Discover lanes though — standalone routes the bento's
      // tiles open — so the tab stays lit inside them (article details
      // included; /articles/write is the Create studio's, not a lane).
      return location.startsWith("/discover") || location.startsWith("/search")
        || location === "/news"
        || (location.startsWith("/articles") && location !== "/articles/write");
    case "you":
      return location.startsWith("/account");
    // "create" and any future action entry open something; they aren't places,
    // so they are never current.
    default:
      return false;
  }
}
