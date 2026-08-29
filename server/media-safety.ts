/**
 * Content-Type safety for the media proxies.
 *
 * Both `/api/stream/proxy` and `/api/rss/image-proxy` fetch an arbitrary remote
 * URL and stream it back FROM OUR OWN ORIGIN. If they echo the upstream
 * `Content-Type` verbatim, an attacker host can serve `text/html` (or
 * `image/svg+xml`, which executes script on top-level navigation) and get it
 * rendered on relayop.xyz — a same-origin XSS that can read the plaintext key in
 * localStorage. These helpers decide what Content-Type we are willing to emit so
 * a proxied response can never run as a document on our origin.
 */

// Real media a stream proxy legitimately serves. Anything renderable/executable
// in a top-level navigation (text/html, image/svg+xml, application/xhtml+xml,
// xml) is deliberately absent.
const STREAM_MEDIA_RE = /^(video|audio)\//;
const STREAM_EXTRA = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/mp4",
  "application/octet-stream", // many HLS .ts segments arrive as this
]);

/**
 * What Content-Type the stream proxy should emit for an upstream type.
 * Media types pass through unchanged; everything else is coerced to an opaque
 * attachment download so it can never render as a document. Callers must also
 * send `X-Content-Type-Options: nosniff`.
 */
export function safeStreamContentType(
  upstream: string | null | undefined,
): { contentType: string; attachment: boolean } {
  const raw = (upstream || "").trim();
  const base = raw.split(";")[0].trim().toLowerCase();
  if (STREAM_MEDIA_RE.test(base) || STREAM_EXTRA.has(base)) {
    return { contentType: raw, attachment: false };
  }
  return { contentType: "application/octet-stream", attachment: true };
}

// The image proxy serves inline <img> content only, so a strict raster allowlist
// is safe. SVG is intentionally excluded — it can carry script.
const IMAGE_ALLOW = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/**
 * The allowlisted raster Content-Type for the image proxy, or null when the
 * upstream type is not a safe raster image (including SVG and anything
 * HTML-ish) — in which case the caller must refuse (415), never echo it.
 */
export function safeImageContentType(upstream: string | null | undefined): string | null {
  const base = (upstream || "").split(";")[0].trim().toLowerCase();
  return IMAGE_ALLOW.has(base) ? base : null;
}
