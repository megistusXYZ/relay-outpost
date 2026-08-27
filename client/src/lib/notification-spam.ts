/**
 * The mention-fishing shield. Accounts blast strangers with "airdrop ready"
 * mentions (live reports, 2026-08); those don't belong in the main
 * notification list. Classification is deliberately narrow:
 *
 *  - a FLAGGED account (your trust network flagged them) is suspect outright;
 *  - promo-bait content (the same vocabulary floor the Discover front door
 *    uses) from someone you DON'T trust is suspect;
 *  - everything else is ok — an unknown account with ordinary words is a
 *    stranger, not spam. Trusted people are never filtered, whatever they say.
 *
 * Suspect notifications are COLLAPSED, never deleted — the reader can always
 * open the filtered section and disagree.
 */
import { isPromoBait } from "@/lib/discover-curation";

export function classifyMentionSpam(input: {
  content: string;
  /** Author flagged by the user's trust network. */
  flagged: boolean;
  /** Author is followed, or holds a trusted WoT tier. */
  trusted: boolean;
}): "ok" | "suspect" {
  if (input.flagged) return "suspect";
  if (!input.trusted && isPromoBait(input.content)) return "suspect";
  return "ok";
}
