import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  saveScrollPosition,
  getSavedScrollPosition,
  hasPendingScrollRestore,
  isRestorePending,
  isRestoreActive,
  beginRestoreWindow,
  endRestoreWindow,
  armRestorePendingFromHistory,
  getPendingRestoreOffset,
  isSavesSuspended,
  captureScrollAnchor,
  restoreToAnchor,
  usesIndexRestore,
  shouldReleaseIndexRestore,
  INDEX_RESTORE_MIN_ASSERT_FRAMES,
  INDEX_RESTORE_QUIET_FRAMES,
  INDEX_RESTORE_HARD_CAP_MS,
  serializePositions,
  deserializePositions,
  MAX_PERSISTED_POSITIONS,
  type SavedScrollPosition,
} from "./scroll-restore";

// The module resolves the current entry through history.state._scrollToken;
// stub a minimal history for the node test environment.
function stubToken(token: string | null) {
  (globalThis as any).history = { state: token ? { _scrollToken: token } : {} };
}

let tokenCounter = 0;
function freshToken(): string {
  const t = `test-token-${++tokenCounter}`;
  stubToken(t);
  return t;
}

beforeEach(() => {
  endRestoreWindow();
  stubToken(null);
  armRestorePendingFromHistory(); // clears pending (no saved position)
});

afterEach(() => {
  delete (globalThis as any).history;
});

describe("saveScrollPosition / getSavedScrollPosition", () => {
  it("round-trips a saved position by token", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 1234, anchorId: "abc", anchorOffset: -20 });
    const saved = getSavedScrollPosition(token);
    expect(saved).toMatchObject({ scrollTop: 1234, anchorId: "abc", anchorOffset: -20 });
    expect(saved!.savedAt).toBeGreaterThan(0);
  });

  it("returns undefined for a null or unknown token", () => {
    expect(getSavedScrollPosition(null)).toBeUndefined();
    expect(getSavedScrollPosition("nope")).toBeUndefined();
  });
});

describe("hasPendingScrollRestore", () => {
  it("false without a saved position for the current entry", () => {
    freshToken();
    expect(hasPendingScrollRestore()).toBe(false);
  });

  it("false when the saved position is near the top (<= 40px)", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 40, anchorId: null, anchorOffset: 0 });
    expect(hasPendingScrollRestore()).toBe(false);
  });

  it("true for a meaningful saved position", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 41, anchorId: null, anchorOffset: 0 });
    expect(hasPendingScrollRestore()).toBe(true);
  });
});

describe("restore window state machine", () => {
  it("popstate arming requires a saved position for the current entry", () => {
    freshToken();
    armRestorePendingFromHistory();
    expect(isRestorePending()).toBe(false);

    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 500, anchorId: "a1", anchorOffset: 10 });
    armRestorePendingFromHistory();
    expect(isRestorePending()).toBe(true);
    expect(isRestoreActive()).toBe(false);
  });

  it("beginRestoreWindow consumes pending and turns active", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 500, anchorId: "a1", anchorOffset: 10 });
    armRestorePendingFromHistory();

    beginRestoreWindow();
    expect(isRestorePending()).toBe(false);
    expect(isRestoreActive()).toBe(true);

    endRestoreWindow();
    expect(isRestoreActive()).toBe(false);
  });

  it("endRestoreWindow does NOT clear a pending flag (old-effect cleanup runs before the new feed mounts)", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 500, anchorId: "a1", anchorOffset: 10 });
    armRestorePendingFromHistory();

    endRestoreWindow(); // cleanup of the PREVIOUS location's restore
    expect(isRestorePending()).toBe(true); // the imminent mount still sees it
  });
});

