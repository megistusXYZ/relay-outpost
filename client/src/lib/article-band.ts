/**
 * Which band of the Articles page a writer's work belongs in (owner,
 * 2026-11-23). People you follow come first and are never second-guessed.
 * With the wider network on, a second band holds writers your network
 * vouches for: followed by people you follow, or carrying a positive trust
 * score. Nobody else is shown. A claim is positive: an unknown score is not
 * a vouch, and neither is a score of zero.
 */
export type ArticleBand = "yours" | "circle" | null;

export interface BandSignals {
  me: string | null | undefined;
  isFollowed: (pubkey: string) => boolean;
  followedByFollows: (pubkey: string) => boolean;
  /** undefined = no score known. */
  trustScore: (pubkey: string) => number | undefined;
  flagged: (pubkey: string) => boolean;
  widerNetworkOn: boolean;
}

export function articleBand(author: string, s: BandSignals): ArticleBand {
  if (author === s.me || s.isFollowed(author)) return "yours";
  if (!s.widerNetworkOn) return null;
  if (s.flagged(author)) return null;
  if (s.followedByFollows(author)) return "circle";
  return (s.trustScore(author) ?? 0) > 0 ? "circle" : null;
}
