/**
 * Overlays participate in history — the modal-back contract, v2.
 *
 * WHY A SENTINEL, NOT AN ENTRY PER LAYER. v1 pushed one entry per overlay and
 * popped it on manual close. Its own adversarial review executed it with a
 * browser probe: `history.back()` is a QUEUED traversal, `pushState` is
 * SYNCHRONOUS. So close-drawer-open-panel in one React commit pushed the
 * panel's entry and THEN ran the drawer's queued back — popping the panel the
 * instant it opened (CommsTab's Add member / Settings / Delete-room flows
 * were unusable in real browsers, while the v1 test harness — whose fake
 * back() moved the cursor synchronously — structurally could not represent
 * the reorder). And close-then-navigate (the launcher, the app's PRIMARY
 * mobile navigation) buried the menu's entry under the route, accreting one
 * ghost Back press per hop.
 *
 * V2 RULES:
 *  - The FIRST overlay pushes ONE guard entry ({roModalGuard:true}, same URL,
 *    carrying the page's _scrollToken so scroll-restore treats leaving it as
 *    an identity restore). Further overlays join the LIFO stack; a guard that
 *    is already the current entry is REUSED, never duplicated.
 *  - Back pops the guard → the TOP layer closes → if layers remain the guard
 *    is re-pushed synchronously inside the same popstate turn.
 *  - MANUAL close never touches history. That deletes the queued-back race
 *    by construction. A guard left dead (manual close, or close+navigate
 *    burying it under a route) is CHAINED THROUGH on the next backward
 *    popstate — one automatic extra history.back(), so the user's single
 *    press still performs one real navigation; the phantom is invisible.
 *  - A VETOED close (a busy upload dialog refusing onOpenChange(false))
 *    re-arms through openModalLayer, which revives the still-current guard —
 *    Back keeps closing-or-refusing instead of navigating under the modal.
 *  - Module state lives on globalThis so a Vite HMR re-evaluation cannot
 *    strand open layers with a dead popstate listener.
 */
import { appHistoryIndex, wentBackward } from "./app-history";
import { cancelPendingRestore } from "./scroll-restore";

export const MODAL_GUARD_KEY = "roModalGuard";

interface Layer {
  id: number;
  close: () => void;
}

interface ModalState {
  stack: Layer[];
  nextId: number;
  /** In-app index of the live guard entry, when one exists. */
  guardIdx: number | null;
  listenerInstalled: boolean;
}

/** HMR-safe holder: survives module re-evaluation. */
const HOLDER = Symbol.for("relay-outpost.modal-history");
function ms(): ModalState {
  const g = globalThis as Record<PropertyKey, unknown>;
  if (!g[HOLDER]) {
    g[HOLDER] = { stack: [], nextId: 1, guardIdx: null, listenerInstalled: false } satisfies ModalState;
  }
  return g[HOLDER] as ModalState;
}

function currentStateIsGuard(): boolean {
  const st = typeof window !== "undefined" ? (window.history.state as Record<string, unknown> | null) : null;
  return !!st && st[MODAL_GUARD_KEY] === true;
}

function pushGuard(): void {
  // Carry the page's _scrollToken onto the guard so scroll-restore, when we
  // later leave the guard backwards, restores the position the page already
  // has — an identity restore instead of a jump.
  const prior = window.history.state as Record<string, unknown> | null;
  const token = prior && typeof prior === "object" ? prior._scrollToken : undefined;
  window.history.pushState(
    token !== undefined ? { [MODAL_GUARD_KEY]: true, _scrollToken: token } : { [MODAL_GUARD_KEY]: true },
    "",
  );
  ms().guardIdx = appHistoryIndex();
}

function chainThrough(): void {
  // One automatic extra pop, only while the entry beneath is provably ours —
  // at the app's boot entry we stop rather than pop into the PWA void.
  if (appHistoryIndex() > 0) {
    try { window.history.back(); } catch { /* sandboxed */ }
  }
}

