// App-update detection + user-initiated restart (the "Update ready" pill).
//
// Two independent detectors feed one tiny store:
//
//  (a) Service worker signals — a `waiting` worker, an install completing
//      while the page is controlled, or the controller changing under a
//      controlled page. This app's sw.js calls skipWaiting() on install, so
//      in practice controllerchange is the usual SW signal: main.tsx defers
//      its automatic reload until the tab is backgrounded, and the pill lets
//      the user restart NOW instead of waiting.
//
//  (b) Version poll — on visibilitychange→visible (throttled), fetch
//      /api/version and compare it to the APP_VERSION baked into this bundle.
//      This catches the iOS resumed-snapshot case: an installed PWA resumed
//      from a saved snapshot can run for a long time without the service
//      worker ever getting a chance to check for updates.
//
// "Never appear falsely" rules:
//  - the automatic poll only runs in stamped production builds
//    (import.meta.env.PROD and RUNNING_APP_VERSION !== "dev")
//  - offline/failed responses are ignored, and the poll URL carries the
//    running version as a query param so the service worker's network-first
//    /api/ cache can never replay an answer cached by a DIFFERENT running
//    build (the classic stale-cache false positive after an update)
//  - SW signals are ignored unless the page was already controlled at boot —
//    the very first install fires updatefound + controllerchange (via
//    clients.claim()) even though the user just loaded the latest version.

import { dropWorkerAndCaches, onShellUpdated, reloadOntoFreshShell } from "./sw-shell";
import { installUpdateOnReturn, pageLooksBusy } from "./update-on-return";
import { shouldApplyUpdate, type UpdateContext } from "./update-policy";
import { onAppNavigation } from "./app-history";
import { isCallActive } from "./call-presence";
import { hasSignupDraft } from "./account-draft";

// Same expression as APP_VERSION in nip34-feedback.ts — duplicated on purpose
// so this module stays dependency-free (importable from main.tsx and tests
// without dragging in the nostr/DM stack).
export const RUNNING_APP_VERSION: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_VERSION) || "dev";

export interface AppUpdateState {
  /** True when a confirmed update is ready and not dismissed — show the pill. */
  ready: boolean;
  /** Which detector fired ("sw" | "poll"), null before any detection. */
  source: "sw" | "poll" | null;
  /** Target version when known (poll detections); null for SW-only signals. */
  version: string | null;
}

const POLL_MIN_INTERVAL_MS = 5 * 60 * 1000;

/* ----------------------------------------------------------------------------
 * Pure helpers (unit-tested in app-update.test.ts)
 * ------------------------------------------------------------------------- */

/** Should a fetched server version trigger the update flow for this build? */
export function shouldOfferUpdate(running: string, fetched: unknown): boolean {
  if (typeof fetched !== "string") return false;
  const v = fetched.trim();
  if (!v || v === "unknown") return false;
  // Unstamped builds ("dev") have nothing meaningful to compare against.
  if (!running || running === "dev" || running === "unknown") return false;
  return v !== running;
}

/** Visibility-driven poll throttle: at most one network check per interval. */
export function shouldPollNow(
  now: number,
  lastPollAt: number,
  minIntervalMs: number = POLL_MIN_INTERVAL_MS,
): boolean {
  return now - lastPollAt >= minIntervalMs;
}

/* ----------------------------------------------------------------------------
 * Store
 * ------------------------------------------------------------------------- */

let state: AppUpdateState = { ready: false, source: null, version: null };
const listeners = new Set<() => void>();

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: AppUpdateState): void {
  state = next;
  for (const l of Array.from(listeners)) {
    try { l(); } catch {}
  }
}

/** When the current update became ready; the idle fallback counts from here. */
let readyAt: number | null = null;

function reportUpdate(source: "sw" | "poll", version: string | null): void {
  // Already known — keep the more specific (versioned) info we have.
  if (state.ready && (state.version === version || (state.version && !version))) return;
  if (!state.ready) readyAt = Date.now();
  setState({ ready: true, source, version: version ?? state.version });
}

