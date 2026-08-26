/**
 * Overlays participate in history — the modal-back contract, v2.
 *
 * V1 (one history entry per layer, popped on manual close) was killed by its
 * own adversarial review, with a browser probe as the executioner:
 * `history.back()` is a QUEUED traversal while `pushState` is SYNCHRONOUS.
 * Close-drawer-open-panel in one React commit therefore pushed the panel's
 * entry and THEN executed the drawer's queued back — popping the panel the
 * instant it opened (CommsTab's Add member / Settings / Delete room were
 * unusable). And close-then-navigate (the launcher's hot path) buried the
 * menu's entry under the route, leaving one phantom Back per hop.
 *
 * V2: ONE sentinel entry guards the whole stack.
 *  - first overlay to open pushes the guard (or REUSES a guard that is
 *    already the current entry); further overlays just join the LIFO stack;
 *  - Back pops the guard → close the top layer → if layers remain, re-push
 *    the guard synchronously (still inside the popstate turn);
 *  - manual close NEVER touches history — the race is gone by construction;
 *    a guard left dead is chained through automatically on the next Back
 *    (one press = one real navigation, the phantom is invisible);
 *  - a vetoed close (busy upload dialog refuses onOpenChange(false)) re-arms
 *    via openModalLayer, which revives the still-current guard without
 *    pushing a duplicate.
 *
 * THE HARNESS MODELS THE REAL ORDERING — the v1 suite could not represent
 * the race because its back() moved the cursor synchronously. Here back()
 * is a queued task (cursor moves when the task runs, then popstate fires),
 * pushState is synchronous, exactly as probed in Chrome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openModalLayer, closeModalLayer, ensureModalBackListener, _resetModalHistoryForTests, MODAL_GUARD_KEY } from "./modal-history";
import { installAppHistory } from "./app-history";

type PopHandler = (e: { state: unknown }) => void;
let popHandlers: PopHandler[];
let entries: unknown[];
let cursor: number;
let pendingTasks: Array<() => void>;

function firePop() {
  for (const h of [...popHandlers]) h({ state: entries[cursor] });
}

/** Run queued history traversals (the browser's task queue). */
async function runTasks() {
  while (pendingTasks.length > 0) {
    const t = pendingTasks.shift()!;
    t();
  }
  await new Promise<void>((r) => setTimeout(r, 0));
}

function makeWindow() {
  entries = [null];
  cursor = 0;
  popHandlers = [];
  pendingTasks = [];
  const history = {
    get state() { return entries[cursor]; },
    // SYNCHRONOUS, like the real thing.
    pushState(d: unknown) { entries.splice(cursor + 1); entries.push(d); cursor++; },
    replaceState(d: unknown) { entries[cursor] = d; },
    // QUEUED, like the real thing (Chrome probe): the traversal target is
    // resolved when the task RUNS, off the cursor as it stands then.
    back() { pendingTasks.push(() => { if (cursor > 0) { cursor--; firePop(); } }); },
    go(n: number) { pendingTasks.push(() => { cursor = Math.max(0, Math.min(entries.length - 1, cursor + n)); firePop(); }); },
    length: 50,
  };
  (globalThis as any).window = {
    history,
    location: { pathname: "/x" },
    addEventListener: (type: string, cb: PopHandler) => { if (type === "popstate") popHandlers.push(cb); },
    removeEventListener: (type: string, cb: PopHandler) => { popHandlers = popHandlers.filter((h) => h !== cb); },
  };
  installAppHistory(history as any);
  return history;
}

const isGuard = (s: unknown) => !!s && typeof s === "object" && (s as any)[MODAL_GUARD_KEY] === true;

beforeEach(() => { _resetModalHistoryForTests(); makeWindow(); });
afterEach(() => { delete (globalThis as any).window; vi.restoreAllMocks(); });