// ---------------------------------------------------------------------------
// The save-race (Defect B) — the exact sequence two prior headless-harness
// passes missed. On a real device an in-app history.back() (unlike the native
// swipe, which iOS commits only at transition end) leaves the OUTGOING detail
// page mounted for a beat after popstate has already swapped history.state to
// the RETURNING feed token. Any scroll event it emits in that gap (height clamp,
// tap inertia, the trailing ~180ms save timer) would write the detail page's
// scrollTop (~0) UNDER the feed token — clobbering the position restore is about
// to read, landing the user at the top.
//
// The fix suspends saves for the WHOLE restore window (isSavesSuspended, armed
// synchronously by the popstate handler via armRestorePendingFromHistory). This
// models the hook's onScroll/trailing guard with the real accessor: revert
// isSavesSuspended to `return false` (the pre-fix behavior — the hook used to
// consult only its local isRestoringRef, which is false in this gap) and the
// "NOT overwritten" assertion fails.
// ---------------------------------------------------------------------------
describe("save-race: a scroll in the popstate→restore gap must not clobber the returning entry", () => {
  // Faithful stand-in for use-scroll-restore.ts's save path: a scroll event only
  // writes when saves aren't suspended.
  function detailScrollSave(key: string, scrollTop: number) {
    if (isSavesSuspended()) return;
    saveScrollPosition(key, { scrollTop, anchorId: null, anchorOffset: 0 });
  }

  it("suppresses the outgoing page's scroll-save and restore reads the ORIGINAL position", () => {
    // 1. The feed rested at 900px under token A.
    const tokenA = freshToken();
    saveScrollPosition(tokenA, { scrollTop: 900, anchorId: "post-a1", anchorOffset: -12 });

    // Sanity: an UNGUARDED save at scrollTop 0 WOULD clobber — this is the bug.
    // (Prove the mechanism is real before showing the guard defeats it.)
    saveScrollPosition(tokenA, { scrollTop: 0, anchorId: null, anchorOffset: 0 });
    expect(getSavedScrollPosition(tokenA)!.scrollTop).toBe(0);
    // Restore the real resting position for the guarded run below.
    saveScrollPosition(tokenA, { scrollTop: 900, anchorId: "post-a1", anchorOffset: -12 });

    // 2. history.back() → popstate. history.state is already token A; the real
    //    popstate handler arms suspension synchronously.
    stubToken(tokenA);
    armRestorePendingFromHistory();
    expect(isSavesSuspended()).toBe(true);

    // 3. In the gap, the still-mounted detail page fires a scroll (scrollTop ~0).
    detailScrollSave(tokenA, 0);

    // 4. Token A's saved position was NOT overwritten.
    expect(getSavedScrollPosition(tokenA)!.scrollTop).toBe(900);

    // 5. The imminent restore reads the ORIGINAL position.
    expect(getPendingRestoreOffset()).toBe(900);
  });

  it("keeps saves suspended through the active restore settle, releasing only at endRestoreWindow", () => {
    const tokenA = freshToken();
    saveScrollPosition(tokenA, { scrollTop: 620, anchorId: "post-b2", anchorOffset: 4 });

    stubToken(tokenA);
    armRestorePendingFromHistory();

    // Pending → Active handoff (restorer takes over): still suspended, so a late
    // scroll event during the growth-aware settle can't clobber either.
    beginRestoreWindow();
    expect(isSavesSuspended()).toBe(true);
    detailScrollSave(tokenA, 0);
    expect(getSavedScrollPosition(tokenA)!.scrollTop).toBe(620);

    // Settle committed → suspension released → normal saving resumes.
    endRestoreWindow();
    expect(isSavesSuspended()).toBe(false);
    detailScrollSave(tokenA, 130);
    expect(getSavedScrollPosition(tokenA)!.scrollTop).toBe(130);
  });
});