/**
 * A file of the running build is gone from the server: a newer build is out.
 * Reported by the pages the app loads ahead of time (lib/lazy-retry.ts
 * preloadChunk). The quiet update then moves on at the next tap or when
 * nobody is writing — the pre-load itself never reloads anything.
 */
export function noteNewerBuild(): void {
  reportUpdate("poll", null);
}

/* ----------------------------------------------------------------------------
 * (a) Service worker signals
 * ------------------------------------------------------------------------- */

// Snapshot taken at module init (before registration): if the page was NOT
// controlled when it loaded, everything the first worker does — install,
// activate, clients.claim()'s controllerchange — is "becoming current", not
// an update. Gating on this is what keeps the pill silent on first visits.
const wasControlledAtBoot: boolean =
  typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;

let registrationRef: ServiceWorkerRegistration | null = null;

/**
 * Called once from main.tsx with the registration it already owns (we never
 * re-register). Wires the SW-side update detectors.
 */
export function attachServiceWorkerUpdateSignals(
  registration: ServiceWorkerRegistration,
): void {
  registrationRef = registration;
  // The worker opened this launch from its cached page and has since found a
  // newer one (sw.js): this build is out of date. Only ever sent to a page the
  // worker served, so it needs no first-visit gate.
  onShellUpdated(() => reportUpdate("sw", null));
  if (!wasControlledAtBoot) return;

  if (registration.waiting) reportUpdate("sw", null);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" || installing.state === "activated") {
        reportUpdate("sw", null);
      }
    });
  });

  // sw.js skipWaiting()s on install, so a new deploy usually lands here: the
  // new worker takes control while the (old) page keeps running. main.tsx
  // schedules its own deferred reload; the pill offers an immediate one.
  try {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      reportUpdate("sw", null);
    });
  } catch {}
}

/* ----------------------------------------------------------------------------
 * (b) Version poll
 * ------------------------------------------------------------------------- */

let lastPollAt = 0;
let pollingStarted = false;

