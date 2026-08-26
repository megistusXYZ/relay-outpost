/**
 * Classify a scanned QR value into a navigation target. Pure + unit-tested.
 *
 * Scanned content is UNTRUSTED: only two shapes auto-navigate, and both stay
 * inside the app —
 *   1. an invite URL (`https://<any-host>/invite/naddr1…#frag` — ours OR one
 *      minted by another Concord client, e.g. armada.buzz) or a bare naddr
 *      (optionally `naddr…#frag`) → the internal /invite route. Foreign hosts
 *      never get navigated to: we extract the naddr + secret fragment and open
 *      OUR accept flow, so the fragment stays client-side;
 *   2. an npub / nprofile (bare or `nostr:`-prefixed) → the internal profile
 *      route.
 * Everything else (foreign URLs, lightning invoices, plain text…) is returned
 * as `other` so the UI can show the raw value behind an explicit Open/Copy
 * confirm — never navigate to arbitrary scanned URLs automatically.
 */
import { nip19 } from "nostr-tools";

export type ScanTarget =
  | { kind: "invite"; path: string }
  | { kind: "profile"; path: string }
  /** `url` is set only when the value is a well-formed http(s) URL. */
  | { kind: "other"; value: string; url: string | null };

/** Strict bech32 charset for the data part (bech32 is case-insensitive). */
const BECH32 = /^[a-z0-9]+$/i;

function decodeAs(expected: "npub" | "nprofile" | "naddr", candidate: string): ReturnType<typeof nip19.decode> | null {
  try {
    const decoded = nip19.decode(candidate.toLowerCase());
    return decoded.type === expected ? decoded : null;
  } catch {
    return null;
  }
}

export function classifyScannedValue(raw: string, currentOrigin: string): ScanTarget {
  const value = raw.trim();
  const other = (url: string | null = null): ScanTarget => ({ kind: "other", value, url });
  if (!value) return other();

  // Bech32 candidates, with or without a nostr: scheme.
  const bare = value.replace(/^nostr:/i, "");

  // naddr — a Concord invite QR may encode just "naddr…#fragment".
  const naddrMatch = bare.match(/^(naddr1[a-z0-9]+)(#(.+))?$/i);
  if (naddrMatch && decodeAs("naddr", naddrMatch[1])) {
    const frag = naddrMatch[3];
    return { kind: "invite", path: `/invite/${naddrMatch[1].toLowerCase()}${frag ? `#${frag}` : ""}` };
  }

  // npub / nprofile → profile route (normalized to npub).
  if (/^npub1/i.test(bare) && BECH32.test(bare) && decodeAs("npub", bare)) {
    return { kind: "profile", path: `/profile/${bare.toLowerCase()}` };
  }
  if (/^nprofile1/i.test(bare) && BECH32.test(bare)) {
    const decoded = decodeAs("nprofile", bare);
    if (decoded && decoded.type === "nprofile") {
      try {
        return { kind: "profile", path: `/profile/${nip19.npubEncode(decoded.data.pubkey)}` };
      } catch {
        return other();
      }
    }
  }

  // URLs: only /invite/… links auto-navigate, and always INTERNALLY. A
  // same-origin link is taken as-is (pathname+search+hash preserved — the
  // fragment holds the invite secret). A FOREIGN-host /invite/naddr link
  // (another Concord client, e.g. armada.buzz) is re-rooted onto our own
  // /invite route: naddr + fragment only, never the foreign origin. Any other
  // http(s) URL is untrusted → confirm.
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return other();
    const sameOrigin = url.origin === new URL(currentOrigin).origin;
    if (sameOrigin && /^\/invite\/naddr1[a-z0-9]+$/i.test(url.pathname)) {
      return { kind: "invite", path: `${url.pathname}${url.search}${url.hash}` };
    }
    const foreign = url.pathname.match(/^\/invite\/(naddr1[a-z0-9]+)\/?$/i);
    if (foreign && decodeAs("naddr", foreign[1])) {
      return { kind: "invite", path: `/invite/${foreign[1].toLowerCase()}${url.hash}` };
    }
    return other(url.href);
  } catch {
    return other();
  }
}
