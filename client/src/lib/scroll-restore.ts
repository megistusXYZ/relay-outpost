/**
 * Per-history-entry scroll position store.
 *
 * Each history entry gets a `_scrollToken` stamped into `history.state` (see
 * App.tsx `ScrollToTop`). While the user scrolls we continuously save the
 * container's exact `scrollTop` plus an element anchor (the `[data-event-id]`
 * row nearest the viewport top and its on-screen offset) keyed by that token.
 *
 * On back/forward — browser buttons, the in-app HeaderBackButton, anything
 * that goes through `history.back()` — the entry's token comes back with it,
 * so the restorer can put the container at the exact pixel it left, and the
 * anchor lets it fine-tune even when a virtualized list re-estimates heights.
 *
 * Feed pages (Home) also consult `hasPendingScrollRestore()` at mount to know
 * they are being returned to, so they re-render their cached snapshot instead
 * of a fresh (reshuffled) feed.
 */

import { tryVirtualScrollToEventId } from "@/lib/feed-scroll-bridge";

export interface SavedScrollPosition {
  /** Exact container scrollTop at save time. */
  scrollTop: number;
  /** `data-event-id` of the row nearest the viewport top, if any. */
  anchorId: string | null;
  /** The anchor element's top relative to the container top (px, can be negative). */
  anchorOffset: number;
  /**
   * Row index of the anchor within the VIRTUALIZED feed's pinned items list, if
   * the feed produced one at save time (null on non-feed surfaces). This is the
   * key to restoring by index instead of by a flat-estimate pixel offset — see
   * lib/feed-anchor.ts. Optional so non-feed / legacy saves stay valid.
   */
  anchorIndex?: number | null;
  /** Pixels the container was scrolled past the anchor row's top (feed only). */
  intraOffset?: number;
  savedAt: number;
}

const positions = new Map<string, SavedScrollPosition>();
const MAX_POSITIONS = 500;

// ---------------------------------------------------------------------------
// Persistence.
//
// `history.state._scrollToken` already survives everything — a reload, a PWA
// relaunch, iOS discarding a backgrounded tab — because the browser persists
// history state for us. The POSITIONS did not: they lived in the Map above and
// nowhere else, so any of those events emptied the store while the returning
// entry still carried a perfectly good token. Back landed at the top of the
// feed, intermittently, in exactly the way a user reports as "sometimes it
// forgets where I was".
//
// sessionStorage, deliberately, not localStorage: a history stack belongs to
// ONE tab, and so does sessionStorage. localStorage is shared, so two tabs
// scrolled to different places would overwrite each other's positions under
// colliding tokens and restore the wrong one.
//
// Writing on every save would hit storage on every scroll frame, so the Map
// stays the hot path and the flush is debounced — plus an immediate flush on
// `pagehide`/hidden, which is the last callback guaranteed to run before a
// mobile browser reclaims the page.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ro_scroll_v1";
/** Persist fewer than we keep in memory: the recent ones are the ones anyone goes back to. */
export const MAX_PERSISTED_POSITIONS = 60;

/** Newest-last, capped. Exported for tests — the cap is what keeps the write cheap. */
export function serializePositions(
  map: Map<string, SavedScrollPosition>,
  cap = MAX_PERSISTED_POSITIONS,
): string {
  // Map iteration is insertion-ordered and `saveScrollPosition` re-inserts on
  // every update, so the tail is the most recently touched.
  const entries = [...map.entries()].slice(-cap);
  return JSON.stringify(entries);
}

/** Never throws: a corrupt or foreign payload yields an empty store, not a crash. */
export function deserializePositions(raw: string | null): Map<string, SavedScrollPosition> {
  const out = new Map<string, SavedScrollPosition>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry;
      if (typeof key !== "string" || !value || typeof value !== "object") continue;
      if (typeof value.scrollTop !== "number" || !Number.isFinite(value.scrollTop)) continue;
      out.set(key, {
        scrollTop: value.scrollTop,
        anchorId: typeof value.anchorId === "string" ? value.anchorId : null,
        anchorOffset: Number.isFinite(value.anchorOffset) ? value.anchorOffset : 0,
        anchorIndex: Number.isFinite(value.anchorIndex) ? value.anchorIndex : null,
        intraOffset: Number.isFinite(value.intraOffset) ? value.intraOffset : undefined,
        savedAt: Number.isFinite(value.savedAt) ? value.savedAt : 0,
      });
    }
  } catch {}
  return out;
}

