// iOS/iPadOS capability gate for feed virtualization.
//
// Why this exists: @tanstack/react-virtual positions absolutely-placed rows
// via `translateY` recomputed from scroll events. iOS Safari composites
// momentum scrolling on a separate thread and delivers scroll events late /
// coalesced, so under fast flicks the virtualizer's transforms go stale and
// rows paint at wrong offsets — observed in production as random glitching
// and, at worst, a near-black page with a single mispositioned row (third
// escalation; PR #320's measurement fixes reduced but did not eliminate it).
// On iOS we therefore render the plain (pre-virtualization) list path. (It
// once leaned on `content-visibility: auto` for laziness; WebKit left rows
// blank mid-fling, so posts always draw now — posts-always-drawn.test.ts.)
//
// Overrides, for testing on any device (read once per feed mount):
//   • `?forcePlainFeed=1` in the URL          → plain list path
//   • `localStorage.ro_virtual_feed = "0"`    → plain list path (kill-switch)
//   • `localStorage.ro_virtual_feed = "1"`    → virtualize even on iOS (debug)

import { isIOSDevice, type NavigatorLike } from "./platform";

// The iOS check lives in lib/platform.ts with the other device checks.
export { isIOSDevice };
/** The subset of `navigator` the detector reads — injectable for tests. */
export type IOSNavigatorLike = NavigatorLike;

/** Injectable environment for `feedVirtualizationEnabled` — tests pass all fields. */
export interface FeedVirtualizationEnv {
  nav?: IOSNavigatorLike;
  /** `window.location.search` (with or without the leading `?`). */
  search?: string;
  /** The `ro_virtual_feed` localStorage value (null when unset). */
  storedFlag?: string | null;
}

/**
 * Should the feed use the virtualized renderer? Decision order:
 *   1. `?forcePlainFeed=1`        → false (works on any device, shareable URL)
 *   2. `ro_virtual_feed === "0"`  → false (kill-switch, any platform)
 *   3. `ro_virtual_feed === "1"`  → true  (force-on, overrides the iOS gate)
 *   4. iOS/iPadOS touch device    → false (see header comment)
 *   5. otherwise                  → true  (desktop/Android keep virtualization)
 */
export function feedVirtualizationEnabled(env?: FeedVirtualizationEnv): boolean {
  let search = env?.search;
  if (search === undefined) {
    try { search = window.location.search; } catch { search = ""; }
  }
  try {
    if (new URLSearchParams(search).get("forcePlainFeed") === "1") return false;
  } catch {}

  let flag: string | null;
  if (env && "storedFlag" in env) {
    flag = env.storedFlag ?? null;
  } else {
    try { flag = localStorage.getItem("ro_virtual_feed"); } catch { flag = null; }
  }
  if (flag === "0") return false;
  if (flag === "1") return true;

  return !isIOSDevice(env?.nav);
}
