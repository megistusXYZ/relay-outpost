/**
 * Grant edition arithmetic (CORD-04, vsk-3).
 *
 * The last coordinate in this codebase still publishing off a purely per-device
 * cursor. `setAdmin` read `community.grantVersions[target]` — a map only ever
 * written by the device that published — so any device without that memory
 * restarts the chain at version 1.
 *
 * That matters more here than anywhere else, because the fold REPLACES a grant
 * wholesale: a non-empty `role_ids` sets the member's roles, an EMPTY one
 * revokes them. Two version-1 editions therefore land on one coordinate, the
 * fold keeps exactly one (highest ev, ties broken by lowest rumor id — never by
 * time), and the loser's payload is discarded entirely.
 *
 * So an owner demoting an admin from a second device — one restored from the
 * kind-13302 backup, which is add-only and never refreshes a cursor — publishes
 * a REVOKE at v1 that collides with the v1 that granted admin in the first
 * place. Half the time the revoke is the one thrown away, and the person keeps
 * MANAGE_CHANNELS, MANAGE_METADATA, KICK and BAN while the UI reports success.
 * That is an authority bug, not a sync annoyance.
 *
 * Fixed the way `concord-banlist.ts` fixed it for vsk-4, and the metadata and
 * channel modules for vsk-0 and vsk-2: **the fold's head is the authority, the
 * local cursor is only a floor.**
 *
 * ONE DIFFERENCE from those two, and one trap inside it. Metadata and channel
 * editions REFUSE rather than restart, because only creation legitimately
 * publishes a v1 there. A grant's v1 IS legitimate — the first time a member is
 * granted anything there is genuinely no parent, and `chainIntact` accepts
 * `ev === 1` precisely when it carries no `ep`. A blanket refuse would break
 * the first grant in every community.
 *
 * But "no head" is the same three-way ambiguity the metadata module names: the
 * fold has not arrived, nothing was ever published here, or this device cannot
 * decrypt that plane. Only the middle one licenses a v1 — the other two produce
 * exactly the collision this module exists to stop. So v1 requires a POSITIVE
 * proof that the fold arrived and simply holds nothing for this member.
 */
import { computeEditionId } from "./concord-events";

/** The winning grant edition at `3:${target}` as the live fold sees it. */
export interface GrantHead {
  ev: number;
  /** The edition's computed hash — what the next edition's `ep` must equal. */
  hash: string;
}

/** What this device last published for this target, if anything. */
export interface GrantCursor {
  version: number;
  eid: string;
}

export interface GrantContent {
  member: string;
  role_ids: string[];
}

export interface NextGrantEdition {
  version: number;
  /** Absent only at version 1, where `chainIntact` requires its absence. */
  prevHash?: string;
  content: GrantContent;
  eid: string;
}

export function nextGrantEdition(
  target: string,
  cursor: GrantCursor | undefined,
  foldHead: GrantHead | undefined,
  roleIds: string[],
  /**
   * Positive proof the fold ARRIVED — any coordinate at all resolved
   * (`folded.heads.size > 0`). Without it, an absent head cannot be
   * distinguished from a cold subscription, and publishing v1 on that lands a
   * second one on an occupied coordinate where the loser is simply discarded.
   */
  foldArrived: boolean,
): NextGrantEdition {
  const content: GrantContent = { member: target, role_ids: roleIds };

  // Highest head wins, and the FOLD wins a tie — its hash is the one other
  // clients already hold, so chaining onto ours would fork a private history
  // nobody else can resolve.
  const candidates: GrantHead[] = [];
  if (foldHead?.hash) candidates.push(foldHead);
  if (cursor?.version && cursor.eid) candidates.push({ ev: cursor.version, hash: cursor.eid });
  const head = candidates.reduce<GrantHead | undefined>((best, c) => (!best || c.ev > best.ev ? c : best), undefined);

  // v1 only against arrival proof — never on the mere absence of a local cursor,
  // which is the second-device case and the collision itself.
  if (!head && !foldArrived) throw new Error("grant chain head unknown");
  const version = head ? head.ev + 1 : 1;
  const prevHash = head?.hash;

  return {
    version,
    prevHash,
    content,
    // Hash the SAME object the caller will serialize, so the id we record
    // matches the content byte for byte — a mismatch makes the next edition's
    // `ep` unresolvable.
    eid: computeEditionId(target, version, prevHash, JSON.stringify(content)),
  };
}