function flushPositions() {
  try {
    sessionStorage.setItem(STORAGE_KEY, serializePositions(positions));
  } catch {
    // Private mode, quota, disabled storage — restoring within the session still
    // works off the Map, which is what it did before this existed.
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushPositions(); }, 500);
}

if (typeof window !== "undefined") {
  try {
    for (const [k, v] of deserializePositions(sessionStorage.getItem(STORAGE_KEY))) positions.set(k, v);
  } catch {}
  // pagehide covers the bfcache path and the iOS "app is going away" path that
  // never fires unload; the hidden transition covers a backgrounded tab that is
  // later reclaimed without any further callback.
  window.addEventListener("pagehide", flushPositions);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPositions();
  });
}

// Dev-only introspection (used by live QA): localStorage "debug-scroll-restore".
if (typeof window !== "undefined") {
  (window as any).__scrollPositions = positions;
}

export function scrollRestoreDebugEnabled(): boolean {
  try { return localStorage.getItem("debug-scroll-restore") === "1"; } catch { return false; }
}

function prune() {
  if (positions.size <= MAX_POSITIONS) return;
  const excess = positions.size - MAX_POSITIONS;
  const iter = positions.keys();
  for (let i = 0; i < excess; i++) {
    const key = iter.next().value;
    if (key !== undefined) positions.delete(key);
  }
}

export function getScrollToken(): string | null {
  try {
    return (history.state && history.state._scrollToken) ?? null;
  } catch {
    return null;
  }
}

export function ensureScrollToken(): string {
  let token = getScrollToken();
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      history.replaceState({ ...history.state, _scrollToken: token }, "");
    } catch {}
  }
  return token;
}

export function saveScrollPosition(token: string, pos: Omit<SavedScrollPosition, "savedAt">) {
  // Re-inserting moves the key to the end of the Map's iteration order, so
  // pruning always drops the least-recently-updated entries.
  positions.delete(token);
  positions.set(token, { ...pos, savedAt: Date.now() });
  prune();
  scheduleFlush();
}

export function getSavedScrollPosition(token: string | null): SavedScrollPosition | undefined {
  if (!token) return undefined;
  return positions.get(token);
}

/**
 * True when the CURRENT history entry has a meaningful saved position — i.e.
 * this mount is a return to a previously-scrolled page, and a restore is about
 * to run. Feed pages use this to render their cached snapshot (same items,
 * same order) instead of recomputing a fresh feed under the restored offset.
 */
export function hasPendingScrollRestore(): boolean {
  const saved = getSavedScrollPosition(getScrollToken());
  return !!saved && saved.scrollTop > 40;
}

// ---------------------------------------------------------------------------
// Restore-window state.
//
// A back/forward traversal that will be restored goes through two phases:
//
//   1. PENDING — armed on `popstate` (the browser has already swapped
//      `history.state`, so the returning entry's token and saved position are
//      readable), before React has re-rendered anything. The remounting
//      virtualized feed reads this to seed its scroll offset SYNCHRONOUSLY at
//      mount, so the very first paint renders the rows around the saved
//      position (no top-of-feed flash, anchor row present immediately).
//   2. ACTIVE — from the moment App.tsx's restorer takes over until its settle
//      window ends. Feed pages consult this to keep restore-only behavior
//      (e.g. "am I at top?" tracking stays frozen so a transient programmatic
//      scroll through 0 can't drop the rendered snapshot mid-restore).
//
// Forward navigations (pushState) mint a fresh token, so a stale PENDING flag
// can never resolve to a saved position — and the restorer consumes the flag
// on every location change regardless of which branch it takes.
// ---------------------------------------------------------------------------

let restorePending = false;
let restoreActive = false;

// ---------------------------------------------------------------------------
// Debug introspection (opt-in via localStorage "debug-scroll-restore"). The
// on-screen overlay (ScrollRestoreDebugOverlay) polls getRestoreDebugState()
// each frame while visible; everything here is inert when the flag is off.
// ---------------------------------------------------------------------------
export type RestorePhase = "idle" | "pending" | "active";
let restorePhase: RestorePhase = "idle";
let restoreActiveStartedAt = 0;

export interface RestoreDebugState {
  phase: RestorePhase;
  /** ms since the ACTIVE phase began (0 when not active). */
  activeElapsedMs: number;
  token: string | null;
  saved: SavedScrollPosition | undefined;
}

