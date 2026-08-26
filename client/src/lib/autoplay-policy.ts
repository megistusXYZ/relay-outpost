/**
 * May this video start on its own?
 *
 * Autoplay is ON by default now, which overrides the "calm defaults" principle
 * deliberately: that principle was set when video was a small inline element,
 * and a 700px static black rectangle is not calm, it is broken. Muted video
 * startles nobody. But "on by default" is only defensible with the guards
 * below actually enforced, so they live here as one pure decision instead of
 * as conditions scattered through a player.
 *
 * The function returns a REASON rather than a boolean. "Autoplay is off" and
 * "this person asked for less motion" and "this connection is metered" are
 * different facts, and collapsing them to `false` throws away the only
 * information anyone debugging a report would want.
 *
 * See MEDIA_FEED_PLAN.md, decision 5.
 */

/** Below this, a phone will stutter decoding video while scrolling. */
export const LOW_END_MEMORY_GB = 4;
/**
 * Two cores, not four.
 *
 * At 4 this denied autoplay on a large slice of perfectly capable phones:
 * iOS Safari commonly reports exactly 4 for `hardwareConcurrency`, and since
 * Safari reports no `deviceMemory` at all, that single number was deciding the
 * whole question there. The result was the setting reading ON while nothing
 * ever played, with no way to see why.
 *
 * A 4-core device in 2026 is a normal phone. Two is the honest floor for
 * "decoding video while scrolling will hurt".
 */
export const LOW_END_CORES = 2;

/**
 * Fraction of the player that must be on screen before it starts. Higher than
 * feels necessary, on purpose: a video that starts while a sliver is showing
 * has already spent bandwidth by the time it is scrolled past.
 */
export const AUTOPLAY_VISIBILITY_THRESHOLD = 0.6;

export interface AutoplayEnvironment {
  /** The user's setting. Default ON — see video-prefs. */
  settingEnabled: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** `navigator.connection.saveData`. */
  saveData: boolean;
  /** effectiveType is 2g or slow-2g. */
  slowConnection: boolean;
  /** `navigator.deviceMemory` in GB, when the browser reports it. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`, when the browser reports it. */
  hardwareConcurrency?: number;
  /** An unrevealed content warning sits over this media. */
  contentWarning: boolean;
}

export type AutoplayVerdict =
  | "allow"
  | "off"
  | "content-warning"
  | "reduced-motion"
  | "save-data"
  | "slow-connection"
  | "low-end-device";

/**
 * Order is meaningful: the most specific and least negotiable reason wins, so
 * the verdict names the real cause rather than whichever check ran first.
 *
 * Reduced motion outranks the user's own autoplay setting because it is an
 * accessibility need, not a preference — someone who turned autoplay on and
 * also asked their OS for less motion has not contradicted themselves; the OS
 * setting is the one that means "this makes me unwell".
 */
export function autoplayDecision(env: AutoplayEnvironment): AutoplayVerdict {
  if (env.reducedMotion) return "reduced-motion";
  // A warning you can watch play out behind a blur is not a warning.
  if (env.contentWarning) return "content-warning";
  if (env.saveData) return "save-data";
  if (env.slowConnection) return "slow-connection";
  if (isLowEndDevice(env)) return "low-end-device";
  if (!env.settingEnabled) return "off";
  return "allow";
}

export function mayAutoplay(env: AutoplayEnvironment): boolean {
  return autoplayDecision(env) === "allow";
}

/**
 * Absent values are NOT treated as low-end. Most browsers do not report
 * deviceMemory at all (it is Chromium-only), and Safari reports neither — so
 * treating "unknown" as weak would disable autoplay for every iPhone, which is
 * the opposite of the intent.
 */
export function isLowEndDevice(
  env: Pick<AutoplayEnvironment, "deviceMemory" | "hardwareConcurrency">,
): boolean {
  const mem = env.deviceMemory;
  const cores = env.hardwareConcurrency;
  if (typeof mem === "number" && mem > 0 && mem <= LOW_END_MEMORY_GB) return true;
  if (typeof cores === "number" && cores > 0 && cores <= LOW_END_CORES) return true;
  return false;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

/** Sample the browser. The impure half, kept to one place. */
export function readAutoplayEnvironment(opts: {
  settingEnabled: boolean;
  contentWarning: boolean;
}): AutoplayEnvironment {
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {}

  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & {
    connection?: NetworkInformationLike;
    deviceMemory?: number;
  }) : undefined;
  const conn = nav?.connection;
  const effectiveType = conn?.effectiveType ?? "";

  return {
    settingEnabled: opts.settingEnabled,
    contentWarning: opts.contentWarning,
    reducedMotion,
    saveData: conn?.saveData === true,
    slowConnection: effectiveType === "2g" || effectiveType === "slow-2g",
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  };
}
