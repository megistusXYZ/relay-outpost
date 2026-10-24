import { decodeNpubToHex } from "@/helpers/nostr-helpers";
import { CURATED_LISTS } from "@shared/curated-lists";

// Curated starter accounts shown as suggested follows during onboarding
// and in the empty-feed panel on Home. Kept in one place so both surfaces
// stay in sync. Order is intentional — the first ~8 entries are what
// Home renders as the compact strip for new users who landed on a quiet
// feed with zero follows.
// Trimmed to a tight, recognizable set (user-curated). Order = display order in
// onboarding suggestions + the empty-feed strip. Invited accounts lead with the
// inviter, then these.
export const CURATED_SEED_NPUBS: string[] = CURATED_LISTS.suggestedPeople;

/** The suggested people as hex keys, in order, duplicates and bad entries dropped. */
export function seedPubkeysFrom(npubs: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const npub of npubs) {
    const hex = decodeNpubToHex(npub);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out;
}

export const CURATED_SEED_PUBKEYS: string[] = seedPubkeysFrom(CURATED_SEED_NPUBS);

/**
 * The follow list a brand-new account is anchored with at creation: the
 * friend who invited it, or nobody (owner, 2026-10-10: "your space first").
 * It used to also follow the first curated seed (jack) so no feed was ever
 * empty — which put a stranger's posts first, before the person had made a
 * single choice. The curated seeds remain suggestions (the people strip),
 * never silent follows. Growth is the person's own: invites, communities,
 * the people they choose.
 */
export function buildAnchorFollows(inviterHex: string | null | undefined): string[] {
  return inviterHex ? [inviterHex] : [];
}
