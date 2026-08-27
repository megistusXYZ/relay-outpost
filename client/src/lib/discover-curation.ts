/**
 * Front-door curation — what the Discover TEASERS show, not what the network
 * holds. Born from a live report (2026-08-27): a "Damus Airdrop — $wSATS
 * claim is open" impersonation scam led the feed tile.
 *
 * Scope discipline: these rules apply to teasers/tiles ONLY. The full feed
 * pages are governed by the user's own trust settings; this file curates the
 * app's showcase, it never hides anything from the feeds themselves.
 */

// Airdrop/claim-shill family, kept deliberately narrow: every pattern names
// the SCAM VOCABULARY (airdrop, claim-is-open, claim-your-tokens, $TICKER
// near claim/drop) rather than money talk in general. A post warning ABOUT
// airdrops also matches — acceptable for a showcase slot; the post itself is
// untouched everywhere else.
const PROMO_BAIT = [
  /\bairdrops?\b/i,
  /\bclaim (is |are )?(now )?(open|live)\b/i,
  /\bclaim your (free )?(tokens?|rewards?|sats?|coins?)\b/i,
  /\$[A-Za-z]{2,10}\b.{0,50}\b(claim|drop|mint)\b/i,
];

/** Does this content read as airdrop/token-shill bait? Teaser floor only. */
export function isPromoBait(content: string): boolean {
  return PROMO_BAIT.some((re) => re.test(content));
}

/**
 * Stable partition: items by followed authors first, everyone else after,
 * both in their incoming order. Ordering, never dropping — trending still
 * fills whatever the follows don't.
 */
export function preferFollowed<T>(
  items: readonly T[],
  isFollowed: (author: string) => boolean,
  authorOf: (item: T) => string,
): T[] {
  const followed: T[] = [];
  const rest: T[] = [];
  for (const it of items) (isFollowed(authorOf(it)) ? followed : rest).push(it);
  return [...followed, ...rest];
}
