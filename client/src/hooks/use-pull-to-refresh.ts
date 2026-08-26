/**
 * Touch-driven pull-to-refresh on a scroll container.
 *
 * Thin by design: every decision (resistance, trigger threshold, phases) is a
 * pure function in lib/pull-to-refresh.ts where it is tested; this hook only
 * translates touch events into a pull distance and fires `onTrigger` when the
 * finger releases past the commit point.
 *
 * Gesture rules:
 *  - Only arms when the container sits at scrollTop 0 on touchstart — a pull
 *    mid-list is just scrolling.
 *  - Once the pull is live we preventDefault the move (non-passive listener):
 *    we own the gesture, and iOS must not rubber-band the page underneath it.
 *  - touchcancel resets WITHOUT triggering — an interrupted gesture is not a
 *    request.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { dampPull, pullArmed } from "@/lib/pull-to-refresh";

export function usePullToRefresh({
  targetRef,
  enabled,
  refreshing,
  onTrigger,
}: {
  targetRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  refreshing: boolean;
  onTrigger: () => void;
}): { pullPx: number; pulling: boolean } {
  const [pullPx, setPullPx] = useState(0);
  // Mirrors for values the listeners need fresh without re-binding on every
  // render: the live pull distance, the refresh flag, and the trigger.
  const pullPxRef = useRef(0);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  useEffect(() => {
    const el = targetRef.current;
    if (!el || !enabled) return;

    let startY: number | null = null;

    const setPull = (px: number) => {
      pullPxRef.current = px;
      setPullPx(px);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || refreshingRef.current) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      // The finger wandered into a real scroll — stand down for this touch.
      if (el.scrollTop > 0) {
        startY = null;
        if (pullPxRef.current > 0) setPull(0);
        return;
      }
      const px = dampPull(e.touches[0].clientY - startY);
      if (px > 0) {
        // cancelable is false during an in-flight native scroll; calling
        // preventDefault then just logs a console error.
        if (e.cancelable) e.preventDefault();
        setPull(px);
      } else if (pullPxRef.current > 0) {
        setPull(0);
      }
    };

    const settle = (trigger: boolean) => {
      if (startY === null) return;
      startY = null;
      if (trigger && pullArmed(pullPxRef.current) && !refreshingRef.current) {
        onTriggerRef.current();
      }
      setPull(0);
    };

    const onTouchEnd = () => settle(true);
    const onTouchCancel = () => settle(false);

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [targetRef, enabled]);

  return { pullPx, pulling: pullPx > 0 };
}
