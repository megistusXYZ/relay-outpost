import { safeFetch, readBodyCapped } from "./safe-fetch";
import { rasterImageKind } from "./image-sniff";

/**
 * Fetch a picture someone else chose, for decoding on this server. Goes through
 * safeFetch (every hop checked, connection pinned), reads at most maxBytes, and
 * only returns bytes that really are a raster image. Null on any failure.
 */
export async function fetchRemoteRaster(url: string, maxBytes: number, timeoutMs: number): Promise<Buffer | null> {
  try {
    const resp = await safeFetch(url, { timeoutMs, headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" } });
    if (!resp.ok) {
      try { await resp.body?.cancel(); } catch { /* ignore */ }
      return null;
    }
    const buf = await readBodyCapped(resp, maxBytes);
    if (!buf || buf.length === 0) return null;
    return rasterImageKind(buf) ? buf : null;
  } catch {
    return null;
  }
}

/** Decoder settings for pictures from elsewhere: a pixel ceiling so a tiny file
 *  that claims enormous dimensions can't exhaust memory. */
export const REMOTE_IMAGE_DECODE = { limitInputPixels: 40_000_000 } as const;
