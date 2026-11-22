/**
 * NIP-98 (kind 27235) HTTP auth: the pubkey proven by a signed token in the
 * Authorization header, bound to this request's method and path and fresh
 * within a minute. Moved from routes.ts (the schedule endpoints) so other
 * routes share it.
 */
import { verifyEvent } from "nostr-tools";

const MAX_AGE_SECONDS = 60; // seconds of created_at skew tolerated

/** This site's own origins (ALLOWED_ORIGINS, e.g. "https://relayop.xyz"); empty on a laptop. */
function siteOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
}

/**
 * Whether a token's URL is for this site. With origins configured (production)
 * it must be one of them, scheme and port included; without (a laptop) its
 * host must be the one the request came to. A token signed for another site
 * with the same paths (another copy of this server, a custom scheduler) must
 * not work here.
 */
function isThisSite(tokenUrl: URL, req: any, origins: string[]): boolean {
  if (origins.length > 0) {
    return origins.some((o) => {
      try { return new URL(o).origin.toLowerCase() === tokenUrl.origin.toLowerCase(); } catch { return false; }
    });
  }
  const host = String(req.headers?.host ?? "").toLowerCase();
  return !!host && tokenUrl.host.toLowerCase() === host;
}

export function verifyNip98(req: any, opts: { origins?: string[] } = {}): { pubkey: string } | { status: number; error: string } {
  const header: string | undefined = req.headers["authorization"];
  if (!header || !header.startsWith("Nostr ")) {
    return { status: 401, error: "Missing NIP-98 Authorization header" };
  }

  let event: any;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    event = JSON.parse(decoded);
  } catch {
    return { status: 401, error: "Malformed Authorization token" };
  }

  if (!event || event.kind !== 27235 || typeof event.pubkey !== "string") {
    return { status: 401, error: "Invalid auth event" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof event.created_at !== "number" || Math.abs(now - event.created_at) > MAX_AGE_SECONDS) {
    return { status: 401, error: "Auth token expired" };
  }

  const tags: string[][] = Array.isArray(event.tags) ? event.tags : [];
  const uTag = tags.find((t) => t[0] === "u")?.[1];
  const methodTag = tags.find((t) => t[0] === "method")?.[1];
  if (!uTag || !methodTag) {
    return { status: 401, error: "Auth token missing u/method tag" };
  }
  if (methodTag.toUpperCase() !== String(req.method).toUpperCase()) {
    return { status: 401, error: "Auth method mismatch" };
  }

  // Bind the token to this site and this endpoint's path (the query string
  // is not compared).
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(uTag);
  } catch {
    return { status: 401, error: "Invalid u tag" };
  }
  if (!isThisSite(tokenUrl, req, opts.origins ?? siteOrigins()) || tokenUrl.pathname !== req.path) {
    return { status: 401, error: "Auth URL mismatch" };
  }

  let valid = false;
  try {
    valid = verifyEvent(event);
  } catch {
    valid = false;
  }
  if (!valid) {
    return { status: 401, error: "Invalid auth signature" };
  }

  return { pubkey: event.pubkey };
}
