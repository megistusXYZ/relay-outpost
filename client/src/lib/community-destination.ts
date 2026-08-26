// Destination-label builder for the community (NIP-29 outpost) post composer.
//
// The composer's destination chip reads "Posting to <label>". The label prefers
// the community's friendly NIP-11 name and falls back to the bare relay hostname
// when no name is resolvable. When the author also cross-posts to their own feed,
// the label gains a "+ your feed" suffix so the chip reflects the true reach.

/** Strip the wss?:// scheme and any trailing slashes from a relay URL. */
export function relayHostname(relayUrl: string): string {
  return relayUrl.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

export interface DestinationLabelInput {
  /** Community's friendly name (NIP-11 `name`), if known. */
  communityName?: string | null;
  /** The outpost's relay URL — used for the hostname fallback. */
  relayUrl: string;
  /** Whether the post is also being shared to the author's own feed. */
  alsoShareToFeed?: boolean;
}

/**
 * Build the destination label shown in the composer chip after "Posting to ".
 * - community name present  → the name
 * - + share-to-feed         → "<name> + your feed"
 * - no name                 → the relay hostname (fallback)
 */
export function buildDestinationLabel({
  communityName,
  relayUrl,
  alsoShareToFeed = false,
}: DestinationLabelInput): string {
  const base = communityName?.trim() || relayHostname(relayUrl);
  return alsoShareToFeed ? `${base} + your feed` : base;
}
