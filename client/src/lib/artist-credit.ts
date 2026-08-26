import { nip19 } from "nostr-tools";
import type { MusicTrack, ZapSplitRecipient } from "./music";

// A nostr pubkey is 32 bytes / 64 lowercase-or-uppercase hex chars.
const HEX64 = /^[0-9a-f]{64}$/i;

export function isValidPubkey(pk?: string): pk is string {
  return !!pk && HEX64.test(pk);
}

/**
 * Where the artist credit should link. Internal links (`external: false`) are
 * app routes meant for wouter's <Link>; external links open in a new tab.
 *
 * Priority (per spec): the artist's Nostr profile if we have their pubkey,
 * else their Wavlake presence, else nothing (plain-text credit).
 */
export type ArtistLink =
  | { kind: "profile"; href: string; external: false }
  | { kind: "wavlake"; href: string; external: boolean }
  | null;

export function resolveArtistLink(track: {
  artistPubkey?: string;
  wavlakeUrl?: string;
  artistId?: string;
}): ArtistLink {
  if (isValidPubkey(track.artistPubkey)) {
    try {
      const npub = nip19.npubEncode(track.artistPubkey);
      return { kind: "profile", href: `/profile/${npub}`, external: false };
    } catch {
      // fall through to Wavlake if encoding somehow fails
    }
  }
  if (track.wavlakeUrl) {
    return { kind: "wavlake", href: track.wavlakeUrl, external: true };
  }
  if (track.artistId) {
    // In-app Wavlake artist page (backed by the Wavlake catalog).
    return { kind: "wavlake", href: `/audio?artist=${encodeURIComponent(track.artistId)}`, external: false };
  }
  return null;
}

export interface ArtistZapTarget {
  /** Nostr pubkey whose LNURL/lightning address receives the sats. */
  pubkey: string;
  /** Display name for the zap confirmation ("Support <name>"). */
  name: string;
}

/**
 * Resolve who a "Support the artist" zap should route to.
 *
 * 1. If the track carries value-splits / zap-splits with real Nostr pubkeys,
 *    route to the artist among them (exact pubkey match) or, failing a match,
 *    the largest-share recipient (the primary artist in a value-split).
 * 2. Otherwise fall back to the artist's own pubkey — the zap dialog resolves
 *    their lightning address from their profile metadata.
 * 3. If neither is available, return null so the support control is hidden.
 *
 * This resolver never moves money: it only names the recipient. The actual
 * send happens in the existing zap confirmation dialog, which the user drives.
 */
export function resolveArtistZapTarget(track: {
  artist?: string;
  artistPubkey?: string;
  zapSplits?: ZapSplitRecipient[];
}): ArtistZapTarget | null {
  const artistName = track.artist?.trim() || "the artist";

  const splitCandidates = (track.zapSplits || []).filter((r) => isValidPubkey(r.pubkey));
  if (splitCandidates.length > 0) {
    const matchArtist = isValidPubkey(track.artistPubkey)
      ? splitCandidates.find((r) => r.pubkey === track.artistPubkey)
      : undefined;
    const chosen =
      matchArtist ?? [...splitCandidates].sort((a, b) => (b.split || 0) - (a.split || 0))[0];
    return { pubkey: chosen.pubkey as string, name: artistName };
  }

  if (isValidPubkey(track.artistPubkey)) {
    return { pubkey: track.artistPubkey, name: artistName };
  }

  return null;
}

/** Narrow shape used by the in-post credit UI. */
export type ArtistCreditData = Pick<
  MusicTrack,
  "artist" | "artistPubkey" | "artistId" | "wavlakeUrl" | "artistAvatarUrl" | "zapSplits" | "source"
>;
