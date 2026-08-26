// Resilient dynamic-import wrapper for EVERY React.lazy site in the app.
//
// Since the #323 code-split, the bundle is served as many content-hashed lazy
// chunks. A dynamic import can fail mid-session for two reasons:
//   1. Transient network blip (mobile dropping packets) — a short retry
//      sequence cheaply recovers it.
//   2. Stale deploy — the running tab references old chunk URLs that no longer
//      exist on the server. No amount of retrying helps; the only fix is a
//      full reload to pick up the new index.html (one-shot, sentinel-guarded
//      in stale-chunk-recovery so it can never loop).
//
// Without this wrapper a single failed chunk rejects the lazy component's
// promise and the error propagates up React's tree, unmounting whatever
// boundary-less surface it lands in (historically: the whole app shell).
// ALWAYS wrap lazy imports: `lazy(() => lazyRetry(() => import("./X")))`.

import {
  clearStaleChunkSentinel,
  isChunkLoadError,
  tryRecoverFromStaleChunk,
} from "@/lib/stale-chunk-recovery";

/**
 * Resilient lazy loader for a NAMED export (`lazy(() => lazyNamed(() =>
 * import("./X"), "X"))`). Wraps {@link lazyRetry} and — critically — guards
 * against the resolved module namespace, or the named export, coming back
 * nullish.
 *
 * WHY (real crash, 2026-07, iOS 18.7 Safari, landing route): some WebKit builds
 * FULFILL a failed/stale dynamic import() with `undefined` instead of rejecting.
 * The old `import(...).then(m => ({ default: m.GalaxyWarpOverlay }))` then did a
 * property access on that `undefined`, throwing a raw TypeError ("undefined is
 * not an object (evaluating 'm.GalaxyWarpOverlay')") that isChunkLoadError can't
 * classify — so the one-shot stale-chunk reload never fired and the error
 * escaped to the crash boundary, breaking the first-paint landing for that user.
 *
 * Here we detect the nullish module/export and throw a `ChunkLoadError` (which
 * isChunkLoadError recognizes by name), so lazyRetry retries and then reloads to
 * pick up the fresh index.html — the correct recovery for a stale chunk.
 */
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
): Promise<{ default: M[K] }> {
  return lazyRetry(() => loader().then((m) => pickNamedExport(m, name)));
}

/**
 * Turn a loaded module namespace into React.lazy's `{ default }` shape for a
 * named export, throwing a `ChunkLoadError` (not a raw TypeError) when the
 * module OR the export is nullish — the iOS-Safari-fulfills-with-undefined case
 * above. Extracted + exported so the guard is unit-testable without lazyRetry's
 * retry timers.
 */
export function pickNamedExport<M extends Record<string, unknown>, K extends keyof M>(
  m: M | undefined | null,
  name: K,
): { default: M[K] } {
  if (m == null || m[name] == null) {
    throw chunkLoadError(`Lazy chunk resolved without export "${String(name)}" (stale/half-loaded chunk)`);
  }
  return { default: m[name] as M[K] };
}

/** A ChunkLoadError-named Error — the shape isChunkLoadError recognizes, so the
 *  retry + one-shot stale-chunk reload path treats it as a missing chunk. */
function chunkLoadError(message: string): Error {
  const err = new Error(message);
  err.name = "ChunkLoadError";
  return err;
}

export function lazyRetry<T extends { default: any }>(
  importFn: () => Promise<T>,
  retries = 3,
  interval = 1500
): Promise<T> {
  return importFn()
    // Validate BEFORE the handler pair below so a bad module is routed into the
    // retry/reload path (a throw inside an onFulfilled handler does NOT reach
    // that same .then's onRejected).
    //
    // WHY (real crash, 2026-07, iOS 18.7 Safari, /help): WebKit can FULFILL a
    // failed/stale dynamic import() with `undefined`. React.lazy then stores it
    // and reads `.default` off it, throwing a raw TypeError ("undefined is not
    // an object (evaluating 'x._result.default')") that isChunkLoadError can't
    // classify — so the one-shot stale-chunk reload never fired and the error
    // escaped to the crash boundary. pickNamedExport already guarded the NAMED
    // export sites; this covers the default-export ones (the majority).
    .then((mod) => {
      if (mod == null || (mod as { default?: unknown }).default == null) {
        throw chunkLoadError("Lazy chunk resolved without a default export (stale/half-loaded chunk)");
      }
      return mod;
    })
    .then(
    (mod) => {
      // A lazy chunk actually loaded — proof that the current bundle's chunk
      // URLs still exist on the server. Safe to clear any prior reload
      // sentinel so future deploys can recover via reload again.
      clearStaleChunkSentinel();
      return mod;
    },
    (err) => {
      if (retries > 0) {
        // Always retry first — the same signatures fire for transient network
        // blips (mobile dropping packets, etc.) as for genuinely-missing chunks
        // after a deploy. A short retry sequence cheaply recovers the former.
        return new Promise<T>((resolve) =>
          setTimeout(() => resolve(lazyRetry(importFn, retries - 1, interval)), interval)
        );
      }
      // Retries exhausted. If this looks like a stale-chunk error (the file we
      // want truly no longer exists at the URL the bundle is asking for), do a
      // one-shot full reload to pick up the new index.html. The sentinel in
      // tryRecoverFromStaleChunk prevents this from looping.
      if (isChunkLoadError(err)) {
        const reloading = tryRecoverFromStaleChunk();
        if (reloading) {
          // Page is about to reload — never resolve.
          return new Promise<T>(() => {});
        }
      }
      throw err;
    }
  );
}
