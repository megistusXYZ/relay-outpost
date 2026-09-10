/**
 * Home keep-alive — the timeline is never rebuilt on back, so it can never be
 * rebuilt wrong.
 *
 * Before this, Home lived inside the route <Switch> (and a per-route keyed
 * ErrorBoundary), so opening a thread UNMOUNTED it and Back remounted it: a
 * snapshot list, a re-seeded virtualizer (flat height estimates), an index
 * jump, a pixel-anchor correction loop and a decode hold all cooperated to
 * rebuild an approximation of what the reader had. Measured 2026-09-10: a
 * wrong first frame (up to 857px) and intermittent 43px drift on desktop; on
 * the iPhone path (plain list) 42px drift plus 17–660px lurches on every
 * scroll-up step, because remounted rows lose their remembered
 * content-visibility sizes and WebKit has no scroll anchoring.
 *
 * Instead, Home stays mounted — hidden, frozen — while its history entry is
 * below the current one (a drill-in: thread, profile, …), and Back reveals the
 * SAME DOM. This module is the pure decision: which instance exists and
 * whether it is visible, given where history now points.
 */

/** Where history points right now. */
export interface NavPoint {
  /** wouter location (pathname only). */
  path: string;
  /** The entry's scroll-restore `_scrollToken` (null until minted). */
  token: string | null;
  /** The entry's in-app history index (lib/app-history.ts). */
  idx: number;
}

/** One kept-alive Home, bound to one history entry. */
export interface HomeInstance {
  /** Stable React key for the instance's whole life. */
  key: string;
  token: string | null;
  /** The entry's in-app index, as last seen while Home was showing. */
  idx: number;
}

export interface HomeLayer {
  instance: HomeInstance | null;
  visible: boolean;
}

export const HOME_PATH = "/";

/**
 * Is `nav` the entry this instance is bound to? The token is the identity —
 * but it is minted in a layout effect AFTER Home's first render, so while
 * either side is still null the entry's in-app index stands in for it.
 */
function isSameEntry(inst: HomeInstance, nav: NavPoint): boolean {
  if (inst.token !== null && nav.token !== null) return inst.token === nav.token;
  return inst.idx === nav.idx;
}

/**
 * How many entries above Home it may stay alive through. Real drill-ins are a
 * handful deep; past this, holding a hidden feed isn't worth the memory and
 * the generic restorer (lib/scroll-restore.ts) covers the eventual Back.
 */
export const MAX_KEEPALIVE_DEPTH = 15;

/**
 * Decide the Home layer for the navigation that just happened:
 *  - on "/" at the instance's own entry → that instance, visible (a reveal
 *    when it was hidden);
 *  - on "/" at any other entry (a fresh push/replace to "/") → a new Home;
 *  - anywhere else with Home's entry still BELOW (a drill-in) → the same
 *    instance, hidden;
 *  - otherwise (Home's entry replaced by a tab switch, popped past, or the
 *    drill-in deeper than the cap) → none.
 */
export function nextHomeLayer(prev: HomeInstance | null, nav: NavPoint): HomeLayer {
  if (nav.path === HOME_PATH) {
    if (prev && isSameEntry(prev, nav)) {
      const adopted = prev.token === null && nav.token !== null ? { ...prev, token: nav.token } : prev;
      return { instance: adopted, visible: true };
    }
    return { instance: { key: `home:${nav.idx}:${nav.token ?? "pending"}`, token: nav.token, idx: nav.idx }, visible: true };
  }
  if (prev && nav.idx > prev.idx && nav.idx - prev.idx <= MAX_KEEPALIVE_DEPTH) {
    return { instance: prev, visible: false };
  }
  return { instance: null, visible: false };
}

// The layer's last COMMITTED state, published after every commit by
// components/HomeKeepAlive.tsx. The generic restorer's layout effect runs
// before the layer's within one commit, so it reads the PREVIOUS commit —
// exactly its question: "is the entry we just returned to a kept-alive Home
// that is about to be revealed?"
let committedLayer: HomeLayer | null = null;

export function publishCommittedHomeLayer(layer: HomeLayer): void {
  committedLayer = layer;
}

export function getCommittedHomeLayer(): HomeLayer | null {
  return committedLayer;
}

/**
 * Should the generic restorer (hooks/use-scroll-restore.ts) stay out of this
 * navigation? Only for a back onto the kept-alive Home entry while that Home
 * is still hidden: the layer is about to reveal the SAME DOM, and a second
 * writer would only fight it. `committed` is the layer's previous commit.
 */
export function shouldGenericRestoreStandDown(committed: HomeLayer | null, nav: NavPoint): boolean {
  if (nav.path !== HOME_PATH || !committed?.instance || committed.visible) return false;
  return isSameEntry(committed.instance, nav);
}