export function getRestoreDebugState(): RestoreDebugState {
  return {
    phase: restorePhase,
    activeElapsedMs: restorePhase === "active" ? Date.now() - restoreActiveStartedAt : 0,
    token: getScrollToken(),
    saved: getSavedScrollPosition(getScrollToken()),
  };
}

/**
 * Arm the pending flag from the (already swapped) current history entry.
 * Exposed for tests; production code runs it from the popstate listener.
 */
export function armRestorePendingFromHistory(): void {
  restorePending = hasPendingScrollRestore();
  if (restorePending) restorePhase = "pending";
  else if (restorePhase === "pending") restorePhase = "idle";
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    armRestorePendingFromHistory();
    if (scrollRestoreDebugEnabled()) console.debug(`[scroll-restore] popstate pending=${restorePending} token=${getScrollToken()} saved=${JSON.stringify(getSavedScrollPosition(getScrollToken()) ?? null)}`);
  });
}

/** A back/forward return with a saved position happened and the restorer hasn't started yet. */
export function isRestorePending(): boolean {
  return restorePending;
}

/**
 * Undo a pending arm. Called by modal-history when a popstate turns out to be
 * a modal-guard transition (open/close), NOT a real page navigation: the page
 * under the overlay never scrolled, so a restore armed for it would sit
 * unconsumed forever — freezing all scroll saves (isSavesSuspended stays true)
 * until an unrelated navigation. modal-history's popstate listener runs AFTER
 * this module's (registered later, in main.tsx), so the cancel lands after the
 * arm within the same event.
 */
export function cancelPendingRestore(): void {
  restorePending = false;
  if (restorePhase === "pending") restorePhase = "idle";
}

/**
 * True for the ENTIRE restore window — from the synchronous `popstate` arm
 * (PENDING) through the end of the restorer's settle (ACTIVE). Scroll-position
 * saves MUST early-return while this is true.
 *
 * Why: `popstate` has already swapped `history.state` to the RETURNING entry's
 * token, but React hasn't re-rendered yet, so the outgoing detail page is still
 * mounted. In that gap any scroll event it emits (height clamp, tap inertia, or
 * the trailing ~180ms save timer) would call `save()` and write the detail
 * page's scrollTop (~0) UNDER the returning entry's token — clobbering the exact
 * position the restore is about to read, landing the user at the top. Suspending
 * saves across the window closes that race. The native interactive swipe-back
 * dodges it (iOS commits `popstate` only at the end of its snapshotted
 * transition, so no scroll events fire in the gap); a button-triggered
 * `history.back()` does not, which is why "native good, in-app button bad".
 *
 * The flag spans both sub-phases continuously: `armRestorePendingFromHistory`
 * sets `restorePending` on popstate; `beginRestoreWindow` hands off
 * (restorePending→false, restoreActive→true); `endRestoreWindow` clears
 * `restoreActive` only after the settle has committed the target position — so
 * there is no gap where a save could sneak in before restore is done.
 */
export function isSavesSuspended(): boolean {
  return restorePending || restoreActive;
}

/** The App-level restorer is currently asserting/settling a saved position. */
export function isRestoreActive(): boolean {
  return restoreActive;
}

/** Called by the restorer when it starts driving the scroll position. */
export function beginRestoreWindow(): void {
  restorePending = false;
  restoreActive = true;
  restorePhase = "active";
  restoreActiveStartedAt = Date.now();
}

/**
 * Called by the restorer when the settle window ends (or is cancelled).
 * Deliberately leaves `restorePending` alone: within a route-change commit
 * React runs the OLD location's effect cleanup (which calls this) before the
 * NEW location's feed mounts, and that feed still needs the pending flag.
 * Pending is consumed by `beginRestoreWindow`, and a stale flag is inert —
 * `getPendingRestoreOffset` resolves through the CURRENT entry's token, which
 * has no saved position on non-restore navigations.
 */
export function endRestoreWindow(): void {
  restoreActive = false;
  if (restorePhase === "active") restorePhase = restorePending ? "pending" : "idle";
}

/**
 * The saved scrollTop the imminent restore will target, or null when no
 * restore is pending/active for the current history entry. Virtualized feeds
 * use this to seed `initialOffset` so their first render computes the correct
 * visible range.
 */
export function getPendingRestoreOffset(): number | null {
  if (!restorePending && !restoreActive) return null;
  const saved = getSavedScrollPosition(getScrollToken());
  return saved && saved.scrollTop > 40 ? saved.scrollTop : null;
}

