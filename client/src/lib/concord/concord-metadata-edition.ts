/**
 * Metadata edition arithmetic (CORD-04, vsk-0).
 *
 * Metadata went MULTI-WRITER the day the admin drawer gated editing on
 * PERM.MANAGE_METADATA rather than ownership, and nothing below the drawer
 * noticed. StoredCommunity.metaVersion still described itself as authoritative
 * "because the owner is the sole metadata editor". They aren't:
 *
 *   - A second admin joined by link has NO metaVersion at all, so
 *     `(undefined ?? 1) + 1` published version 2 with no `ep`. `chainIntact`
 *     rejects exactly that (`if (!cur.ep) return false`), so the edition was
 *     dropped by every folder INCLUDING the publisher's own — while the dialog
 *     said "Group chat updated". Their next edit then chained onto the orphan.
 *   - An owner on a second device restores a record from the kind-13302 backup,
 *     and `syncCommunityList` is add-only, so that cursor never refreshes. Its
 *     saves lose quietly for a few versions and then WIN — republishing an old
 *     name, about, picture, relay list and invite policy over everyone.
 *
 * This is the same defect `concord-banlist.ts` exists to fix, one coordinate
 * over, and it is fixed the same way: **the fold's head is the authority; the
 * local cursor is only a floor.** `FoldedState.heads` has carried the metadata
 * head all along and nothing read it.
 *
 * The BASE is the other half, and the halves must land together — a metadata
 * edition REPLACES the whole content object, so fixing only the chain would
 * turn an inert no-op into a working wipe. Folded metadata therefore wins the
 * moment it exists, the same rule `concord-invite-gate.ts` states for the read
 * path. There it is merely permissive; here it is destructive.
 *
 * The fold wins WHOLESALE, never per-field: a folded `about` spliced onto a
 * local `picture` composes a state no edition ever asserted.
 *
 * KNOWN RESIDUAL: a device that has never folded this community's metadata
 * cannot compose a safe base at all. `canPublishMetadata` refuses rather than
 * guessing. For someone who joined after a rekey that is permanent — metadata
 * is published once, on the epoch it was written, and nothing republishes it on
 * rotation. Refusing is still the right answer; publishing over an unknown base
 * is how the data gets destroyed.
 */
import { computeEditionId, type CommunityMetadata } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";

/** The winning metadata edition as the live fold currently sees it. */
export interface MetadataHead {
  ev: number;
  /** The edition's computed hash — what the next edition's `ep` must equal. */
  hash: string;
}

/**
 * Only the fields the user actually EDITED.
 *
 * Absent means untouched, so take the base. `""` means deliberately cleared and
 * stays cleared. A concrete `false` means a human moved the switch — which is
 * the one thing no layer below the UI can infer, because a Switch rendered off
 * from an `undefined` record looks identical to one a person turned off.
 */
export interface MetadataChanges {
  name?: string;
  icon?: string;
  about?: string;
  allowMemberInvites?: boolean;
}

/** The wire shape of a vsk-0 edition's content. */
export interface MetadataContent {
  name: string;
  about: string;
  picture: string;
  relays: string[];
  allow_member_invites: boolean;
}

export interface NextMetadataEdition {
  /** Always ≥ 2: an EDIT chains onto something, or it is refused. */
  version: number;
  /** Always set. A version above 1 without this is unfoldable. */
  prevHash: string;
  content: MetadataContent;
  eid: string;
}

/**
 * May this device publish a metadata edition at all?
 *
 * Two independent proofs, and a Save button needs both: a base we can prove
 * (the fold, or being the owner whose own record IS the base right after
 * createCommunity), and a chain head we can prove.
 *
 * `govMetadata === undefined` conflates three different answers — "the fold
 * hasn't arrived yet", "no metadata edition has ever been published", and "this
 * device structurally cannot decrypt the plane it was written on". Refusing is
 * the only response that is correct for all three.
 */
export function canPublishMetadata({ community, pubkey, govMetadata, foldHead }: {
  community: StoredCommunity | null | undefined;
  pubkey: string | null | undefined;
  govMetadata: CommunityMetadata | undefined;
  foldHead: MetadataHead | undefined;
}): boolean {
  if (!community || !pubkey) return false;
  const haveBase = !!govMetadata || pubkey === community.owner;
  const haveChain = !!foldHead?.hash || (!!community.metaVersion && !!community.metaEid);
  return haveBase && haveChain;
}

/**
 * Compose the next metadata edition: what to publish, at which version, chained
 * onto which parent.
 *
 * Throws rather than returning an edition every folder would silently drop.
 * Callers gate on `canPublishMetadata`; this is the invariant behind that gate,
 * not a duplicate of it.
 */
export function nextMetadataEdition(
  community: StoredCommunity,
  govMetadata: CommunityMetadata | undefined,
  foldHead: MetadataHead | undefined,
  changes: MetadataChanges,
): NextMetadataEdition {
  const base: CommunityMetadata = govMetadata ?? {
    name: community.name,
    about: community.about,
    picture: community.icon,
    relays: community.relays,
    allowMemberInvites: community.allowMemberInvites,
  };
  const content: MetadataContent = {
    name: changes.name ?? base.name,
    about: changes.about ?? base.about ?? "",
    picture: changes.icon ?? base.picture ?? "",
    // No UI field, so always untouched — and therefore folded like the rest.
    // Republishing `community.relays` was its own quiet corruption: for a
    // link-joined member that array is the invite bundle's relays mixed with
    // our bootstrap defaults and sliced to five.
    relays: (base.relays?.length ? base.relays : community.relays).slice(0, 5),
    allow_member_invites: changes.allowMemberInvites ?? base.allowMemberInvites ?? false,
  };

  // Highest head wins, and the FOLD wins a tie — its hash is the one other
  // clients already hold, so chaining onto ours would fork off a private
  // history nobody else can resolve.
  const candidates: MetadataHead[] = [];
  if (foldHead?.hash) candidates.push(foldHead);
  if (community.metaVersion && community.metaEid) candidates.push({ ev: community.metaVersion, hash: community.metaEid });
  const head = candidates.reduce<MetadataHead | undefined>((best, c) => (!best || c.ev > best.ev ? c : best), undefined);

  // Refuse rather than restart the chain. Only createCommunity publishes
  // version 1; an EDIT that cannot name a parent would land a second v1 on the
  // same coordinate, where the fold keeps exactly one and decides by rumor-id
  // coin flip — so half the time it silently overwrites the real metadata with
  // a base composed from a record we already know is stale.
  if (!head) throw new Error("metadata chain head unknown");
  const version = head.ev + 1;

  return {
    version,
    prevHash: head.hash,
    content,
    // Hash the SAME object the caller will serialize, so the id we record
    // matches the content byte for byte — a mismatch makes the next edition's
    // `ep` unresolvable.
    eid: computeEditionId(community.community_id, version, head.hash, JSON.stringify(content)),
  };
}
