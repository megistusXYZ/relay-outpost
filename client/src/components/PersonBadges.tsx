/**
 * The verification signal that appears next to a person's name.
 *
 * This is the doorman made visible: "anyone can mint an identity and claim your
 * name — the Outpost is where your community proves who's real." One component
 * so every surface renders it identically and a new surface can't invent its own
 * treatment.
 *
 * THE RULE — positive-only:
 *  - Show a check only for AFFIRMATIVE evidence (a domain vouching for the key).
 *  - Show nothing at all in its absence. Never the word "Unverified".
 *  - Reserve the warning for a real FINDING — a name that collides with someone
 *    already in your graph — never for a missing row.
 *  - Never a number on a human's forehead.
 *
 * Why not GrapeRank here, given we own it: it cannot answer on day one. The web
 * of trust is off by default, a fresh observer waits 15–25 minutes for a first
 * calculation, and nobody in a community you just joined is in your connection
 * payload. `getSignalTier(null)` returns "none", whose label is "Unverified" —
 * so the obvious build paints an accusation beside every person in a room you
 * just walked into, which is worse than saying nothing. GrapeRank keeps doing
 * what it is good at (ranking, filtering, admission); it is not asked to make a
 * binary public claim about a stranger.
 *
 * Why not vouches here: `useAttestations` is strictly per-pubkey — three filters
 * across four relays with an 8s timeout, and no batch query exists. A 50-person
 * member list would open ~600 subscriptions. Vouches stay where they already
 * are, inside the hover card.
 *
 * Both primitives below already self-hide, so this component is a composition
 * and a comment, not new logic. That is deliberate: the rule is the valuable
 * part, and it now lives in exactly one place.
 */
import { Nip05VerifiedCheck } from "@/components/Nip05Badge";
import { ImpersonationChip } from "@/components/ImpersonationChip";

export function PersonBadges({
  pubkey,
  nip05,
  claimedName,
  showCollision = true,
  className = "",
  iconClassName = "w-3.5 h-3.5",
}: {
  pubkey: string;
  /** The NIP-05 the profile claims. Verification is checked, not assumed. */
  nip05?: string | null;
  /**
   * The name the profile CLAIMS — `display_name || name`. Never pass a
   * getDisplayName/getDMDisplayName result: those fall back to a shortened npub,
   * and comparing an npub against trusted names is meaningless noise.
   */
  claimedName?: string;
  /** Off where a row has no real profile to compare (name would be an npub). */
  showCollision?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
      <Nip05VerifiedCheck nip05={nip05} pubkey={pubkey} className={iconClassName} />
      {showCollision && !!claimedName && (
        <ImpersonationChip pubkey={pubkey} displayName={claimedName} nip05={nip05 ?? undefined} compact />
      )}
    </span>
  );
}