/**
 * The full saved position the imminent/active restore will target, or null when
 * no restore is pending/active for the current entry. The virtualized feed uses
 * this to restore by ROW INDEX (`anchorIndex` + `intraOffset`) instead of by the
 * flat-estimate pixel offset — see VirtualFeed / lib/feed-anchor.ts.
 */
export function getPendingRestoreAnchor(): SavedScrollPosition | null {
  if (!restorePending && !restoreActive) return null;
  const saved = getSavedScrollPosition(getScrollToken());
  return saved && saved.scrollTop > 40 ? saved : null;
}

/**
 * Decide whether the app-level growth-aware settle loop should be SKIPPED for a
 * given saved position — i.e. whether react-virtual's `scrollToIndex` is the
 * SOLE restore controller for this return.
 *
 * The clean signal is an INDEX anchor: `anchorIndex != null` is produced ONLY by
 * the virtualized feed's save-time capture (use-scroll-restore records it only
 * when `driveGlobalWindow` is set — see the `captureFeedIndexAnchor()` branch).
 * On that path VirtualFeed already drives the restore via `scrollToIndex`;
 * running the app's per-frame rAF re-pin loop concurrently makes TWO writers
 * fight over the same `<main>.scrollTop` — and because their targets differ by
 * `intraOffset`, the container ping-pongs every frame (the post-landing shake),
 * running to HARD_CAP_MS because `getTotalSize()` keeps changing as rows measure
 * so the growth-quiet release never fires.
 *
 * Plain containers (the Profile nested scroller, non-feed pages, the
 * non-virtualized fallback) never record an index anchor (`anchorIndex == null`)
 * and MUST keep the full growth-aware loop — their late-loading media has no
 * other controller re-pinning it. Pure + dependency-free so the branch decision
 * is unit-testable without a DOM or react-virtual.
 */
export function usesIndexRestore(
  saved: Pick<SavedScrollPosition, "anchorIndex"> | null | undefined,
  driveGlobalWindow: boolean,
): boolean {
  return driveGlobalWindow && saved != null && saved.anchorIndex != null;
}

// ---------------------------------------------------------------------------
// Index-restore release decision (the decode-hold fix).
//
// PR #240 released the INDEX restore window after a HARD 2 rAFs. That lifts
// `data-restoring` — which flips `.feed-post-item` from
// `content-visibility:visible` back to the `content-visibility:auto` 220px
// placeholder — BEFORE late-decoding images / embed cards / quoted notes have
// settled. On the native swipe-back iOS's back-forward snapshot masks the
// resulting reflow; the in-app back button reveals the live DOM, so content
// at/below the anchor visibly shifts. This holds the window open a little
// longer: until the anchor region SETTLES (the container's `scrollHeight` has
// been quiet for a couple of frames PAST scrollToIndex's two-frame assert), or
// a fixed time cap — whichever comes first. First user input still ends it
// immediately (handled by the caller). CRITICALLY this only extends the
// content-visibility-visible + saves-suspension window — it adds NO second
// scrollTop writer, so react-virtual's scrollToIndex + measureElement stays the
// sole controller and the PR #240 shake stays gone.
// ---------------------------------------------------------------------------

/** Frames to wait for scrollToIndex's two-frame assert before counting quiet frames. */
export const INDEX_RESTORE_MIN_ASSERT_FRAMES = 2;
/** Consecutive quiet (no scrollHeight change) frames past the assert that mean "settled". */
export const INDEX_RESTORE_QUIET_FRAMES = 2;
/** Absolute cap so a pathologically decode-churning anchor never babysits
 *  forever. Was 350ms when release keyed on height-quiet alone; now that it
 *  also requires the anchor pinned at its saved offset (the drift fix), slow
 *  devices need headroom for late row measures before the correction sticks. */
export const INDEX_RESTORE_HARD_CAP_MS = 1500;

export interface IndexRestoreReleaseParams {
  /** rAF frames elapsed since the restore window opened (1-based). */
  frame: number;
  /** Consecutive frames the container's `scrollHeight` has been unchanged, counted only past the assert. */
  quietFrames: number;
  /** ms elapsed since the restore window opened. */
  elapsedMs: number;
  /**
   * Whether the anchor row currently sits at its saved offset (within
   * tolerance). Height-quiet alone is NOT enough to release: rows above the
   * anchor re-measure/decode late, so the view can be "quiet" while the anchor
   * is still ~100px off — the back-lands-in-the-wrong-place drift. Only the
   * hard cap may release an unsettled anchor.
   */
  anchorSettled: boolean;
}