describe("getPendingRestoreOffset", () => {
  it("null when no restore is pending or active", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 900, anchorId: "a1", anchorOffset: 0 });
    // saved position exists, but no popstate happened — e.g. a pushState
    // navigation to a feed page must not seed the virtualizer.
    expect(getPendingRestoreOffset()).toBeNull();
  });

  it("returns the saved scrollTop while pending", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 900, anchorId: "a1", anchorOffset: 0 });
    armRestorePendingFromHistory();
    expect(getPendingRestoreOffset()).toBe(900);
  });

  it("still resolves while the restore is active (feed remounts mid-restore)", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 900, anchorId: "a1", anchorOffset: 0 });
    armRestorePendingFromHistory();
    beginRestoreWindow();
    expect(getPendingRestoreOffset()).toBe(900);
  });

  it("null when the current entry has no meaningful saved position, even if a stale pending flag survived", () => {
    const token = freshToken();
    saveScrollPosition(token, { scrollTop: 900, anchorId: "a1", anchorOffset: 0 });
    armRestorePendingFromHistory();
    // Forward navigation mints a fresh token before the next feed mounts.
    freshToken();
    expect(getPendingRestoreOffset()).toBeNull();
  });
});

// Minimal element stand-ins for the node test env (no DOM). Only the surface
// restoreToAnchor / captureScrollAnchor actually touch is modelled.
function mockContainer(opts: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  return {
    scrollHeight: opts.scrollHeight,
    clientHeight: opts.clientHeight,
    scrollTop: opts.scrollTop ?? 0,
    scrollBy(_x: number, y: number) { this.scrollTop += y; },
  } as unknown as HTMLElement & { scrollTop: number };
}

