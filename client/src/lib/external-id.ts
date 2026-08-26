/**
 * NIP-73 external-content identity for web URLs.
 *
 * A page on the open web (a Hacker News item, a blog post, a Lemmy/Reddit
 * thread) is anchored by its canonical URL. Every Nostr comment *about* that
 * page (kind 1111, NIP-22) carries the same normalized URL in an uppercase
 * root-scope `I` tag with `K = "web"`, so the conversation is portable across
 * clients and keyed to the link rather than to any one relay or app.
 *
 * The normalizer is the make-or-break correctness point: two clients that
 * disagree on the canonical form of a URL will build two disjoint threads for
 * the same page. It MUST be deterministic and idempotent
 * (`normalize(normalize(x)) === normalize(x)`), and it must NOT mangle URLs
 * whose identity lives in the path — Lemmy (`/post/123`), Reddit
 * (`/r/x/comments/abc/…`), or Fediverse (`/@user/12345`) — while still
 * preserving a meaningful query such as HN's `item?id=123`.
 */
import type { Event } from "nostr-tools";

/**
 * Query keys that are purely tracking / attribution noise and never carry the
 * identity of the resource. Stripped during normalization so the same page
 * shared through different channels collapses to one anchor. Any key beginning
 * with `utm_` is also stripped (see `isTrackingParam`).
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gclsrc",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "igshid",
  "mc_eid",
  "mc_cid",
  "mkt_tok",
  "vero_id",
  "vero_conv",
  "_hsenc",
  "_hsmi",
  "oly_anon_id",
  "oly_enc_id",
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "source",
  "share",
  "s", // twitter share token (t.co / x.com), not a content identifier
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

/**
 * NIP-73 canonicalization of a web URL:
 *  - lowercase scheme + host, strip a leading `www.`
 *  - drop the fragment
 *  - strip tracking params (`utm_*`, `fbclid`, `gclid`, `mc_eid`, `ref`, …),
 *    preserving every other (meaningful) query param in its original order
 *  - normalize a trailing slash on non-root paths (root stays `/`)
 *
 * Deterministic and idempotent. Throws for input that is not a parseable URL —
 * callers that may receive junk should guard with a try/catch.
 */
export function normalizeExternalUrl(raw: string): string {
  const u = new URL(raw.trim());

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (u.hostname.startsWith("www.")) {
    u.hostname = u.hostname.slice(4);
  }

  u.hash = "";

  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key)) u.searchParams.delete(key);
  }
  // Re-serialize explicitly so an emptied query drops the `?` entirely.
  const query = u.searchParams.toString();
  u.search = query ? `?${query}` : "";

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }

  return u.toString();
}

/**
 * Root-scope tags for a top-level comment on an external URL: uppercase `I`
 * (the normalized URL) + uppercase `K = "web"` per NIP-22/NIP-73.
 */
export function buildExternalRootTags(url: string): string[][] {
  const norm = normalizeExternalUrl(url);
  return [
    ["I", norm],
    ["K", "web"],
  ];
}

/**
 * Tags for a one-level reply to an existing external comment: the external
 * root scope (`I`/`K`) is preserved uppercase, and the parent event is pointed
 * to with lowercase `e`/`k` (+ `p` so the parent author is notified). We keep
 * the thread flat (one level) — the root is always the URL, never a parent
 * comment, so cross-client readers always resolve the whole discussion from
 * the anchor.
 */
export function buildExternalReplyTags(
  url: string,
  parentEvent: Event,
  relayHint?: string,
): string[][] {
  const hint = relayHint || "";
  return [
    ...buildExternalRootTags(url),
    ["e", parentEvent.id, hint],
    ["k", String(parentEvent.kind)],
    ["p", parentEvent.pubkey],
  ];
}

/**
 * The normalized external URL a kind-1111 comment is anchored to, read from its
 * uppercase root-scope `I` tag. Returns null when there is no `I` tag or its
 * value is not a parseable URL (so callers can safely skip non-web comments).
 */
export function extractExternalAnchor(event: Pick<Event, "tags">): string | null {
  const tag = event.tags.find((t) => t[0] === "I" && typeof t[1] === "string" && t[1]);
  if (!tag) return null;
  try {
    return normalizeExternalUrl(tag[1]);
  } catch {
    return null;
  }
}

/**
 * Parse a `?discuss=<anchor>` deep-link parameter into a safe, normalized
 * external anchor — or null when the value is junk. This is the funnel entry
 * point: a shared note links to `/news?discuss=<encodeURIComponent(anchor)>`,
 * and the app opens that link's Discussion tab from the parsed anchor.
 *
 * Hardened against hostile input. The value is accepted only if it parses as a
 * URL with an `http(s)` scheme — so `javascript:`, `data:`, `file:`, `ftp:` …
 * are all rejected — and then survives `normalizeExternalUrl`. It also tolerates
 * a still-percent-encoded value (the param may arrive raw or already decoded by
 * URLSearchParams) WITHOUT double-decoding a clean URL. Anything that doesn't
 * survive returns null, and the caller ignores it (no navigation, no fetch).
 *
 * The anchor drives WHICH discussion opens; it never becomes trusted display
 * text — the reader always shows the link's own fetched/derived data.
 */
export function parseDiscussParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Consider the value as-is first (already URL-decoded by URLSearchParams in the
  // common case), then a percent-decoded form as a fallback — so a clean URL is
  // never double-decoded (which would corrupt a literal `%` in the path).
  const candidates: string[] = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed).trim();
    if (decoded && decoded !== trimmed) candidates.push(decoded);
  } catch {
    // malformed percent-encoding — just skip the decoded candidate
  }

  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue; // not a parseable URL — try the next candidate
    }
    // http(s) only. A parseable non-http scheme is hostile/irrelevant — reject
    // outright rather than falling through to the decoded candidate.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    try {
      return normalizeExternalUrl(candidate);
    } catch {
      return null;
    }
  }
  return null;
}
