// Pure logic for the focused Edit-Profile screen (MyOutpost /account).
// Kept side-effect free so it can be unit-tested in isolation.

/** Snapshot of every editable value that participates in the dirty check. */
export interface ProfileEditSnapshot {
  name: string;
  displayName: string;
  about: string;
  picture: string;
  banner: string;
  nip05: string;
  website: string;
  lud16: string;
  /** Ordered list of the user's outpost/badge relay URLs (order is meaningful). */
  badgeOrder: string[];
  /** URLs hidden from the public profile (set semantics — order irrelevant). */
  hidden: string[];
}

function sameOrdered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const v of b) {
    if (!sa.has(v)) return false;
  }
  return true;
}

/**
 * True when the current edit state diverges from the snapshot captured when the
 * editor opened. Drives whether the sticky Save/Discard bar is shown.
 * Scalar profile fields compare exactly; badge order is order-sensitive; the
 * hidden set is order-insensitive.
 */
export function isProfileDirty(
  original: ProfileEditSnapshot,
  current: ProfileEditSnapshot,
): boolean {
  const scalarFields: (keyof ProfileEditSnapshot)[] = [
    "name",
    "displayName",
    "about",
    "picture",
    "banner",
    "nip05",
    "website",
    "lud16",
  ];
  for (const f of scalarFields) {
    if (original[f] !== current[f]) return true;
  }
  if (!sameOrdered(original.badgeOrder, current.badgeOrder)) return true;
  if (!sameSet(original.hidden, current.hidden)) return true;
  return false;
}

export type Nip05Decision = "verified" | "mismatch";

/**
 * Interpret the `GET /api/nip05/verify` response (shape `{ verified: boolean }`)
 * into a UI decision. Anything other than an explicit `verified === true` is a
 * mismatch (endpoint could not confirm the nip05 resolves to this pubkey).
 */
export function interpretNip05Response(
  resp: { verified?: boolean } | null | undefined,
): Nip05Decision {
  return resp != null && resp.verified === true ? "verified" : "mismatch";
}

/**
 * Derive the LNURL-pay well-known URL for a `user@domain` lightning address.
 * Returns null for malformed input. RESOLVE-ONLY: this URL is fetched to read
 * pay metadata — the returned `callback` is never invoked and no sats move.
 */
export function lud16ToLnurlpUrl(lud16: string | null | undefined): string | null {
  if (!lud16) return null;
  const trimmed = lud16.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const at = trimmed.indexOf("@");
  // Exactly one "@", and it must not be leading.
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return null;

  const user = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!user || !domain) return null;
  if (!domain.includes(".")) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(user)) return null;
  if (!/^[a-zA-Z0-9.-]+$/.test(domain)) return null;

  return `https://${domain}/.well-known/lnurlp/${user}`;
}

/**
 * Whether an LNURL-pay JSON body is a usable pay endpoint. Valid iff it carries
 * a `callback` string. We never call it — presence is the reachability signal.
 */
export function isValidLnurlPayResponse(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { callback?: unknown }).callback === "string" &&
    (body as { callback: string }).callback.length > 0
  );
}
