/**
 * Banlist edition arithmetic (CORD-04, vsk-4).
 *
 * The banlist is the only control entity published at a FIXED coordinate. Every
 * other chained entity has an eid that is unique per entity — a channel id, a
 * member pubkey, the community id — so two different payloads never land on the
 * same fold coordinate by accident. The banlist is a singleton republished in
 * full on every ban, which makes the version chain load-bearing rather than
 * decorative, and it is why this arithmetic is worth its own module.
 *
 * What went wrong without it: the only caller passed `editionVersion: 1`
 * literally, so every ban published version 1 at the same coordinate.
 * `applyEditions` keeps exactly ONE edition per coordinate (highest ev, ties
 * broken by lowest rumor id — never by time; ControlEdition carries no
 * created_at at all), and `case VSK.BANLIST` REPLACES the set wholesale rather
 * than merging. So the losing edition's entire snapshot was discarded and
 * whoever it banned was silently readmitted — decided by hash order, and stably,
 * because no higher version could ever exist.
 *
 * Three inputs decide the next edition, and all three matter:
 *
 *   foldHead  what the relays currently hold. Authoritative across devices —
 *             the banlist is multi-writer (any PERM.BAN holder), so a purely
 *             local counter is wrong on a second admin's first ban.
 *   cursor    what THIS device last published. Covers the window where the fold
 *             is cold: banning calls onCommunityChange, which re-runs
 *             useConcordGovernance's subscribe effect and clears the edition
 *             map, so a prompt second ban sees an empty banlist. Carrying only a
 *             version there would make things worse, not better — version 2 with
 *             a truncated payload deletes the earlier ban outright instead of
 *             merely tying with it. The cursor therefore carries the SNAPSHOT
 *             too, and the payload is a union.
 *   target    who is being banned now.
 *
 * KNOWN RESIDUALS — narrowed, not eliminated. Both are inherent to a singleton
 * coordinate whose fold REPLACES rather than merges, and closing either needs a
 * protocol change (union-on-fold, or per-target eids) that would fork us from
 * other Concord clients. They are deliberately not addressed here:
 *
 *   Simultaneous writers. Two moderators who both see head N publish N+1 with
 *   the same parent: a true tie, resolved by the rumor-id coin flip, one payload
 *   discarded. This was every second ban; it is now only genuinely concurrent
 *   ones. Note a ban rekeys the community, which clears every OTHER moderator's
 *   fold — so the window is real, not theoretical.
 *
 *   Communities that already forked. Where two version-1 editions are on the
 *   relays from before this fix, the first chained ban cites whichever won the
 *   tie-break; a device holding only the other one rejects that chain, because
 *   the dangling-head tolerance refuses a head whose parent contradicts a version
 *   it holds. State converges going forward, but bans already dropped stay
 *   dropped — the owner has to re-issue them.
 */

/** The singleton coordinate every banlist edition is published at. */
export const BANLIST_EID = "ba".repeat(32);

/**
 * Most bans one edition carries. The payload is persisted on StoredCommunity and
 * packed into the NIP-44 key-backup blob, which has a hard byte ceiling — an
 * uncapped list is the one thing this store never allows.
 */
export const BANLIST_CAP = 200;

/** The winning banlist edition as the live fold currently sees it. */
export interface BanlistHead {
  ev: number;
  /** The edition's computed hash — what the next edition's `ep` must equal. */
  hash: string;
}

/** What this device last published, persisted on StoredCommunity. */
export interface BanlistCursor {
  version?: number;
  /** Computed edition hash of that publish (StoredCommunity.banEid). */
  eid?: string;
  /** The exact payload published, so a cold fold cannot silently shrink it. */
  snapshot?: string[];
}

export interface NextBanlistEdition {
  eid: string;
  version: number;
  /** Present iff version > 1. A version > 1 without this is unfoldable. */
  prevHash?: string;
  banlist: string[];
}

/**
 * Compute the next banlist edition: one past the highest head we can actually
 * prove, carrying every ban we know about.
 */
export function nextBanlistEdition(
  target: string,
  foldedBanlist: Iterable<string>,
  foldHead: BanlistHead | undefined,
  cursor: BanlistCursor | undefined,
): NextBanlistEdition {
  // Only a head with a usable parent hash can be chained onto. A version > 1
  // whose `ep` is missing fails chainIntact in every folder and is dropped
  // silently — worse than a tie, because the publisher still reports success.
  const candidates: BanlistHead[] = [];
  if (foldHead && foldHead.hash) candidates.push(foldHead);
  if (cursor?.version && cursor.eid) candidates.push({ ev: cursor.version, hash: cursor.eid });
  // Prefer the fold on a tie: its hash is the one other clients already hold.
  const head = candidates.reduce<BanlistHead | undefined>(
    (best, c) => (!best || c.ev > best.ev ? c : best),
    undefined,
  );

  // Fall back to our own snapshot ONLY while the fold is behind it. A current
  // fold is authoritative, and re-adding regardless would make one refused
  // edition permanent: authorizeEdition requires the signer to outrank EVERY
  // entry in the payload (`targets.every(...)`), so a payload the network
  // rejected, resent forever from local state, would refuse every later ban from
  // that moderator.
  const foldBehind = !foldHead || foldHead.ev < (cursor?.version ?? 0);
  const known = foldBehind ? (cursor?.snapshot ?? []) : [];

  // Capped like every other list this store persists (PRIOR_ROOTS_CAP,
  // SNAPSHOT_CHUNK_CAP). banSnapshot rides on StoredCommunity, which
  // publishCommunityList packs — twice per record — into a single NIP-44
  // plaintext with a hard 65535-byte ceiling; past it encrypt throws, every
  // caller swallows it, and the multi-device key backup silently stops updating.
  // Oldest entries go first, and the ban being made now is never the one dropped.
  const merged = [...new Set([...foldedBanlist, ...known])].sort();
  const banlist = merged.includes(target)
    ? merged.slice(-BANLIST_CAP)
    : [...merged.slice(-(BANLIST_CAP - 1)), target].sort();

  return {
    eid: BANLIST_EID,
    version: head ? head.ev + 1 : 1,
    prevHash: head?.hash,
    banlist,
  };
}