// ---------------------------------------------------------------------------
// The single-controller branch decision (the shake fix). The app-level
// growth-aware settle loop MUST be skipped when react-virtual's scrollToIndex
// owns the restore — the clean signal is an INDEX anchor produced only by the
// virtualized feed's capture. This is the pure predicate the hook branches on;
// the no-shake CONVERGENCE it enables is device-gated (jsdom can't run
// react-virtual), but which controller runs is decided here and unit-tested.
// ---------------------------------------------------------------------------
describe("usesIndexRestore — skip the app rAF loop on the virtualized feed path", () => {
  const withIndex = (anchorIndex: number | null): SavedScrollPosition => ({
    scrollTop: 900, anchorId: "post-a1", anchorOffset: -12, anchorIndex, intraOffset: 12, savedAt: 0,
  });

  it("TRUE when driving the global window and the saved position has an index anchor (feed → skip app loop)", () => {
    expect(usesIndexRestore(withIndex(4), true)).toBe(true);
  });

  it("FALSE when anchorIndex is null (plain container → run the full growth-aware loop)", () => {
    expect(usesIndexRestore(withIndex(null), true)).toBe(false);
  });

  it("FALSE when anchorIndex is absent entirely (legacy / non-feed save → run the loop)", () => {
    const legacy: SavedScrollPosition = { scrollTop: 900, anchorId: "a1", anchorOffset: 0, savedAt: 0 };
    expect(usesIndexRestore(legacy, true)).toBe(false);
  });

  it("FALSE for a nested container even with an index anchor (only the main container drives the global window)", () => {
    // driveGlobalWindow=false is the Profile/nested scroller — it must never
    // skip its own restore loop, even if a stale index anchor were present.
    expect(usesIndexRestore(withIndex(4), false)).toBe(false);
  });

  it("FALSE for a null/undefined saved position (fresh forward navigation)", () => {
    expect(usesIndexRestore(null, true)).toBe(false);
    expect(usesIndexRestore(undefined, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The index-restore DECODE-HOLD release decision (the button-path content-shift
// fix). PR #240 released the single-controller window after a HARD 2 rAFs,
// lifting `data-restoring` (content-visibility:visible) before late-decoding
// media had settled — so content at/below the anchor shifted visibly on the
// in-app back button (the native swipe hides it behind iOS's bf-snapshot). The
// window now holds until the anchor region SETTLES — `scrollHeight` quiet for a
// couple frames PAST scrollToIndex's two-frame assert — or a ~350ms cap,
// whichever comes first. First user input still ends it (caller-side, not here).
// This is the pure per-frame predicate the hook loop consults; the no-shift
// CONVERGENCE it enables is device-gated (jsdom can't decode images), but the
// release TIMING is decided here and unit-tested.
// ---------------------------------------------------------------------------
describe("shouldReleaseIndexRestore — hold the window through media decode", () => {
  // Drive the pure predicate over a scrollHeight sequence exactly like the hook
  // loop does: count quiet frames only PAST the two-frame assert, release on the
  // first frame the predicate returns true. Returns the 1-based release frame.
  function releaseFrameFor(
    heights: number[],
    cfg?: Parameters<typeof shouldReleaseIndexRestore>[1],
    msPerFrame = 16,
  ): number {
    const minAssert = cfg?.minAssertFrames ?? INDEX_RESTORE_MIN_ASSERT_FRAMES;
    let quietFrames = 0;
    let lastHeight = heights[0];
    for (let i = 0; i < heights.length; i++) {
      const frame = i + 1; // 1-based, first rAF is frame 1
      const h = heights[i];
      if (frame >= minAssert) quietFrames = h === lastHeight ? quietFrames + 1 : 0;
      lastHeight = h;
      // anchorSettled: true — this suite exercises the HEIGHT dimension; the
      // anchor dimension has its own describe block below.
      if (shouldReleaseIndexRestore({ frame, quietFrames, elapsedMs: frame * msPerFrame, anchorSettled: true }, cfg)) {
        return frame;
      }
    }
    return -1; // never released within the sequence
  }

  it("releases on the earliest frame with 2 quiet frames past the assert when height is stable from the start", () => {
    // Height never changes → quietFrames reaches 2 at frame 3 (frames 2 & 3
    // quiet, both past the assert). NOT at the old hard frame 2.
    const stable = new Array(10).fill(1000);
    expect(releaseFrameFor(stable)).toBe(3);
    expect(releaseFrameFor(stable)).toBeGreaterThan(INDEX_RESTORE_MIN_ASSERT_FRAMES);
  });

  it("does NOT release while scrollHeight keeps growing (late media decode resets the quiet run)", () => {
    // Height grows every frame through frame 12, then goes quiet. It must hold
    // past the old 2-rAF release and only let go once decode stops.
    const growing = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1750, 1750, 1750, 1750];
    const rf = releaseFrameFor(growing);
    // The 2 quiet frames only appear at the end (frames 10 & 11 stable → release
    // at frame 11), well after the hard-2 point.
    expect(rf).toBe(11);
    expect(rf).toBeGreaterThan(2);
  });

  it("a height bump that interrupts the quiet run defers release", () => {
    // One quiet frame (frame 2), then a bump at frame 3 resets the run before it
    // reaches 2; quiet again → release two quiet frames later (frame 5). Without
    // the bump this same start would have released at frame 3.
    const heights = [1000, 1000, 1100, 1100, 1100, 1100];
    expect(releaseFrameFor(heights)).toBe(5);
    expect(releaseFrameFor([1000, 1000, 1000, 1000])).toBe(3); // no bump → frame 3
  });

  it("falls back to the hard time cap when the height never goes quiet (pathological churn)", () => {
    // Height changes every single frame → quietFrames never reaches 2. Release
    // is forced by the ~350ms cap, not by settling.
    const churn = Array.from({ length: 120 }, (_, i) => 1000 + i);
    const rf = releaseFrameFor(churn, undefined, 16);
    const capFrame = Math.ceil(INDEX_RESTORE_HARD_CAP_MS / 16);
    expect(rf).toBe(capFrame);
    // Sanity: the cap actually fires within the churn window.
    expect(rf).toBeLessThan(churn.length);
  });

  it("the time cap wins even when settling would come later", () => {
    // elapsedMs already past the cap on frame 1 → release immediately regardless
    // of quiet frames (models a very slow first frame).
    expect(shouldReleaseIndexRestore({ frame: 1, quietFrames: 0, elapsedMs: INDEX_RESTORE_HARD_CAP_MS + 50, anchorSettled: false })).toBe(true);
  });

  it("never releases before the two-frame assert, even if the first frame looks quiet", () => {
    // frame 1, quietFrames 2 (impossible in the loop, but proves the gate):
    // still below minAssertFrames → hold.
    expect(shouldReleaseIndexRestore({ frame: 1, quietFrames: 2, elapsedMs: 16, anchorSettled: true })).toBe(false);
  });

  it("respects the required quiet-frame count", () => {
    // Exactly QUIET_FRAMES-1 quiet frames past the assert → not yet.
    expect(
      shouldReleaseIndexRestore({ frame: 5, quietFrames: INDEX_RESTORE_QUIET_FRAMES - 1, elapsedMs: 80, anchorSettled: true }),
    ).toBe(false);
    expect(
      shouldReleaseIndexRestore({ frame: 5, quietFrames: INDEX_RESTORE_QUIET_FRAMES, elapsedMs: 80, anchorSettled: true }),
    ).toBe(true);
  });

  it("honors a custom config (tighter cap / different frame budgets)", () => {
    // A 100ms cap at 16ms/frame forces release by frame 7 under relentless churn.
    const churn = Array.from({ length: 30 }, (_, i) => 1000 + i);
    expect(releaseFrameFor(churn, { hardCapMs: 100 })).toBe(Math.ceil(100 / 16));
  });
});

describe("restoreToAnchor — plain (non-virtualized / no anchor) path", () => {
  const noAnchor = (scrollTop: number): SavedScrollPosition => ({ scrollTop, anchorId: null, anchorOffset: 0, savedAt: 0 });

  it("restores the exact scrollTop when content is tall enough and reports settled", () => {
    const el = mockContainer({ scrollHeight: 2000, clientHeight: 800 });
    const settled = restoreToAnchor(el, noAnchor(500));
    expect(el.scrollTop).toBe(500);
    expect(settled).toBe(true);
  });

  it("clamps to the content cap and reports NOT settled when content is still too short", () => {
    // Content shorter than the saved offset (e.g. a slow list still loading) —
    // clamp to the max, keep the caller's retry loop alive.
    const el = mockContainer({ scrollHeight: 300, clientHeight: 800 });
    const settled = restoreToAnchor(el, noAnchor(500));
    expect(el.scrollTop).toBe(0); // maxTop is negative → clamped to 0
    expect(settled).toBe(false);
  });

  it("settles once the list grows tall enough on a later pass", () => {
    let el = mockContainer({ scrollHeight: 600, clientHeight: 800 });
    expect(restoreToAnchor(el, noAnchor(400))).toBe(false); // maxTop -200 → 0
    // Content finished loading — now tall enough to hold the offset.
    el = mockContainer({ scrollHeight: 2000, clientHeight: 800 });
    expect(restoreToAnchor(el, noAnchor(400))).toBe(true);
    expect(el.scrollTop).toBe(400);
  });
});

describe("captureScrollAnchor — nearest-to-top row selection", () => {
  function mockPost(top: number, id: string | null) {
    return { getBoundingClientRect: () => ({ top }), getAttribute: () => id } as unknown as HTMLElement;
  }
  function mockAnchorContainer(containerTop: number, posts: HTMLElement[]) {
    return {
      getBoundingClientRect: () => ({ top: containerTop }),
      querySelectorAll: () => posts as unknown as NodeListOf<HTMLElement>,
    } as unknown as HTMLElement;
  }

  it("picks the last row at/above the 80px band and records its offset", () => {
    // containerTop 100 → relative tops: -10, 50, 150. Band is <=80, so the row
    // at rel 50 ("b") is the anchor; the rel 150 row ("c") is past the band.
    const el = mockAnchorContainer(100, [mockPost(90, "a"), mockPost(150, "b"), mockPost(250, "c")]);
    expect(captureScrollAnchor(el)).toEqual({ id: "b", offset: 50 });
  });

  it("falls back to the first row when every row is below the band (list scrolled to top)", () => {
    const el = mockAnchorContainer(0, [mockPost(120, "x"), mockPost(400, "y")]);
    expect(captureScrollAnchor(el)).toEqual({ id: "x", offset: 120 });
  });

  it("returns null when there are no anchored rows", () => {
    const el = mockAnchorContainer(0, []);
    expect(captureScrollAnchor(el)).toBeNull();
  });
});

// Regression: back-navigation on the virtualized feed landed ~93px off (worse
// on device) — the index-path release fired on "height quiet" alone, letting go
// while the anchor row still sat away from its saved offset (rows above it
// re-measure/decode late). Release must ALSO require the anchor to be settled;
// only the hard cap overrides that.
describe("shouldReleaseIndexRestore — anchor must be settled", () => {
  it("does NOT release on quiet frames alone while the anchor is off its saved offset", () => {
    expect(
      shouldReleaseIndexRestore({ frame: 10, quietFrames: 5, elapsedMs: 200, anchorSettled: false }),
    ).toBe(false);
  });

  it("releases once quiet AND the anchor is settled", () => {
    expect(
      shouldReleaseIndexRestore({ frame: 10, quietFrames: 5, elapsedMs: 200, anchorSettled: true }),
    ).toBe(true);
  });

  it("hard cap force-releases even with the anchor unsettled", () => {
    expect(
      shouldReleaseIndexRestore({ frame: 3, quietFrames: 0, elapsedMs: 99999, anchorSettled: false }),
    ).toBe(true);
  });
});

describe("position persistence — surviving a discarded document", () => {
  const pos = (scrollTop: number, anchorId: string | null = "abc"): SavedScrollPosition =>
    ({ scrollTop, anchorId, anchorOffset: -12, anchorIndex: 7, intraOffset: 12, savedAt: 1 });

  it("round-trips a saved position", () => {
    // history.state._scrollToken already survives a reload, a PWA relaunch and
    // iOS discarding a backgrounded tab. The positions did not, so back landed
    // at the top of the feed with a perfectly good token in hand.
    const map = new Map([["tok", pos(4200)]]);
    const back = deserializePositions(serializePositions(map));
    expect(back.get("tok")).toEqual(pos(4200));
  });

  it("keeps the MOST RECENT entries when over the cap", () => {
    const map = new Map<string, SavedScrollPosition>();
    for (let i = 0; i < MAX_PERSISTED_POSITIONS + 10; i++) map.set(`t${i}`, pos(i));
    const back = deserializePositions(serializePositions(map));
    expect(back.size).toBe(MAX_PERSISTED_POSITIONS);
    expect(back.has(`t${MAX_PERSISTED_POSITIONS + 9}`)).toBe(true);
    expect(back.has("t0")).toBe(false);
  });

  it("survives a corrupt payload rather than throwing", () => {
    // Storage is shared with whatever else the origin wrote, and versions change.
    for (const bad of ["", "null", "{}", "[[1,2]]", "not json", '[["k",null]]', '[["k",{}]]']) {
      expect(() => deserializePositions(bad)).not.toThrow();
      expect(deserializePositions(bad).size).toBe(0);
    }
    expect(deserializePositions(null).size).toBe(0);
  });

  it("drops entries with a nonsense scrollTop instead of restoring to NaN", () => {
    const raw = JSON.stringify([["k", { scrollTop: "high", anchorId: "a" }], ["j", { scrollTop: NaN }]]);
    expect(deserializePositions(raw).size).toBe(0);
  });

  it("tolerates a position saved without the feed's index anchor", () => {
    // Plain containers (Profile, non-feed pages) never record one.
    const raw = JSON.stringify([["k", { scrollTop: 300, anchorId: "a", anchorOffset: -4, savedAt: 2 }]]);
    const back = deserializePositions(raw).get("k")!;
    expect(back.scrollTop).toBe(300);
    expect(back.anchorIndex).toBeNull();
    expect(back.intraOffset).toBeUndefined();
  });

  it("keeps a null anchor null rather than inventing an id", () => {
    const back = deserializePositions(serializePositions(new Map([["k", pos(90, null)]])));
    expect(back.get("k")!.anchorId).toBeNull();
  });
});
