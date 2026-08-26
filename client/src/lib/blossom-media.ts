/**
 * Blossom media-resilience helpers (BUD-01/BUD-04 + NIP-92).
 *
 * Pure, dependency-light machinery shared by the upload path (media-upload.ts),
 * the composer (imeta assembly), and — later — a bulk re-sync flow. Kept out of
 * media-upload.ts so it stays unit-testable without dragging in the relay pool.
 */

import { signWithTimeout } from "@/lib/signer-timeout";

export interface BlossomSignerLike {
  signEvent: (event: any) => Promise<any>;
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

/** nostr.build is NIP-96 (not Blossom): never a mirror target or `{server}/{sha256}` candidate. */
function isNostrBuildServer(serverUrl: string): boolean {
  try {
    const host = new URL(serverUrl).hostname.toLowerCase();
    return host === "nostr.build" || host.endsWith(".nostr.build");
  } catch {
    return false;
  }
}

function serverOrigin(serverUrl: string): string | null {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return null;
  }
}

function trimSlashes(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

/**
 * Kind-24242 Blossom authorization header (BUD-02/BUD-04). PUT maps to
 * t=upload — the same auth type BUD-04 requires for /mirror requests.
 */
export async function createBlossomAuthHeader(
  url: string,
  method: string,
  fileHash: string,
  signer?: BlossomSignerLike | null,
): Promise<string | null> {
  if (!signer) return null;
  try {
    const authEvent = {
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["t", method.toLowerCase() === "put" ? "upload" : method.toLowerCase()],
        ["x", fileHash],
        ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
      ],
      content: "Upload via Relay Outpost",
    };
    // signWithTimeout's ISigner is wider than the minimal signEvent-only shape
    // upload call sites pass around (same pattern as concord-media.ts).
    const signed = await signWithTimeout(signer as never, authEvent);
    return "Nostr " + btoa(JSON.stringify(signed));
  } catch {
    return null;
  }
}

/**
 * Extract a Blossom-style sha256 from a URL path. Blossom blobs live at
 * `/{sha256}` or `/{sha256}.ext`, and nostr.build filenames are also the
 * processed file's hash — so a 64-hex path segment IS the content fingerprint.
 * Scans segments right-to-left (the blob segment is last in practice).
 */
export function extractSha256FromUrl(url: string): { sha256: string; ext: string } | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = segments[i].match(/^([0-9a-fA-F]{64})(\.[A-Za-z0-9]{1,8})?$/);
    if (match) {
      return { sha256: match[1].toLowerCase(), ext: match[2] ?? "" };
    }
  }
  return null;
}

export interface MirrorResult {
  ok: boolean;
  /** Public URL of the mirrored blob on the target server (when ok). */
  url?: string;
  server?: string;
  status?: number;
}

/**
 * BUD-04: ask `targetServer` to pull the blob at `sourceUrl` into its own
 * store (PUT {server}/mirror with a JSON `{"url": ...}` body and a kind-24242
 * t=upload auth whose `x` is the blob's sha256).
 *
 * Soft-failure contract: NEVER throws — network errors, non-2xx responses and
 * unsupported servers all resolve `{ ok: false }` so callers can fire-and-forget.
 */
export async function mirrorBlob(
  sourceUrl: string,
  sha256: string,
  targetServer: string,
  signer?: BlossomSignerLike | null,
): Promise<MirrorResult> {
  try {
    if (!SHA256_HEX.test(sha256)) return { ok: false, server: targetServer };
    const base = trimSlashes(targetServer);
    const mirrorUrl = `${base}/mirror`;
    const authHeader = await createBlossomAuthHeader(mirrorUrl, "PUT", sha256.toLowerCase(), signer);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;

    const response = await fetch(mirrorUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ url: sourceUrl }),
    });
    if (!response.ok) return { ok: false, server: base, status: response.status };

    const data = await response.json().catch(() => null);
    const ext = extractSha256FromUrl(sourceUrl)?.ext ?? "";
    const url =
      data && typeof data.url === "string" && data.url
        ? data.url
        : `${base}/${sha256.toLowerCase()}${ext}`;
    return { ok: true, server: base, url, status: response.status };
  } catch {
    return { ok: false, server: targetServer };
  }
}

/**
 * Choose the auto-mirror target: the first server in the user's Blossom list
 * that is neither the origin the blob was uploaded to nor nostr.build (NIP-96).
 * Returns null when the list has no eligible second home for the blob.
 */
export function pickMirrorTarget(originUrl: string, servers: string[]): string | null {
  const origin = serverOrigin(originUrl);
  for (const raw of servers) {
    const server = trimSlashes(raw);
    if (!server) continue;
    if (isNostrBuildServer(server)) continue;
    const candidateOrigin = serverOrigin(server);
    if (!candidateOrigin) continue;
    if (origin && candidateOrigin === origin) continue;
    return server;
  }
  return null;
}

