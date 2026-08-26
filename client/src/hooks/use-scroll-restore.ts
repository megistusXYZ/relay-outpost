import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  getScrollToken,
  ensureScrollToken,
  saveScrollPosition,
  getSavedScrollPosition,
  beginRestoreWindow,
  endRestoreWindow,
  captureScrollAnchor,
  restoreToAnchor,
  isSavesSuspended,
  usesIndexRestore,
  shouldReleaseIndexRestore,
  INDEX_RESTORE_MIN_ASSERT_FRAMES,
} from "@/lib/scroll-restore";
import { captureFeedIndexAnchor } from "@/lib/feed-scroll-bridge";

/**
 * Shared, surface-agnostic scroll restoration.
 *
 * Any list → detail → back route can wire its scroll container to the SAME
 * per-history-token store used by the home feed, so back/forward returns land
 * on the exact pixel the user left — steady-state (no fade, no skeleton swap,
 * no shake), whether or not the list is virtualized.
 *
 * The app's main `<main>` scroll container is driven by App.tsx's <ScrollToTop>
 * (which calls this with `driveGlobalWindow: true`, `keySuffix: ""`). Pages that
 * introduce their OWN nested scroll container (e.g. Profile's `overflow-y-auto`
 * wrapper) call this with a distinct `keySuffix` so their saved position is
 * namespaced separately from `<main>` under the same history entry — no
 * collision, no fighting over one key.
 *
 * ### Why this differs from a fixed settle window (the real-device fix)
 * The original home-only restorer corrected the anchor for a fixed ~0.8s and
 * then let go. On a fast headless run everything is measured within that window
 * so it looked perfect. On a real (throttled) network the tapped post's images,
 * quoted notes, embed cards and avatars decode AFTER the window closes, growing
 * content below the anchor and shoving the restored position away — exactly the
 * "back lands in the wrong place" users report. Here the settle is instead
 * GROWTH-AWARE: a rAF loop keeps re-pinning the anchor and only releases once
 * the container's `scrollHeight` has been quiet (no growth, anchor within 2px)
 * for a short window. Late-loading content resets the quiet timer, so the
 * position stays locked to the anchor until the view actually stops moving.
 * The user grabbing the page (wheel / touch / keydown) always wins and ends it.
 *
 * ### One controller per surface (the shake fix)
 * The growth-aware loop above is the restorer for PLAIN containers only (profile
 * nested scroller, non-feed pages, the non-virtualized fallback). On the
 * VIRTUALIZED feed the saved position carries an INDEX anchor (`anchorIndex !=
 * null`) and `VirtualFeed` already drives the restore with react-virtual's
 * `scrollToIndex`. Running BOTH against the same `<main>.scrollTop` made two
 * writers whose targets differ by `intraOffset` ping-pong every frame — the
 * post-landing shake — until HARD_CAP_MS, because `getTotalSize()` keeps changing
 * as rows measure so the growth-quiet release never fires. So on the index path
 * (`usesIndexRestore`) we SKIP the app loop entirely and let `scrollToIndex` own
 * it — holding the restore window (content-visibility:visible + saves suspended)
 * open until the anchor region settles (scrollHeight quiet past scrollToIndex's
 * two-frame assert, or a ~350ms cap) so decode-driven reflow happens UNDER the
 * override instead of after it, WITHOUT adding a second scrollTop writer.
 */

export interface UseScrollRestoreOptions {
  /**
   * Namespaces the saved position when multiple scroll containers can be active
   * under one history entry. "" = the app's main container (default). A nested
   * page container passes something stable like ":profile".
   */
  keySuffix?: string;
  /**
   * Only the main container drives the global restore-window flags that
   * VirtualFeed / Home read (pre-paint offset seeding, isAtTop freeze). Nested
   * containers leave them alone.
   */
  driveGlobalWindow?: boolean;
}

// Release only after the view has been settled (anchor within 2px) AND quiet
// (no scrollHeight growth) for this long. Late-loading media on a slow network
// keeps resetting it, so the anchor stays pinned until content stops moving.
const SETTLE_QUIET_MS = 500;
// Absolute safety cap — never babysit a pathologically-growing page forever.
const HARD_CAP_MS = 12000;
// Frames of the anchor row being absent before we let the virtualizer jump by
// index (~200ms at 60fps) — patient enough that a seeded virtual feed usually
// mounts the row on its own first.
const VIRTUAL_JUMP_AFTER_MISSES = 12;