export interface IndexRestoreReleaseConfig {
  minAssertFrames?: number;
  quietFramesNeeded?: number;
  hardCapMs?: number;
}

/**
 * Pure release predicate for the single-controller (index) restore path. Given
 * the current frame count, how many consecutive frames the container height has
 * been quiet, and the elapsed time, decide whether the restore window may close
 * THIS frame. Release when the anchor region has settled (past the two-frame
 * assert AND quiet for the required number of frames) OR the hard cap is hit —
 * whichever comes first. Dependency-free so the release timing is unit-testable
 * without a DOM or react-virtual.
 */
export function shouldReleaseIndexRestore(
  { frame, quietFrames, elapsedMs, anchorSettled }: IndexRestoreReleaseParams,
  {
    minAssertFrames = INDEX_RESTORE_MIN_ASSERT_FRAMES,
    quietFramesNeeded = INDEX_RESTORE_QUIET_FRAMES,
    hardCapMs = INDEX_RESTORE_HARD_CAP_MS,
  }: IndexRestoreReleaseConfig = {},
): boolean {
  if (elapsedMs >= hardCapMs) return true;
  return frame >= minAssertFrames && quietFrames >= quietFramesNeeded && anchorSettled;
}

// ---------------------------------------------------------------------------
// DOM anchor helpers (surface-agnostic — used for any scroll container, feed or
// plain list, virtualized or not). Kept here (not in the React hook) so they
// have no React/wouter import chain and stay unit-testable.
// ---------------------------------------------------------------------------

/**
 * Capture the row nearest the viewport top plus its exact on-screen offset.
 * Restoring "anchor at the same offset" survives virtualizer height
 * re-estimates and async content growth, where a raw scrollTop alone would land
 * on the wrong rows.
 */
export function captureScrollAnchor(container: HTMLElement): { id: string; offset: number } | null {
  const posts = container.querySelectorAll<HTMLElement>("[data-event-id]");
  const containerTop = container.getBoundingClientRect().top;
  let best: { id: string; offset: number } | null = null;

  for (let i = 0; i < posts.length; i++) {
    const top = posts[i].getBoundingClientRect().top - containerTop;
    const id = posts[i].getAttribute("data-event-id");
    if (!id) continue;
    if (top <= 80) {
      best = { id, offset: top };
    } else {
      if (!best) best = { id, offset: top };
      break;
    }
  }
  return best;
}

/**
 * Move the container so the saved anchor row sits at its saved on-screen
 * offset. Returns true once the position is within a couple px.
 *
 * With no element anchor (plain non-feed pages) it does a clamped scrollTop
 * restore, settling once the content is tall enough to hold the offset. With an
 * anchor it fine-tunes to the row; when the row isn't mounted yet (virtualized
 * feed) it seeds the saved offset and — only after patient retries
 * (`allowVirtualJump`) — asks the virtualizer to jump by index.
 */
export function restoreToAnchor(container: HTMLElement, saved: SavedScrollPosition, allowVirtualJump = false): boolean {
  if (!saved.anchorId) {
    const maxTop = container.scrollHeight - container.clientHeight;
    container.scrollTop = Math.min(saved.scrollTop, Math.max(maxTop, 0));
    return maxTop >= saved.scrollTop - 2;
  }
  const target = container.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(saved.anchorId)}"]`);
  if (!target) {
    const maxTop = container.scrollHeight - container.clientHeight;
    const targetTop = Math.min(saved.scrollTop, Math.max(maxTop, 0));
    if (Math.abs(container.scrollTop - targetTop) > 2) {
      container.scrollTop = targetTop;
    } else if (allowVirtualJump) {
      tryVirtualScrollToEventId(saved.anchorId);
    }
    return false;
  }
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollNeeded = (targetRect.top - containerRect.top) - saved.anchorOffset;
  if (scrollRestoreDebugEnabled()) {
    console.debug(`[scroll-restore] pass anchor=${saved.anchorId?.slice(0, 8)} savedOffset=${Math.round(saved.anchorOffset)} currentOffset=${Math.round(targetRect.top - containerRect.top)} needed=${Math.round(scrollNeeded)} scrollTop=${Math.round(container.scrollTop)}`);
  }
  if (Math.abs(scrollNeeded) > 2) {
    container.scrollBy(0, scrollNeeded);
    return false; // verify on the next pass — nearby rows may still be measuring
  }
  return true;
}
