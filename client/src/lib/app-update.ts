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
const DISMISS_KEY = "ro-update-dismissed";
/** Unversioned SW detections use this token for dismissal bookkeeping. */
const SW_TOKEN = "sw";

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

/**
 * Dismissal contract: dismiss hides the pill until the next DETECTED version
 * change. An unversioned SW signal can never prove it's a *different* update
 * than the one already dismissed, so it stays hidden; only a poll detection
 * with a different version string re-shows.
 */
export function isDismissed(
  dismissedToken: string | null,
  candidateToken: string,
): boolean {
  if (!dismissedToken) return false;
  if (candidateToken === SW_TOKEN) return true;
  return candidateToken === dismissedToken;
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

function readDismissedToken(): string | null {
  try { return sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
}

export function dismissUpdate(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, state.version ?? SW_TOKEN);
  } catch {}
  setState({ ...state, ready: false });
}

function reportUpdate(source: "sw" | "poll", version: string | null): void {
  const token = version ?? SW_TOKEN;
  if (isDismissed(readDismissedToken(), token)) return;
  // Already showing — keep the more specific (versioned) info we have.
  if (state.ready && (state.version === version || (state.version && !version))) return;
  setState({ ready: true, source, version: version ?? state.version });
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

  // A fresh page load just fetched the served build — it IS current. Arm the
  // throttle from now so a quick tab-switch right after load doesn't poll.
  lastPollAt = Date.now();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!shouldPollNow(Date.now(), lastPollAt)) return;
    lastPollAt = Date.now();
    void pollAndCompare();
  });
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
export function applyUpdate(): void {
  const waiting = registrationRef?.waiting;
  if (waiting) {
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      try { window.location.reload(); } catch {}
    };
    try {
      navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    } catch {}
    try { waiting.postMessage("SKIP_WAITING"); } catch {}
    // Safety net: reload even if controllerchange never fires.
    setTimeout(reload, 1500);
    return;
  }
  try { window.location.reload(); } catch {}
}

export type UpdateCheckResult = "update-ready" | "up-to-date" | "unavailable";

/**
 * Settings' "Check for updates": registration.update() + a fresh version
 * compare. A manual check clears any earlier dismissal — the user asked.
 */
export async function checkForUpdatesNow(): Promise<UpdateCheckResult> {
  try { sessionStorage.removeItem(DISMISS_KEY); } catch {}

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
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.allSettled(regs.map((r) => r.unregister()));
  } catch {}
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  try { sessionStorage.removeItem(DISMISS_KEY); } catch {}
  try { window.location.reload(); } catch {}
}
