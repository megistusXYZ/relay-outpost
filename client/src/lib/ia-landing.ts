/**
 * "Everyone lands on Chats" (decision 8) — one behaviour for everyone, not a
 * grandfathering split. Opening the app puts you in front of the people you
 * know; your feed is one tap away, unchanged.
 *
 * THIS IS NOT A REDIRECT ON `/`. The feed lives at `/` (since the Discover
 * bento, the nav's Discover entry points at /discover and `/` is the Feed
 * tile's destination). A route-level redirect on `/` would bounce you out of
 * the feed every single time you opened it, which doesn't just fail the
 * feature, it deletes a destination.
 *
 * So the rule is about ARRIVING, not about the route: the first time a browser
 * tab opens the app at the bare root, send it to Chats. After that the tab is
 * "landed" and `/` behaves as the feed forever.
 *
 * Everything that carries intent is left alone — a deeper path, a query string,
 * a hash. `/?inviter=npub1…` is the case that matters: an invite arrival must
 * reach the code that captures the marker, and silently rewriting the URL out
 * from under it would drop the connection the whole invite rail exists to make.
 */
const LANDED_KEY = "ro_ia_landed";

export const CHATS_PATH = "/messages";

/** The one-time welcome a brand-new account sees after signing up. */
export const WELCOME_PATH = "/welcome";

/**
 * Pure decision. The caller supplies the environment so the rule can be tested
 * without a DOM, and so every guard is visible in one place.
 */
export function shouldLandOnChats(env: {
  /** Signed out ⇒ no Chats to land on; the collapsed nav shows Discover only. */
  pubkey: string | null | undefined;
  collapsed: boolean;
  pathname: string;
  /** location.search — any query means the URL carries intent. */
  search: string;
  /** location.hash — same. */
  hash: string;
  /** Has this tab already landed once? */
  landed: boolean;
}): boolean {
  if (!env.pubkey) return false;
  if (!env.collapsed) return false;
  if (env.landed) return false;
  // Only the bare root. "/" with a trailing nothing — a deeper path is a
  // deliberate destination and a reload of one must not be hijacked.
  if (env.pathname !== "/") return false;
  if (env.search && env.search !== "?") return false;
  if (env.hash && env.hash !== "#") return false;
  return true;
}

/**
 * Per TAB, deliberately — sessionStorage, not localStorage.
 *
 * Reloading while on Discover must not throw you back to Chats: the tab has
 * already landed, so a refresh keeps you where you were. Opening a new tab is a
 * new arrival and lands again. localStorage would make the very first visit the
 * only one that ever lands.
 */
export function hasLanded(): boolean {
  try {
    return sessionStorage.getItem(LANDED_KEY) === "1";
  } catch {
    // No sessionStorage (private mode, blocked): treat as already landed so a
    // failure can never produce a redirect loop.
    return true;
  }
}

export function markLanded(): void {
  try {
    sessionStorage.setItem(LANDED_KEY, "1");
  } catch {}
}

/**
 * Where a sign-in lands you, when no deep link claimed the navigation.
 *
 * Pure so the rule is testable and stated once, because it was neither. Two
 * call sites (AppLayout's post-auth effect and Login's redirect) each carried
 * their own `let dest = "/search"`, and under the collapsed IA "/search" IS
 * Discover — the surface Decision 2 deliberately demoted. So Decision 8
 * ("Everyone lands on Chats — including existing users") was false for every
 * null -> pubkey transition: unlocking an encrypted local key, signing in
 * through the overlay, and creating a new account. A brand-new member's first
 * screen after signup was the public firehose.
 *
 * The user's explicit Settings choice still wins over both. It is a preference
 * they set on purpose; the collapse was never a reason to ignore it.
 */
export function postAuthLandingPath(
  saved: string | null | undefined,
  collapsed: boolean,
  /** A brand-new account (created here, not signed in from elsewhere), and whether it has seen the welcome. */
  account?: { isNew: boolean; welcomed: boolean },
): string {
  // A new member meets the welcome once: an empty inbox explains nothing.
  // (An invite deep link still wins: it's applied after this, with replace.)
  if (account?.isNew && !account.welcomed) return WELCOME_PATH;
  if (saved && saved.startsWith("/")) return saved;
  return collapsed ? CHATS_PATH : "/search";
}

/**
 * Hold the feed back while a launch is about to land on Chats, so it isn't
 * downloaded and mounted only to be dropped a frame later.
 *
 * Decided on the ARRIVAL (the URL the tab opened at), never on the current
 * location alone: the landing effect runs for the arrival only, so a later tap
 * to "/" (Discover → Feed) in a tab that arrived elsewhere is never
 * redirected, and holding the feed there left the page blank (2026-09-29).
 */
export function holdHomeForLanding(env: {
  /** The current location. */
  location: string;
  /** Where this tab opened. */
  arrival: { pathname: string; search: string; hash: string };
  pubkey: string | null | undefined;
  collapsed: boolean;
  landed: boolean;
}): boolean {
  if (env.location !== "/") return false;
  return shouldLandOnChats({
    pubkey: env.pubkey,
    collapsed: env.collapsed,
    pathname: env.arrival.pathname,
    search: env.arrival.search,
    hash: env.arrival.hash,
    landed: env.landed,
  });
}
