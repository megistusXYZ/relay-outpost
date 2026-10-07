/**
 * NIP-98 (kind 27235) HTTP auth: the pubkey proven by a signed token in the
 * Authorization header, bound to this request's method and path and fresh
 * within a minute. Moved from routes.ts (the schedule endpoints) so other
 * routes share it.
 */
import { verifyEvent } from "nostr-tools";

const MAX_AGE_SECONDS = 60; // seconds of created_at skew tolerated

export function verifyNip98(req: any): { pubkey: string } | { status: number; error: string } {
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

  // Bind the token to this endpoint by path; compare pathname only so the
  // proxy host and query string don't cause spurious mismatches.
  let tokenPath: string;
  try {
    tokenPath = new URL(uTag).pathname;
  } catch {
    return { status: 401, error: "Invalid u tag" };
  }
  if (tokenPath !== req.path) {
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