async function fetchServerVersion(): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    // The `running` param keys the request URL on THIS build's version, so the
    // service worker's network-first cache can only ever replay an answer this
    // same build fetched — never a stale answer from before/after an update.
    const res = await fetch(
      `/api/version?running=${encodeURIComponent(RUNNING_APP_VERSION)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  }
}

async function pollAndCompare(): Promise<void> {
  const server = await fetchServerVersion();
  if (server && shouldOfferUpdate(RUNNING_APP_VERSION, server)) {
    reportUpdate("poll", server);
  }
}

/**
 * Idempotent. Starts the visibility-driven version poll (production, stamped
 * builds only). Cheap by design: no interval — a check runs at most once per
 * POLL_MIN_INTERVAL_MS, and only when the tab becomes visible.
 */
export function startAppUpdatePolling(): void {
  if (pollingStarted) return;
  pollingStarted = true;
  if (typeof document === "undefined") return;
  if (!import.meta.env.PROD) return;
  if (RUNNING_APP_VERSION === "dev" || RUNNING_APP_VERSION === "unknown") return;

  // Arm the throttle from now so a quick tab-switch right after load doesn't
  // poll. A launch served from the worker's cached page may be one build
  // behind; the worker says so itself ("ro-shell-updated", wired above).
  lastPollAt = Date.now();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!shouldPollNow(Date.now(), lastPollAt)) return;
    lastPollAt = Date.now();
    void pollAndCompare();
  });

  // Back after a long break with a newer build out: move onto it by itself
  // (lib/update-on-return.ts). Installed apps resume rather than relaunch, so
  // without this a phone ran an old build until someone forced the update.
  // A dismissed pill means "not now", not "never", so this asks the server.
  installUpdateOnReturn({
    checkForUpdate: async () => {
      if (state.ready) return true;
      const server = await fetchServerVersion();
      lastPollAt = Date.now();
      if (!server || !shouldOfferUpdate(RUNNING_APP_VERSION, server)) return false;
      reportUpdate("poll", server);
      return true;
    },
    apply: applyUpdate,
    alsoBusy: () => isCallActive() || hasSignupDraft(),
  });
  installQuietUpdates();
}

/** How often a parked screen is asked whether it may move on. */
const IDLE_TICK_MS = 30 * 1000;

/**
 * Quiet updates: the moments at which the app moves onto a ready update
 * without anyone tapping anything (the decision itself: update-policy.ts).
 *   - the next in-app navigation opens its page on the new version;
 *   - going to the background;
 *   - a parked screen, once the update is old enough and nobody has touched
 *     it for a while;
 *   - coming back after a long time away (installUpdateOnReturn above).
 */
let quietInstalled = false;
function installQuietUpdates(): void {
  if (quietInstalled) return;
  quietInstalled = true;
  let lastInputAt = Date.now();
  const touched = () => { lastInputAt = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) {
    window.addEventListener(ev, touched, { passive: true, capture: true });
  }
  const context = (): UpdateContext => ({
    ready: state.ready,
    readyForMs: readyAt === null ? 0 : Date.now() - readyAt,
    visible: document.visibilityState === "visible",
    busy: pageLooksBusy(document),
    inCall: isCallActive(),
    signupDraft: hasSignupDraft(),
    idleForMs: Date.now() - lastInputAt,
  });
  onAppNavigation((url) => {
    if (shouldApplyUpdate("navigation", context())) applyUpdate(url);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && shouldApplyUpdate("hidden", context())) applyUpdate();
  });
  setInterval(() => {
    if (shouldApplyUpdate("idle-tick", context())) applyUpdate();
  }, IDLE_TICK_MS);
}

/* ----------------------------------------------------------------------------
 * User actions
 * ------------------------------------------------------------------------- */

/**
 * Restart onto the new version. User-initiated, so an immediate reload is
 * fine (the deferred-reload contract in main.tsx only governs AUTOMATIC
 * reloads). If a waiting worker exists, promote it first so the reload lands
 * on the new build.
 */
export function applyUpdate(destination?: string): void {
  // With a destination (an in-app navigation that was about to happen), the
  // fresh page opens THERE. replace, not assign: the app has already pushed
  // that entry, so a second one would make Back a no-op.
  const load = destination
    ? () => { try { window.location.replace(destination); } catch { window.location.reload(); } }
    : undefined;
  const waiting = registrationRef?.waiting;
  if (waiting) {
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      void reloadOntoFreshShell(load);
    };
    try {
      navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    } catch {}
    try { waiting.postMessage("SKIP_WAITING"); } catch {}
    // Safety net: reload even if controllerchange never fires.
    setTimeout(reload, 1500);
    return;
  }
  // The worker answers launches from its cached page, so have it fetch the new
  // one first, or the reload would land on the old build again.
  void reloadOntoFreshShell(load);
}

export type UpdateCheckResult = "update-ready" | "up-to-date" | "unavailable";

/**
 * Settings' "Check for updates": registration.update() + a fresh version
 * compare. A manual check clears any earlier dismissal — the user asked.
 */
export async function checkForUpdatesNow(): Promise<UpdateCheckResult> {

  try { await registrationRef?.update(); } catch {}

  if (state.ready) return "update-ready";

  const server = await fetchServerVersion();
  lastPollAt = Date.now();
  if (server && shouldOfferUpdate(RUNNING_APP_VERSION, server)) {
    reportUpdate("poll", server);
    return "update-ready";
  }

  // registration.update() may have produced a waiting worker just now.
  if (registrationRef?.waiting && wasControlledAtBoot) {
    reportUpdate("sw", null);
  }
  if (state.ready) return "update-ready";

  return server ? "up-to-date" : "unavailable";
}

/**
 * Settings' "Repair app": unregister every service worker, delete every
 * Cache Storage cache, then hard-reload. This is the "delete + reinstall"
 * replacement that PRESERVES logins: localStorage and IndexedDB — where
 * accounts, keys and settings live — are deliberately untouched. Every step
 * is best-effort; the reload happens no matter what.
 */
export async function repairApp(): Promise<void> {
  await dropWorkerAndCaches();
  try { window.location.reload(); } catch {}
}
