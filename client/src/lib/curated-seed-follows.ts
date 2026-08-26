import { decodeNpubToHex } from "@/helpers/nostr-helpers";

// Curated starter accounts shown as suggested follows during onboarding
// and in the empty-feed panel on Home. Kept in one place so both surfaces
// stay in sync. Order is intentional — the first ~8 entries are what
// Home renders as the compact strip for new users who landed on a quiet
// feed with zero follows.
// Trimmed to a tight, recognizable set (user-curated). Order = display order in
// onboarding suggestions + the empty-feed strip. Invited accounts lead with the
// inviter, then these.
export const CURATED_SEED_NPUBS: string[] = [
  "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", // jack
  "npub1cn4t4cd78nm900qc2hhqte5aa8c9njm6qkfzw95tszufwcwtcnsq7g3vle", // Jack Mallers
  "npub1ahxjq4v0zlvexf7cg8j9stumqp3nrtzqzzqxa7szpmcdgqrcumdq0h5ech", // Nat Brunell
  "npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424", // Derek Ross
  "npub1a2cww4kn9wqte4ry70vyfwqyqvpswksna27rtxd8vty6c74era8sdcw83a", // Lyn Alden
  "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z", // Vitor Pamplona
  "npub1dg6es53r3hys9tk3n7aldgz4lx4ly8qu4zg468zwyl6smuhjjrvsnhsguz", // Efrat Fenigson
  // Headroom so the 2×4 strip stays full even after the user follows a few
  // (unresolved/followed entries are skipped at render).
  "npub1dergggklka99wwrs92yz8wdjs952h2ux2ha2ed598ngwu9w7a6fsh9xzpc", // Gigi
  "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6", // fiatjaf
  "npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s", // Will (jb55)
];

export const CURATED_SEED_PUBKEYS: string[] = (() => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const npub of CURATED_SEED_NPUBS) {
    const hex = decodeNpubToHex(npub);
    if (hex && !seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out;
})();

/**
 * The follow list a brand-new account is anchored with at creation. Deliberately
 * minimal + deterministic (frictionless-onboarding decision): every account
 * follows exactly the first curated seed (jack) so each new account's WoT score
 * reads the same known graph; invite-link arrivals additionally lead with their
 * inviter (the real relationship that seeds their score + outpost). Never
 * duplicates the inviter if they ARE the seed. Growth past this is organic
 * (search, invites, the Home suggested-follows strip).
 */
export function buildAnchorFollows(
  inviterHex: string | null | undefined,
  curatedSeeds: string[] = CURATED_SEED_PUBKEYS,
): string[] {
  const seed = curatedSeeds[0];
  if (!inviterHex) return seed ? [seed] : [];
  if (!seed || inviterHex === seed) return [inviterHex];
  return [inviterHex, seed];
}
