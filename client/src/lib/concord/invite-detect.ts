/**
 * Pure detection of Concord group-chat invite links (CORD-05) — host-agnostic,
 * so an invite minted by ANOTHER Concord client (`https://armada.buzz/invite/
 * naddr1…#secret`) is recognized and joined HERE instead of bouncing the user
 * to the foreign site. Kept dependency-light (nip19 + one kind constant) so
 * feed/DM renderers and the paste faucets can import it without dragging the
 * Concord I/O layer (IDB, gift-wrap, outbox) into their bundles.
 *
 * SECURITY: input is untrusted (pasted, scanned, or found in post/DM text).
 * We only ever PARSE it — the produced `path` is an internal `/invite/…` route
 * and the `#fragment` (the invite secret) stays client-side; it must never be
 * sent anywhere except our own accept flow, which already reads it from
 * `window.location.hash` without shipping it to a server.
 */
import { nip19 } from "nostr-tools";
import { KIND_INVITE_BUNDLE } from "./concord-events";

/**
 * Lenient shape parse: any host's `/invite/<naddr>` path (fragment optional),
 * or a bare `naddr…#fragment`. Does NOT validate the naddr — callers that act
 * on untrusted input should go through `detectGroupInvite` below.
 */
export function parseInviteUrl(url: string): { naddr: string; fragment: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/invite\/(naddr1[0-9a-z]+)/i);
    if (!m) return null;
    return { naddr: m[1], fragment: u.hash.replace(/^#/, "") };
  } catch {
    // Allow bare "naddr…#fragment" too.
    const m = url.match(/(naddr1[0-9a-z]+)#(.+)$/i);
    return m ? { naddr: m[1], fragment: m[2] } : null;
  }
}

export interface GroupInviteTarget {
  /** Normalized (lowercase) invite-bundle naddr. */
  naddr: string;
  /** Invite secret from the URL fragment ("" if the link was shared without it). */
  fragment: string;
  /** Origin host for honest display ("armada.buzz"); null for a bare naddr. */
  host: string | null;
  /** Internal accept route (`/invite/<naddr>#<fragment>`), secret preserved. */
  path: string;
}

/**
 * Strict detection for untrusted input: the shape must parse AND the naddr
 * must bech32-decode to a kind-33301 invite-bundle coordinate. Returns the
 * internal route to our accept screen (which runs the explicit confirm/join
 * flow — detection never auto-joins anything).
 */
export function detectGroupInvite(raw: string): GroupInviteTarget | null {
  const value = raw.trim().replace(/^nostr:/i, "");
  if (!value) return null;
  const parsed = parseInviteUrl(value);
  if (!parsed) return null;

  const naddr = parsed.naddr.toLowerCase();
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== "naddr" || decoded.data.kind !== KIND_INVITE_BUNDLE) return null;
  } catch {
    return null;
  }

  let host: string | null = null;
  try {
    host = new URL(value).hostname.replace(/^www\./, "") || null;
  } catch {
    host = null; // bare naddr#fragment — no origin to show
  }

  return {
    naddr,
    fragment: parsed.fragment,
    host,
    path: `/invite/${naddr}${parsed.fragment ? `#${parsed.fragment}` : ""}`,
  };
}