function onPopstate(): void {
  const s = ms();
  const newIdx = appHistoryIndex();
  // Direction from app-history (the pushState choke point) — a locally-kept
  // lastIdx went stale on wouter route pushes, which is what stranded the
  // launcher's dead guard.
  if (!wentBackward()) return; // FORWARD (or replace churn): never close/chain

  const handlingGuard = (s.guardIdx !== null && newIdx < s.guardIdx) || currentStateIsGuard();
  // A guard transition is not a page navigation: the page under the overlay
  // never scrolled, so undo any scroll-restore arm this popstate raised before
  // it freezes the page's scroll saves (scroll-restore's listener ran first).
  if (handlingGuard) cancelPendingRestore();

  if (s.guardIdx !== null && newIdx < s.guardIdx) {
    const jumpedPast = newIdx < s.guardIdx - 1; // long-press multi-entry jump
    s.guardIdx = null;
    if (s.stack.length > 0) {
      if (jumpedPast) {
        // The user leapt beyond the modal context: close everything, follow.
        while (s.stack.length > 0) {
          const layer = s.stack.pop()!;
          try { layer.close(); } catch { /* a broken closer must not stall the stack */ }
        }
      } else {
        const top = s.stack.pop()!;
        try { top.close(); } catch { /* ditto */ }
        // close() may have synchronously re-armed (a busy dialog vetoing the
        // close, or a handler opening another overlay), which already pushed a
        // guard. Only re-arm if it didn't and layers remain — otherwise we'd
        // push a SECOND guard and Back would need two presses to escape.
        if (s.stack.length > 0 && !currentStateIsGuard()) {
          pushGuard();
        }
      }
      return;
    }
    // Guard was dead (its layers all closed manually earlier).
    chainThrough();
    return;
  }

  // Landed ON a dead guard while going back — the close-then-navigate shape
  // left it mid-stack under a route entry. Clear our record of it FIRST, then
  // chain through: the extra history.back() lands on the real page, and
  // without clearing, that page (also below the old guardIdx) would trip this
  // logic again and pop one entry too many.
  if (currentStateIsGuard() && s.stack.length === 0) {
    s.guardIdx = null;
    chainThrough();
  }
}

/**
 * Arm the popstate listener at boot (main.tsx) — chain-through must work even
 * when no overlay has opened this session (a reload-restored dead guard).
 */
export function ensureModalBackListener(): void {
  const s = ms();
  if (s.listenerInstalled || typeof window === "undefined") return;
  s.listenerInstalled = true;
  window.addEventListener("popstate", onPopstate);
  // A reload/relaunch while an overlay was open restores the GUARD as the
  // landing entry (state survives), but React boots with the overlay closed.
  // Left alone, the first Back moves guard→page (same URL) and looks dead — a
  // phantom press. Consume it now, while there is a real entry beneath.
  // guardIdx is null here (fresh module), so onPopstate treats the resulting
  // pop as an ordinary same-URL navigation and does not over-pop.
  if (currentStateIsGuard() && appHistoryIndex() > 0) {
    try { window.history.back(); } catch { /* sandboxed */ }
  }
}

/** The overlay just opened: join the stack, ensure a live guard entry. */
export function openModalLayer(close: () => void): number {
  if (typeof window === "undefined") return -1;
  ensureModalBackListener();
  const s = ms();
  const id = s.nextId++;
  if (currentStateIsGuard()) {
    // Reuse — covers the second layer, the same-tick close-A-open-B handoff
    // (the race that killed v1), and a veto re-arming after Back consumed
    // the pop but the dialog refused to close.
    s.guardIdx = appHistoryIndex();
  } else {
    try { pushGuard(); } catch { return -1; }
  }
  s.stack.push({ id, close });
  return id;
}

/**
 * The overlay closed by its own means (X, tap-outside, drag, Escape, or a
 * navigation unmounting it). Deregisters ONLY — history is never touched
 * here, which is precisely what makes same-tick handoffs safe. A guard left
 * behind dead is chained through on the next Back.
 */
export function closeModalLayer(id: number): void {
  const s = ms();
  const i = s.stack.findIndex((l) => l.id === id);
  if (i !== -1) s.stack.splice(i, 1);
  if (s.stack.length === 0 && !currentStateIsGuard()) s.guardIdx = null;
}

/** Test seam: fresh state for a new fake window. */
export function _resetModalHistoryForTests(): void {
  delete (globalThis as Record<PropertyKey, unknown>)[HOLDER];
}