/** Read-side retry bound: at most this many alternates are tried per media. */
export const MAX_BLOSSOM_ALTERNATES = 3;

export interface BlossomAlternatesOptions {
  /** Explicit fingerprint from the event's imeta `x` field (wins over the URL). */
  sha256?: string;
  /** Explicit mirror URLs from the event's imeta `fallback` fields. */
  fallbacks?: string[];
  /** Blossom servers to derive `{server}/{sha256}` candidates from. */
  servers: string[];
}

/**
 * Ordered alternate URLs for a media file whose primary URL failed.
 *
 * The fingerprint comes from the imeta `x` value or from the URL path itself
 * (Blossom blobs live at `/{sha256}(.ext)?`). Explicit imeta fallbacks come
 * first (the author vouched for them), then `{server}/{sha256}{ext}` for each
 * given Blossom server. Candidates on the failed URL's origin are excluded
 * (that server already failed to produce the blob), nostr.build is never a
 * constructed candidate (NIP-96, not content-addressed at its root), and the
 * list is deduped. With no derivable hash only the explicit fallbacks remain —
 * a non-Blossom URL with no `x` and no fallbacks yields [].
 */
export function blossomAlternates(url: string, opts: BlossomAlternatesOptions): string[] {
  const failedOrigin = serverOrigin(url);

  let sha256: string | null =
    opts.sha256 && SHA256_HEX.test(opts.sha256) ? opts.sha256.toLowerCase() : null;
  const fromUrl = extractSha256FromUrl(url);
  if (!sha256 && fromUrl) sha256 = fromUrl.sha256;

  // Preserve the extension so alternates keep their content-type hint: from
  // the URL's hash segment when present, else from the URL's final segment
  // (covers imeta-x on conventionally named files like /photos/cat.jpg).
  let ext = fromUrl?.ext ?? "";
  if (!ext) {
    try {
      const lastSegment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      const match = lastSegment.match(/(\.[A-Za-z0-9]{1,8})$/);
      if (match) ext = match[1];
    } catch {}
  }

  const seen = new Set<string>([url]);
  const alternates: string[] = [];
  const push = (candidate: string) => {
    if (!candidate || seen.has(candidate)) return;
    if (failedOrigin && serverOrigin(candidate) === failedOrigin) return;
    seen.add(candidate);
    alternates.push(candidate);
  };

  for (const fallback of opts.fallbacks ?? []) push(fallback.trim());

  if (sha256) {
    for (const raw of opts.servers) {
      const server = trimSlashes(raw);
      if (!server || isNostrBuildServer(server) || !serverOrigin(server)) continue;
      push(`${server}/${sha256}${ext}`);
    }
  }

  return alternates;
}

/**
 * Session-scoped memory of media URLs that already failed to load, shared by
 * every renderer: a dead blob must never retrigger its retry chain across
 * re-renders or later feed passes. Each URL is tried at most once per session.
 */
const deadMediaUrls = new Set<string>();

export function markMediaUrlDead(url: string): void {
  if (url) deadMediaUrls.add(url);
}

export function isMediaUrlDead(url: string): boolean {
  return deadMediaUrls.has(url);
}

/** Test-only: clear the session dead-URL cache. */
export function resetDeadMediaUrls(): void {
  deadMediaUrls.clear();
}

/**
 * Assemble a NIP-92 `imeta` tag (space-separated key/value strings in one tag):
 * `["imeta", "url <url>", "m <mime>", "dim <WxH>", "x <sha256>", "fallback <url>", ...]`.
 * Returns null when there's no valid sha256 — the fingerprint is the point;
 * uploads without one (legacy drafts) keep today's tag-less behavior.
 */
export function buildImetaTag(parts: {
  url: string;
  mime?: string;
  sha256?: string;
  /** Pixel dimensions as `WxH` (NIP-94 `dim`); anything else is dropped. */
  dim?: string;
  fallbacks?: string[];
}): string[] | null {
  if (!parts.url || !parts.sha256 || !SHA256_HEX.test(parts.sha256)) return null;
  const tag = ["imeta", `url ${parts.url}`];
  if (parts.mime) tag.push(`m ${parts.mime}`);
  if (parts.dim && /^[1-9]\d*x[1-9]\d*$/.test(parts.dim)) tag.push(`dim ${parts.dim}`);
  tag.push(`x ${parts.sha256.toLowerCase()}`);
  for (const fallback of parts.fallbacks ?? []) {
    if (fallback && fallback !== parts.url) tag.push(`fallback ${fallback}`);
  }
  return tag;
}