describe("modal-history v2 — the guard entry", () => {
  it("Back closes the overlay instead of navigating — the original launcher bug", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/feed"); // page entry
    const close = vi.fn();
    openModalLayer(() => close());
    expect(isGuard(h.state)).toBe(true);

    h.back(); await runTasks(); // user presses system back

    expect(close).toHaveBeenCalledTimes(1);
    expect(cursor).toBe(1); // still the page — nothing navigated
  });

  it("close-A-open-B in ONE tick survives — the queued-back race that killed v1", async () => {
    // CommsTab: Manage drawer closes and the Add-member panel opens in the
    // same commit. v1's drawer cleanup queued a back() that then popped the
    // panel's fresh entry. v2's manual close does not touch history, and the
    // panel REUSES the still-current guard.
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/comms");
    const closeDrawer = vi.fn();
    const drawerId = openModalLayer(() => closeDrawer());
    const guardCursor = cursor;

    // one commit: drawer's cleanup, then panel's registration
    closeModalLayer(drawerId);
    const closePanel = vi.fn();
    openModalLayer(() => closePanel());
    await runTasks(); // drain anything queued — there must be nothing hostile

    expect(cursor).toBe(guardCursor);      // guard reused, no growth, no pop
    expect(isGuard(h.state)).toBe(true);
    expect(closePanel).not.toHaveBeenCalled(); // the panel SURVIVED opening

    h.back(); await runTasks();            // user presses back
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(cursor).toBe(1);                // back on /comms
  });

  it("close-then-NAVIGATE leaves no visible phantom — one Back = one real hop (the launcher path)", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/feed");        // origin page (idx 1)
    const closeMenu = vi.fn();
    const id = openModalLayer(() => closeMenu()); // guard (idx 2)

    // one handler: menu closes, route pushes ON TOP of the (now dead) guard
    closeModalLayer(id);
    h.pushState(null, "", "/messages");    // wouter push (idx 3)
    await runTasks();

    h.back(); await runTasks();            // ONE user Back from /messages

    // The dead guard was chained through automatically: we are on /feed's
    // entry, not stranded on a same-URL phantom needing a second press.
    expect(cursor).toBe(1);
    expect(closeMenu).not.toHaveBeenCalled();
  });

  it("stacks LIFO on ONE guard — Back peels one layer at a time, then navigates", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/page");
    const closeA = vi.fn();
    const closeB = vi.fn();
    openModalLayer(() => closeA());
    openModalLayer(() => closeB());
    expect(cursor).toBe(2); // ONE guard entry for both layers

    h.back(); await runTasks();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
    expect(isGuard(h.state)).toBe(true); // guard re-pushed for the next layer

    h.back(); await runTasks();
    expect(closeA).toHaveBeenCalledTimes(1);

    h.back(); await runTasks();
    expect(cursor).toBe(0); // real navigation
  });

  it("a vetoed close keeps the guard armed — Back never navigates under a busy dialog", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/upload");
    let vetoes = 1;
    let layerId: number;
    const arm = () => {
      layerId = openModalLayer(() => {
        if (vetoes > 0) {
          vetoes--;
          arm(); // the dialog refused to close (mid-upload) → re-arm, as use-back-closable does
        }
      });
    };
    arm();
    const guardCursor = cursor;

    h.back(); await runTasks(); // Back during upload → veto → re-armed
    expect(isGuard(h.state)).toBe(true);
    expect(cursor).toBe(guardCursor); // guard re-established, page protected

    h.back(); await runTasks(); // upload done (vetoes exhausted) → closes
    expect(cursor).toBe(1);
  });

  it("a multi-entry back jump closes every layer and does not re-push", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/a"); // idx 1
    h.pushState(null, "", "/b"); // idx 2
    const closeA = vi.fn();
    const closeB = vi.fn();
    openModalLayer(() => closeA());
    openModalLayer(() => closeB()); // guard idx 3

    h.go(-2); await runTasks(); // long-press back → jump to idx 1

    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(cursor).toBe(1);
    expect(isGuard(h.state)).toBe(false);
  });

  it("FORWARD into a dead guard closes nothing and does not chain", async () => {
    const h = (globalThis as any).window.history;
    h.pushState(null, "", "/page");
    const close = vi.fn();
    openModalLayer(() => close());
    h.back(); await runTasks(); // closed by Back; forward slot holds the dead guard
    close.mockClear();

    h.go(1); await runTasks(); // user presses FORWARD

    expect(close).not.toHaveBeenCalled();
    expect(isGuard(h.state)).toBe(true); // sitting on the dead guard, harmless
    const before = cursor;
    await runTasks();
    expect(cursor).toBe(before); // no auto-chain on forward
  });

  it("consumes a reload-restored guard at boot, so the first Back is not a phantom", async () => {
    // PWA resume restores the entry (state survives) but React boots with the
    // overlay closed — the guard is the landing entry. ensureModalBackListener
    // must consume it now (a real entry is beneath), or the user's first Back
    // moves guard→page (same URL) and looks dead.
    _resetModalHistoryForTests();
    entries = [null, { note: "page", roHistIdx: 1 }, { [MODAL_GUARD_KEY]: true, roHistIdx: 2 }];
    cursor = 2;
    installAppHistory((globalThis as any).window.history);
    ensureModalBackListener(); // main.tsx arms this at boot
    await runTasks();          // the boot-consume back() is queued like any traversal

    expect(cursor).toBe(1);    // sitting on the real page, guard consumed
    expect(isGuard((globalThis as any).window.history.state)).toBe(false);

    // And a genuine Back now performs a real navigation, not a phantom press.
    (globalThis as any).window.history.back(); await runTasks();
    expect(cursor).toBe(0);
  });

  it("does NOT consume a boot guard when nothing is beneath it (would pop into the void)", async () => {
    _resetModalHistoryForTests();
    entries = [{ [MODAL_GUARD_KEY]: true, roHistIdx: 0 }];
    cursor = 0;
    installAppHistory((globalThis as any).window.history);
    ensureModalBackListener();
    await runTasks();
    expect(cursor).toBe(0); // left alone — root is a no-op for Back anyway
  });
});