export function useScrollRestore(
  containerRef: React.RefObject<HTMLElement | null>,
  { keySuffix = "", driveGlobalWindow = false }: UseScrollRestoreOptions = {},
) {
  const [location] = useLocation();
  const rafRef = useRef<number>(0);
  const isRestoringRef = useRef(false);

  const storeKey = (): string | null => {
    const token = getScrollToken();
    return token ? token + keySuffix : null;
  };

  // Ensure the current history entry has a token as early as possible. Only the
  // main container owns minting — nested containers reuse whatever it stamped.
  useEffect(() => {
    if (driveGlobalWindow) ensureScrollToken();
  }, [driveGlobalWindow]);

  // Continuously save the container's resting position (exact scrollTop + an
  // element anchor) under this entry's key while the user scrolls.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastSaveTime = 0;
    let trailingTimer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      const key = storeKey();
      if (!key) return;
      const anchor = captureScrollAnchor(el);
      // If a virtualized feed is mounted on this container, record an INDEX
      // anchor (which row is at the top + how far past its top) so a back-return
      // can restore by row index instead of by a flat-estimate pixel offset
      // (which resolves to the wrong row on device). Null on non-feed surfaces —
      // they keep the pixel path. When present the feed anchor is authoritative
      // and self-consistent: `anchorOffset = -intraOffset` so the DOM fine-tune
      // (restoreToAnchor) lands the SAME row at the SAME offset the index restore
      // targets.
      const feedAnchor = driveGlobalWindow ? captureFeedIndexAnchor() : null;
      if (feedAnchor) {
        saveScrollPosition(key, {
          scrollTop: el.scrollTop,
          anchorId: feedAnchor.anchorId,
          anchorOffset: -feedAnchor.intraOffset,
          anchorIndex: feedAnchor.anchorIndex,
          intraOffset: feedAnchor.intraOffset,
        });
      } else {
        saveScrollPosition(key, {
          scrollTop: el.scrollTop,
          anchorId: anchor?.id ?? null,
          anchorOffset: anchor?.offset ?? 0,
          anchorIndex: null,
          intraOffset: anchor ? -anchor.offset : 0,
        });
      }
    };
    const onScroll = () => {
      if (isRestoringRef.current) return;
      // Suspend saves for the whole back/forward restore window (armed
      // synchronously on popstate). Without this, a scroll event fired by the
      // still-mounted outgoing detail page in the gap between popstate and the
      // restorer committing would write scrollTop~0 under the RETURNING entry's
      // token, clobbering the position restore is about to read. This — not the
      // local isRestoringRef, which is only set inside the later restore
      // layout-effect — is what closes the "native good, in-app button bad" race.
      if (isSavesSuspended()) return;
      const now = Date.now();
      // Trailing save so the FINAL resting position is always captured even
      // when the last scroll event lands inside the throttle window.
      if (trailingTimer) clearTimeout(trailingTimer);
      trailingTimer = setTimeout(() => {
        trailingTimer = null;
        if (!isRestoringRef.current && !isSavesSuspended()) save();
      }, 180);
      if (now - lastSaveTime < 150) return;
      lastSaveTime = now;
      save();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (trailingTimer) clearTimeout(trailingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, keySuffix]);

  // On every location change (and on mount), restore this container to the
  // saved position for the returning history entry, or scroll it to the top for
  // a fresh forward navigation.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    cancelAnimationFrame(rafRef.current);
    isRestoringRef.current = false;

    if (driveGlobalWindow) ensureScrollToken();
    const saved = getSavedScrollPosition(storeKey());

    if (saved && saved.scrollTop > 0) {
      isRestoringRef.current = true;
      if (driveGlobalWindow) beginRestoreWindow();
      // Force real row heights during the restore window: `.feed-post-item`
      // ships `content-visibility:auto` (a 220px placeholder until painted),
      // which makes rows report the wrong height exactly while the restorer is
      // trying to land on an anchor — a source of the "sloppy load" churn. The
      // CSS rule keyed on this attr flips it to `visible` for the window only.
      el.setAttribute("data-restoring", "");

      let cancelled = false;
      const cleanup = () => {
        isRestoringRef.current = false;
        if (driveGlobalWindow) endRestoreWindow();
        el.removeAttribute("data-restoring");
        cancelAnimationFrame(rafRef.current);
        el.removeEventListener("wheel", onUserInput);
        el.removeEventListener("touchstart", onUserInput);
        window.removeEventListener("keydown", onUserInput);
      };
      // The user grabbing the page mid-restore wins — stop fighting them.
      const onUserInput = () => { cancelled = true; cleanup(); };
      el.addEventListener("wheel", onUserInput, { passive: true });
      el.addEventListener("touchstart", onUserInput, { passive: true });
      window.addEventListener("keydown", onUserInput);

      // SINGLE-CONTROLLER path (virtualized feed): the saved position carries an
      // index anchor, so VirtualFeed drives the restore via `scrollToIndex`. Do
      // NOT start the app-level growth-aware settle loop and do NOT call
      // restoreToAnchor/scrollBy — two writers on the same `<main>.scrollTop`
      // (their targets differ by intraOffset) is the post-landing shake that ran
      // to HARD_CAP_MS because `getTotalSize()` never went quiet while rows
      // measured. react-virtual's scrollToIndex + measureElement stays the SOLE
      // controller here; we add NO second scrollTop writer.
      if (usesIndexRestore(saved, driveGlobalWindow)) {
        // DECODE-HOLD (fixes the button-path content shift): PR #240 released
        // this window after a hard 2 rAFs, which lifted `data-restoring`
        // (content-visibility:visible → the 220px placeholder) BEFORE late
        // decoding images / embeds / quoted notes settled, so content at/below
        // the anchor shifted visibly. Instead, keep the window open (saves
        // suspended + content-visibility:visible) until the anchor region
        // SETTLES: `el.scrollHeight` quiet for a couple frames PAST
        // scrollToIndex's two-frame assert, or a ~350ms cap — whichever first.
        // This ONLY extends the override window; it does NOT re-enable the
        // per-frame re-pin loop, so the shake stays gone. First user input ends
        // it immediately (onUserInput above).
        const startAt = Date.now();
        let frames = 0;
        let quietFrames = 0;
        let lastHeight = el.scrollHeight;
        const releaseWhenSettled = () => {
          if (cancelled) return;
          frames++;
          const h = el.scrollHeight;
          // Only count "quiet" frames once we're past scrollToIndex's two-frame
          // assert — before that, height is expected to move as rows measure.
          // ANCHOR CORRECTION (fixes the ~93px-off landing): once the assert has
          // passed, scrollToIndex has stopped writing — restoreToAnchor becomes
          // the SOLE scrollTop writer (no second-writer shake) and re-pins the
          // anchor row to its saved offset each frame. Height-quiet alone was
          // never enough: rows above the anchor re-measure/decode late, so the
          // view went "quiet" with the anchor still sitting off its offset.
          let anchorSettled = false;
          if (frames >= INDEX_RESTORE_MIN_ASSERT_FRAMES) {
            quietFrames = h === lastHeight ? quietFrames + 1 : 0;
            anchorSettled = restoreToAnchor(el, saved);
          }
          lastHeight = h;
          if (shouldReleaseIndexRestore({ frame: frames, quietFrames, elapsedMs: Date.now() - startAt, anchorSettled })) {
            cleanup();
            return;
          }
          rafRef.current = requestAnimationFrame(releaseWhenSettled);
        };
        rafRef.current = requestAnimationFrame(releaseWhenSettled);

        return () => {
          cancelled = true;
          cleanup();
        };
      }

      const startAt = Date.now();
      let lastActivityAt = startAt;
      let lastHeight = el.scrollHeight;
      let misses = 0;

      restoreToAnchor(el, saved);

      // Growth-aware settle: re-pin the anchor every frame and keep the loop
      // alive until the container height has been quiet AND the anchor has been
      // within tolerance for SETTLE_QUIET_MS. Any async content growth (images,
      // embeds, quoted notes decoding on a slow network) resets the timer, so
      // the position tracks the anchor until the view genuinely stops moving —
      // this is the piece the fixed-window home restorer lacked on real
      // devices. rAF (not a fixed timer) also pins within a single frame of any
      // layout shift a MutationObserver can't see (image decode / font swap).
      const frame = () => {
        if (cancelled) return;
        const now = Date.now();
        const settled = restoreToAnchor(el, saved, misses >= VIRTUAL_JUMP_AFTER_MISSES);
        misses = settled ? 0 : misses + 1;

        const h = el.scrollHeight;
        if (h !== lastHeight) { lastHeight = h; lastActivityAt = now; }
        if (!settled) lastActivityAt = now;

        if (settled && now - lastActivityAt >= SETTLE_QUIET_MS) { cleanup(); return; }
        if (now - startAt >= HARD_CAP_MS) { cleanup(); return; }
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);

      return () => {
        cancelled = true;
        cleanup();
      };
    } else {
      el.scrollTo(0, 0);
    }

    return () => {
      isRestoringRef.current = false;
      if (driveGlobalWindow) endRestoreWindow();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, containerRef, keySuffix, driveGlobalWindow]);
}
