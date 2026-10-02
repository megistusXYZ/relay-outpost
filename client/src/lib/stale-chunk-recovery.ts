// Recovery when a page's code can't be loaded.
//
// Vite emits content-hashed chunk filenames (Home-aBc12.js), and a deploy that
// changes the app renames nearly all of them (165 of 242, measured). A running page — or a launch the service worker
// answered from its kept page — still names the old files, so the first visit
// to a page it hasn't opened yet asks for a chunk that is gone.
//
// The recovery is a ladder, one rung per failure, and it always ends:
//
//   1. fresh page   reload onto the newest build (the worker fetches and keeps
//                   the fresh page first). The ordinary case: a deploy happened.
//   2. repair       the chunk failed AGAIN on the fresh page, so what the
//                   device holds is wrong (a bad answer kept by the worker, a
//                   page it could not replace, storage it could not write).
//                   Do what Settings › "Repair app" does — drop the worker and
//                   its caches — and reload from the network. Logins are kept.
//   3. give up      the caller shows the error screen, whose button repairs
//                   again. No more automatic reloads for a while.
//
// Before 2026-10-01 there was one rung and a 30 s "already tried" mark that
// ANY other chunk loading cleared. Every boot loads several chunks, so the
// mark was always cleared, and a chunk that kept failing reloaded the app
// forever: a blank Feed page that only "Repair app" brought back (measured:
// 7 page loads in 20 s, real iOS Safari and Chromium). The rungs are counted
// by time alone now, and the second one is the repair people were doing by
// hand.

import { hasSignupDraft } from "@/lib/account-draft";
import { dropWorkerAndCaches, reloadOntoFreshShell } from "@/lib/sw-shell";

const STATE_KEY = "relay-outpost-chunk-recovery";
/** Failures this close together are the same problem: climb, don't restart. */
export const RECOVERY_WINDOW_MS = 2 * 60 * 1000;

export type RecoveryStep = "fresh-page" | "repair" | "give-up";

/** The rung for the next failure, given how many were climbed and when. Pure. */
export function nextRecoveryStep(last: { attempts: number; at: number } | null, now: number): RecoveryStep {
  const attempts = last && now - last.at < RECOVERY_WINDOW_MS ? last.attempts : 0;
  if (attempts === 0) return "fresh-page";
  if (attempts === 1) return "repair";
  return "give-up";
}

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
    /is not a valid JavaScript MIME type/i.test(message) ||
    /Unable to preload CSS/i.test(message)
  );
}

function readState(): { attempts: number; at: number } | null {
  try {
    const [attempts, at] = (sessionStorage.getItem(STATE_KEY) || "").split(":").map(Number);
    return Number.isFinite(attempts) && Number.isFinite(at) && at > 0 ? { attempts, at } : null;
  } catch {
    return null;
  }
}

/** True when the mark was really written: without it a reload cannot be counted. */
function writeState(attempts: number, at: number): boolean {
  try {
    sessionStorage.setItem(STATE_KEY, `${attempts}:${at}`);
    return sessionStorage.getItem(STATE_KEY) === `${attempts}:${at}`;
  } catch {
    return false;
  }
}

/** One recovery per page load: the page is already on its way out. */
let underway = false;

// Returns true if a reload was scheduled. Returns false when the ladder is
// spent (or can't be counted) — the caller falls through to the error screen.
export function tryRecoverFromStaleChunk(
  deps: {
    reload?: () => void;
    sw?: Parameters<typeof reloadOntoFreshShell>[1];
    repair?: () => Promise<void>;
  } = {},
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

  // Several chunks fail together (a page and everything it imports), and
  // Vite's preload error arrives beside the import's own: one rung for all.
  if (underway) return true;

  const now = Date.now();
  const last = readState();
  const step = nextRecoveryStep(last, now);
  if (step === "give-up") return false;
  // A reload that can't be counted could repeat forever: don't start one.
  if (!writeState(step === "fresh-page" ? 1 : 2, now)) return false;
  underway = true;

  const reload = deps.reload ?? (() => { try { window.location.reload(); } catch {} });
  // Defer slightly so any in-flight UI can settle and any console logging
  // has a chance to flush before we tear the page down.
  setTimeout(() => {
    if (step === "fresh-page") {
      // The worker answers launches from its kept page, so a plain reload came
      // back on the same build. reloadOntoFreshShell has it fetch and keep the
      // fresh page first, and still reloads when the worker is silent or absent.
      void reloadOntoFreshShell(reload, deps.sw);
    } else {
      void (deps.repair ?? dropWorkerAndCaches)().then(reload, reload);
    }
  }, 50);
  return true;
}

/** Start the ladder over. For tests, and for a deliberate "try again". */
export function resetChunkRecovery(): void {
  underway = false;
  try { sessionStorage.removeItem(STATE_KEY); } catch {}
}
