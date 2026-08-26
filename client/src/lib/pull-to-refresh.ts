/**
 * Pull-to-refresh gesture math — the decidable half of the gesture.
 *
 * The chat list's manual refresh button is desktop-only; on touch the same
 * doRefresh is driven by the native pull idiom instead. The DOM listeners live
 * in hooks/use-pull-to-refresh.ts and are deliberately thin: everything that
 * decides whether a drag becomes a refresh — the resistance curve, the
 * trigger threshold, the phase the indicator renders — is a pure function
 * here, pinned by pull-to-refresh.test.ts.
 *
 * The numbers, and why they interlock (the test asserts the interlock):
 * DAMP_FACTOR trails the finger so the strip feels physical; PULL_MAX_PX caps
 * how far the layout can be pushed; PULL_TRIGGER_PX is the commit point. The
 * cap must clear the trigger and a realistic thumb drag must still arm it —
 * otherwise this is a control that can never fire, which is worse than no
 * control (see dead-control-is-usually-disabled).
 */

/** Release at or past this indicator height fires the refresh. */
export const PULL_TRIGGER_PX = 70;
/** Hard cap on the indicator height while the finger is down. */
export const PULL_MAX_PX = 110;
/** Fixed strip height while the refresh itself runs (finger has lifted). */
export const PULL_HOLD_PX = 44;

const DAMP_FACTOR = 0.45;

/** Raw finger travel (px, positive = downward) → damped indicator height. */
export function dampPull(rawDeltaPx: number): number {
  if (rawDeltaPx <= 0) return 0;
  return Math.min(Math.round(rawDeltaPx * DAMP_FACTOR), PULL_MAX_PX);
}

/** Has the pull crossed the commit point? Release now = refresh. */
export function pullArmed(pullPx: number): boolean {
  return pullPx >= PULL_TRIGGER_PX;
}

export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

/**
 * The phase the indicator renders. `refreshing` wins unconditionally: once
 * the refresh is running the strip holds steady whatever the finger does,
 * rather than flickering back into a pull.
 */
export function pullPhase(pullPx: number, refreshing: boolean): PullPhase {
  if (refreshing) return "refreshing";
  if (pullPx <= 0) return "idle";
  return pullArmed(pullPx) ? "armed" : "pulling";
}

/**
 * Indicator strip height: tracks the finger while pulling, then snaps to a
 * fixed hold height while the refresh runs so the layout doesn't depend on
 * wherever the finger happened to lift.
 */
export function indicatorHeight(pullPx: number, refreshing: boolean): number {
  if (refreshing) return PULL_HOLD_PX;
  return Math.max(0, Math.min(pullPx, PULL_MAX_PX));
}
