/**
 * Turn plain links to Nostr web clients (njump, nostrudel, coracle, primal, …)
 * into the `nostr:<bech32>` reference they actually point at.
 *
 * WHY: when someone pastes `https://nostrudel.ninja/#/n/nevent1…` (or an njump
 * link) into a post, it otherwise renders as a generic, ugly link-preview card
 * that tells the reader nothing. But the URL *is* a nostr entity — so we rewrite
 * it to `nostr:nevent1…` and let the normal reference pipeline resolve it into a
 * real embedded-note card (author + text + media). Profile links (npub/nprofile)
 * become `@mentions` the same way.
 *
 * Design: host-agnostic on purpose. Rather than chase an ever-growing allowlist
 * of clients, we extract a bech32 entity from ANY http(s) URL's path or hash and
 * accept it ONLY if `nip19.decode` succeeds — bech32 carries a checksum, so a
 * random path segment decoding to a valid nostr entity is astronomically
 * unlikely. That means new clients "just work" without a code change.
 */
import { nip19 } from "nostr-tools";

// The nostr entity kinds we lift out of URLs. note/nevent/naddr become embedded
// cards; npub/nprofile become @mentions — all via the existing renderer.
const ENTITY_RE = /(nevent1|note1|naddr1|nprofile1|npub1)[023456789acdefghjklmnpqrstuvwxyz]+/i;

/**
 * Given an http(s) URL, return the `nostr:<bech32>` reference it points at, or
 * null if it isn't a nostr-entity link. Only the path and hash are searched (the
 * host/query are ignored) and the entity must decode cleanly.
 */
export function nostrRefFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  // Search path + hash. njump uses `/<bech32>`; nostrudel/coracle/snort use a
  // `#/…/<bech32>` hash route; primal uses `/e/<bech32>`. Scanning both covers
  // all of them without special-casing each client.
  const haystack = `${parsed.pathname}${parsed.hash}`;
  const m = haystack.match(ENTITY_RE);
  if (!m) return null;

  const candidate = m[0].toLowerCase();
  try {
    const decoded = nip19.decode(candidate);
    if (
      decoded.type === "note" ||
      decoded.type === "nevent" ||
      decoded.type === "naddr" ||
      decoded.type === "npub" ||
      decoded.type === "nprofile"
    ) {
      return `nostr:${candidate}`;
    }
  } catch {
    // Not a real bech32 entity (checksum/charset) — leave the URL untouched.
  }
  return null;
}

// http(s) URL token matcher — mirrors the one media extraction uses, so we
// normalize BEFORE media/reference parsing runs on the content.
const URL_TOKEN_RE = /(https?:\/\/[^\s<>"]+)/g;

/**
 * Rewrite every Nostr-web-client link in `content` to its `nostr:<bech32>` form.
 * Non-nostr links (and everything else) are left exactly as-is. Trailing
 * sentence punctuation on a URL is preserved (only the link itself is swapped).
 */
export function normalizeNostrClientLinks(content: string): string {
  if (!content || content.indexOf("http") === -1) return content;
  return content.replace(URL_TOKEN_RE, (token) => {
    // Strip trailing punctuation that the greedy URL match may have swallowed,
    // extract from the clean URL, then re-append the punctuation.
    const trailing = token.match(/[.,;:!?)\]'"]+$/)?.[0] ?? "";
    const clean = trailing ? token.slice(0, -trailing.length) : token;
    const ref = nostrRefFromUrl(clean);
    return ref ? `${ref}${trailing}` : token;
  });
}
