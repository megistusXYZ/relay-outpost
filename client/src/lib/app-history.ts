/**
 * An in-app history index in `history.state` — the X-style back model.
 *
 * WHY. Both back paths (the header arrow and the edge swipe) used to decide
 * with `window.history.length > 1`. Per MDN, `length` counts the ENTIRE tab
 * session — entries from before the app ever loaded, plus forward entries —
 * and it never shrinks. So "there is an entry to pop" was routinely wrong,
 * and `history.back()` popped past the app's first entry: in a browser tab
 * that lands on the referrer; in a standalone PWA there is nothing behind the
 * app at all, so the screen went blank ("glitches and flickers and or goes
 * blank on mobile pwa").
 *
 * THE MODEL. Every entry the app creates carries a monotonically increasing
 * index in its own `history.state`:
 *
 *   - the boot entry is stamped 0 (never claimed as poppable);
 *   - `pushState` stamps current+1 — opening a detail deepens the stack;
 *   - `replaceState` carries the index forward — tab switches replace, so
 *     tabs never deepen the stack (same behaviour as X);
 *   - Back is permitted ONLY when the current index > 0, which by
 *     construction means the previous entry is ours.
 *
 * The index lives in the entry itself, so it survives reloads, bfcache and
 * PWA resume for free — that is precisely what History.state is for. It
 * COMPOSES with scroll-restore's `_scrollToken`, which rides in the same
 * object: both sides spread the existing state rather than replacing it.
 *
 * Installed ONCE at boot (main.tsx), by patching pushState/replaceState on
 * the history object — wouter, RouteRedirect, the param-stripping
 * `replaceState(null, …)` idiom and every future caller inherit the stamp
 * without knowing about it.
 */

export const APP_HISTORY_KEY = "roHistIdx";

interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** The index carried by a state object, or null when the entry is not ours. */
export function readAppIndex(state: unknown): number | null {
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const v = (state as Record<string, unknown>)[APP_HISTORY_KEY];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * The caller's state with our index folded in. Object states keep every field
 * (scroll-restore's `_scrollToken` must ride along); null/undefined become a
 * bare stamp. Non-object states (primitives, arrays) are replaced by the bare
 * stamp — nothing in this codebase stores them, and an entry we cannot stamp
 * is an entry Back cannot reason about.
 */
export function stampState(callerState: unknown, idx: number): Record<string, unknown> {
  const base =
    callerState && typeof callerState === "object" && !Array.isArray(callerState)
      ? (callerState as Record<string, unknown>)
      : {};
  return { ...base, [APP_HISTORY_KEY]: idx };
}

/**
 * The index we were at BEFORE the current entry — the only reliable way to
 * tell a backward popstate from a forward one, since the event carries no
 * direction. Kept HERE because the patched pushState/replaceState are the
 * single choke point every navigation (wouter included) flows through; a
 * consumer that tracked this itself would go stale on any push it didn't
 * originate (exactly what broke modal-history's first cut).
 */
let lastNavIdx = 0;

/**
 * Call from a popstate handler: returns whether the navigation moved BACKWARD,
 * then advances the tracker to the new position. Idempotent per popstate —
 * the first caller in the turn gets the answer, so modal-history (the only
 * consumer) must be the one asking.
 */
export function wentBackward(h: HistoryLike = window.history): boolean {
  const now = readAppIndex(h.state) ?? 0;
  const back = now < lastNavIdx;
  lastNavIdx = now;
  return back;
}

/** Marker so a second install (HMR, tests) is a no-op instead of a double-stamp. */
const INSTALLED = Symbol.for("relay-outpost.app-history-installed");

export function installAppHistory(h: HistoryLike = window.history): void {
  const holder = h as HistoryLike & { [INSTALLED]?: boolean };
  if (holder[INSTALLED]) return;
  holder[INSTALLED] = true;

  // Stamp the boot entry — but only when it is unstamped. After a reload the
  // restored entry already carries its depth, and resetting it to 0 would
  // disown every entry beneath it.
  if (readAppIndex(h.state) === null) {
    try { h.replaceState(stampState(h.state, 0), ""); } catch { /* sandboxed */ }
  }
  lastNavIdx = readAppIndex(h.state) ?? 0;

  const origPush = h.pushState.bind(h);
  const origReplace = h.replaceState.bind(h);
  h.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    origPush(stampState(data, (readAppIndex(h.state) ?? 0) + 1), unused, url);
    // Advance the direction tracker on every push — wouter routes, guard
    // pushes, everything — so a later popstate compares against where we
    // actually were.
    lastNavIdx = readAppIndex(h.state) ?? lastNavIdx;
  };
  h.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    // A replace is an EDIT of the same entry, so the entry's existing state
    // carries forward underneath the caller's — the param-strip idiom
    // (`replaceState(null, "", url)`) must not destroy scroll-restore's
    // `_scrollToken` (or any other rider). Caller keys win on conflict.
    const prior =
      h.state && typeof h.state === "object" && !Array.isArray(h.state)
        ? (h.state as Record<string, unknown>)
        : {};
    const caller =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    origReplace(stampState({ ...prior, ...caller }, readAppIndex(h.state) ?? 0), unused, url);
  };
}

/** Current depth within the app; 0 on the boot entry or anything foreign. */
export function appHistoryIndex(h: HistoryLike = window.history): number {
  return readAppIndex(h.state) ?? 0;
}

/**
 * May Back pop real history? True only when the PREVIOUS entry is provably
 * ours. This is the one question every back control asks; `history.length`
 * must never be consulted again for it.
 */
export function canGoBackInApp(h: HistoryLike = window.history): boolean {
  return appHistoryIndex(h) > 0;
}
