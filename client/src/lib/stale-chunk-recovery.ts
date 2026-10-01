// Recovery for stale chunk-load failures after a deploy.
//
// Problem: Vite emits content-hashed chunk filenames (e.g. Profile-aBc12.js).
// When we ship a new build, an already-open tab/PWA still references the old
// filenames. Navigating to a not-yet-visited route triggers a dynamic import
// for a chunk that no longer exists, surfacing as "Something went wrong".
//
// Strategy: detect chunk-load errors specifically and force a one-shot full
// page reload so the browser re-fetches index.html (and the new chunk names).
// A sessionStorage sentinel prevents reload loops if the reload doesn't fix
// the problem (e.g. real network outage, real bug).

import { hasSignupDraft } from "@/lib/account-draft";
import { reloadOntoFreshShell } from "@/lib/sw-shell";

const SENTINEL_KEY = "relay-outpost-stale-chunk-reload";
const SENTINEL_TTL_MS = 30_000;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  // Vite/Rollup, Webpack, and native dynamic-import failures all surface with
  // one of these signatures depending on the browser. Match broadly — but
  // intentionally do NOT match a bare "Failed to fetch" string, which any
  // aborted/blocked fetch (e.g. media uploads on flaky mobile connections)
  // can produce and would falsely trigger a mid-form reload.
  return (
    name === "ChunkLoadError" ||
    /Loading chunk \S+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

function readSentinel(): number | null {
  try {
    const raw = sessionStorage.getItem(SENTINEL_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function writeSentinel(ts: number): void {
  try { sessionStorage.setItem(SENTINEL_KEY, String(ts)); } catch {}
}

function clearSentinel(): void {
  try { sessionStorage.removeItem(SENTINEL_KEY); } catch {}
}

// Returns true if a reload was scheduled. Returns false if we recently tried
// to reload for the same reason and it didn't help — caller should fall
// through to the error UI in that case.
export function tryRecoverFromStaleChunk(
  deps: { reload?: () => void; sw?: Parameters<typeof reloadOntoFreshShell>[1] } = {},
): boolean {
  // If the user is mid-signup on the root route (where CreateAccountFlow
  // lives), never silently reload — the form lives entirely in component
  // state below the persistence layer for the current step, and a reload
  // would still be jarring even with the draft restore. Let the error UI
  // surface so the user makes the call themselves with a Reload button.
  // Scoping to the root path means a stale draft left behind from an
  // earlier session can't suppress legitimate stale-chunk recovery on
  // unrelated routes.
  try {
    const onSignupRoute =
      typeof window !== "undefined" && window.location?.pathname === "/";
    if (onSignupRoute && hasSignupDraft()) return false;
  } catch {}

  const last = readSentinel();
  const now = Date.now();
  if (last !== null && now - last < SENTINEL_TTL_MS) {
    // We already reloaded once recently and the chunk still won't load.
    // Don't spin — let the error boundary surface the failure.
    return false;
  }
  writeSentinel(now);
  // Onto the FRESH page, the way the update pill restarts. The service worker
  // answers navigations from the cached page shell for a day
  // (client/public/sw.js, open-from-cache), so a plain reload came back on the
  // same stale shell: the chunk failed again, the sentinel refused a second
  // reload, and the door stayed blank until "Repair app" (reported 2026-09-30,
  // iOS PWA: Discover → Feed, the first lazy chunk opened after a deploy).
  // reloadOntoFreshShell asks the worker to fetch and keep the fresh page
  // first, and still reloads when the worker is silent or absent.
  const reload = deps.reload ?? (() => { try { window.location.reload(); } catch {} });
  // Defer slightly so any in-flight UI can settle and any console logging
  // has a chance to flush before we tear the page down.
  setTimeout(() => { void reloadOntoFreshShell(reload, deps.sw); }, 50);
  return true;
}

// Call this once after the app has successfully booted (i.e. React rendered
// without crashing). It clears the sentinel so future stale-chunk events
// can recover via reload again.
export function clearStaleChunkSentinel(): void {
  clearSentinel();
}
