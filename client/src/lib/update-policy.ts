/**
 * Quiet updates: when a new version is ready, the app moves onto it at the
 * next natural boundary — where a reload looks like a page opening, not an
 * interruption — and never while the person is in the middle of something.
 * Nothing to read, nothing to tap (owner, 2026-10-01; the "Update ready"
 * pill is gone).
 *
 * This is the whole decision, pure, so the behaviour is one table
 * (update-policy.test.ts). What counts as a navigation, how idle is measured
 * and what "busy" looks at are the caller's business (app-update.ts).
 */

/** The moments at which the app asks whether to move onto the new version. */
export type UpdateMoment =
  /** An in-app navigation is about to happen: the new page can open on the new version. */
  | "navigation"
  /** The app just went to the background: nobody is watching. */
  | "hidden"
  /** The app came back to the foreground after `awayMs` away. */
  | "returned"
  /** A periodic check while the screen sits untouched. */
  | "idle-tick";

export interface UpdateContext {
  /** A new version is confirmed available. */
  ready: boolean;
  /** How long it has been available. */
  readyForMs: number;
  visible: boolean;
  /** Text in a field, media playing — see update-on-return.ts pageLooksBusy. */
  busy: boolean;
  inCall: boolean;
  /** The signup flow is in progress (keys not yet backed up). */
  signupDraft: boolean;
  /** No touch, key, wheel or scroll for this long. */
  idleForMs: number;
  /** For "returned": how long the app was in the background. */
  awayMs?: number;
}

/** A parked screen moves on once the update has been ready this long … */
export const IDLE_APPLY_AFTER_READY_MS = 10 * 60 * 1000;
/** … and nobody has touched it for this long. */
export const IDLE_MS = 60 * 1000;
/** Coming back after this long away counts as a fresh start. */
export const RETURN_AWAY_MS = 15 * 60 * 1000;

export function shouldApplyUpdate(moment: UpdateMoment, ctx: UpdateContext): boolean {
  if (!ctx.ready) return false;
  // Never in the middle of something — not even in the background, where a
  // half-written post would be lost just the same.
  if (ctx.busy || ctx.inCall || ctx.signupDraft) return false;
  switch (moment) {
    case "navigation":
      return true;
    case "hidden":
      return true;
    case "returned":
      return (ctx.awayMs ?? 0) >= RETURN_AWAY_MS;
    case "idle-tick":
      return ctx.visible && ctx.readyForMs >= IDLE_APPLY_AFTER_READY_MS && ctx.idleForMs >= IDLE_MS;
  }
}
