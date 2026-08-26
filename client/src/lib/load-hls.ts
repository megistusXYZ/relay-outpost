import type Hls from "hls.js";

/**
 * Shared lazy loader for hls.js (~1.3MB raw / ~294KB gzip — by far the
 * heaviest dependency in the client). Nothing on the first-paint path needs
 * it, so every consumer loads it on demand through this helper; the module
 * then lives in its own async chunk fetched only when HLS playback actually
 * starts (video PiP, live mini-player, lightbox, profile media, streams).
 *
 * The promise is cached so concurrent callers share one network request and
 * later callers resolve instantly.
 */
export type HlsConstructor = typeof Hls;

let hlsPromise: Promise<HlsConstructor> | null = null;

export function loadHls(): Promise<HlsConstructor> {
  if (!hlsPromise) {
    hlsPromise = import("hls.js").then((m) => m.default);
    // Allow a retry on transient network failure instead of caching rejection.
    hlsPromise.catch(() => {
      hlsPromise = null;
    });
  }
  return hlsPromise;
}
