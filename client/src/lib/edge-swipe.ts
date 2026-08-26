/**
 * Should this touch gesture go back?
 *
 * An earlier swipe-navigation attempt was switched off in App.tsx because it
 * "triggered back/forward while scrolling" — it matched a horizontal swipe
 * ANYWHERE on screen, and it also ran backwards: it sent a LEFTWARD swipe to
 * history.back() and a rightward one to history.forward(), the opposite of what
 * every phone does.
 *
 * This is the platform gesture instead: start on the left edge, move right, and
 * mean it. Kept pure so the thresholds — the exact thing that made the old one
 * misfire — are pinned by tests rather than by feel.
 */

export interface SwipeSample {
  /** Where the finger went down, in px from the left of the viewport. */
  startX: number;
  /** Horizontal travel; positive is rightward. */
  dx: number;
  /** Vertical travel; sign doesn't matter. */
  dy: number;
  elapsedMs: number;
}

/** How far from the edge a back gesture may begin. Matches the ~20px iOS uses. */
export const EDGE_WIDTH = 24;
/** Enough travel to be a decision rather than a stray contact. */
const MIN_DISTANCE = 70;
/** Vertical drift allowed, as a share of horizontal travel. */
const MAX_SLOPE = 0.5;
/** A back swipe is a flick; anything slower is a drag or a hesitation. */
const MAX_DURATION_MS = 600;

export function isEdgeBackSwipe(s: SwipeSample, opts?: { edgeWidth?: number }): boolean {
  const edge = opts?.edgeWidth ?? EDGE_WIDTH;
  if (s.startX > edge) return false;          // must begin at the edge
  if (s.dx < MIN_DISTANCE) return false;      // rightward, and far enough
  if (Math.abs(s.dy) > s.dx * MAX_SLOPE) return false; // not a scroll
  if (s.elapsedMs > MAX_DURATION_MS) return false;
  return true;
}

/**
 * Should the app attach its OWN edge-swipe-back handler here?
 *
 * Only where no native gesture exists — iOS standalone PWA, the environment
 * this handler was written for. Everywhere else the platform already turns
 * the same gesture into history.back(): Safari-in-browser has its chrome
 * swipe, Android has the system back gesture (browser and PWA alike). Running
 * ours on top of those made ONE swipe navigate back TWICE — reported as back
 * "not saving where users should return": the intended entry was skipped
 * straight through.
 */
export function shouldAttachCustomBackSwipe(env: { standalone: boolean; iOS: boolean }): boolean {
  return env.standalone && env.iOS;
}

/** Impure half: read the environment (kept out of the predicate for tests). */
export function detectBackGestureEnv(): { standalone: boolean; iOS: boolean } {
  if (typeof window === "undefined") return { standalone: false, iOS: false };
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    nav.standalone === true;
  // iPadOS reports "MacIntel"; multi-touch is the tell.
  const iOS = /iP(hone|ad|od)/.test(nav.userAgent)
    || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  return { standalone, iOS };
}
