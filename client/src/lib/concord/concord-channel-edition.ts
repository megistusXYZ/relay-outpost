/**
 * Channel edition arithmetic (CORD-04, vsk-2).
 *
 * The same defect `concord-metadata-edition.ts` exists to fix, one coordinate
 * over — and this one carries a disclosure that metadata does not. `editChannel`
 * composed a FULL-REPLACEMENT edition out of two fields, `{channel_id, name}`,
 * while the fold reads four off it. Three things followed:
 *
 *   - **A private channel's `private: true` was dropped on every rename**, so
 *     the fold recomputed `!!undefined === false` and the room appeared, by
 *     name, in the rail of members holding no key. NOT a key leak — the plane
 *     key derives from the channel key they still do not have — but the room's
 *     existence and its name are exactly what was being hidden.
 *   - `about` / `picture` were erased. Latent in this client, which never
 *     writes them; real for a channel authored by another Concord client.
 *   - The chain cursor (`edVersion`/`edEid`) is PER-DEVICE, while channel
 *     editing is gated on PERM.MANAGE_CHANNELS rather than ownership. The
 *     self-heal that papered over this reconstructed v1 from the channel's
 *     CURRENT name — right for exactly one case, a still-v1 public channel, and
 *     wrong for a renamed one, an externally-authored one, and every private
 *     one, whose real v1 content also carried `private: true`.
 *
 * Same rules as metadata: the fold's head is the authority, the local cursor is
 * only a floor, the base comes from the fold WHOLESALE, and this refuses rather
 * than restarting a chain.
 *
 * ONE RULE METADATA DOES NOT HAVE. `private` is IDENTITY, not editable state —
 * no surface turns a channel public, and the plane key derives from the channel
 * key, so "unprivating" one would orphan its own history. It is therefore
 * MONOTONE: folded true OR proven locally by holding the key. That is also what
 * heals a community whose fold already carries a `private: false` written by an
 * earlier rename.
 *
 * KNOWN RESIDUAL, inherited: a device that has never folded this channel and
 * holds no cursor of its own can compose neither a safe base nor a valid chain
 * link. `canPublishChannelEdition` refuses rather than guessing.
 */
import { computeEditionId, type ChannelMetadata } from "./concord-events";
import type { StoredChannel } from "./concord-keys";

/** The winning edition at `2:${channelId}` as the live fold sees it. */
export interface ChannelHead {
  ev: number;
  /** The edition's computed hash — what the next edition's `ep` must equal. */
  hash: string;
}

/**
 * Only what the user actually changed. `delete` is terminal — there is no
 * un-delete edition — so it is `true` or absent, never `false`.
 */
export interface ChannelChanges {
  name?: string;
  delete?: true;
}

/**
 * The wire shape of a vsk-2 edition's content. Optional keys stay ABSENT when
 * unset, so a plain public rename serializes byte-identically to what channel
 * creation publishes at v1.
 */
export interface ChannelContent {
  channel_id: string;
  name: string;
  about?: string;
  picture?: string;
  private?: true;
  deleted?: true;
}

export interface NextChannelEdition {
  /** Always ≥ 2: an EDIT chains onto something, or it is refused. */
  version: number;
  /** Always set. A version above 1 without this is unfoldable. */
  prevHash: string;
  content: ChannelContent;
  eid: string;
}

/**
 * May this device publish an edition for this channel at all?
 *
 * Two independent proofs: a base we can prove (the fold, or a cursor this
 * device wrote itself at create time) and a chain head we can prove.
 * `govChannel === undefined` conflates "the fold hasn't arrived", "no edition
 * was ever published" and "this device cannot decrypt the plane it was written
 * on" — refusing is the only answer correct for all three.
 */
export function canPublishChannelEdition({ local, govChannel, foldHead }: {
  local: StoredChannel | undefined;
  govChannel: ChannelMetadata | undefined;
  foldHead: ChannelHead | undefined;
}): boolean {
  const cursor = !!local?.edVersion && !!local?.edEid;
  return (!!govChannel || cursor) && (!!foldHead?.hash || cursor);
}

/**
 * Compose the next channel edition: what to publish, at which version, chained
 * onto which parent.
 *
 * Throws rather than returning an edition every folder would silently drop.
 * Callers gate on `canPublishChannelEdition`; this is the invariant behind that
 * gate, not a duplicate of it.
 */
export function nextChannelEdition(
  channelId: string,
  local: StoredChannel | undefined,
  govChannel: ChannelMetadata | undefined,
  foldHead: ChannelHead | undefined,
  changes: ChannelChanges,
): NextChannelEdition {
  // The fold wins WHOLESALE, never per-field — a folded `about` spliced onto a
  // local `name` composes a state no edition ever asserted. StoredChannel could
  // not splice even if we wanted to: it has no about/picture fields at all.
  const base: ChannelMetadata = govChannel ?? {
    channel_id: channelId,
    name: local?.name ?? "",
    private: local?.isPrivate || undefined,
  };

  const content: ChannelContent = { channel_id: channelId, name: changes.name ?? base.name ?? "" };
  if (base.about !== undefined) content.about = base.about;
  if (base.picture !== undefined) content.picture = base.picture;
  // Monotone — see the header. Holding the key is un-fakeable proof the channel
  // is private, and it outranks a fold an earlier rename already broke.
  if (base.private || local?.isPrivate) content.private = true;
  // A tombstone carries the whole base, not a bare {channel_id, deleted}: our
  // fold reads only this flag, but a peer that ignores it must not be handed a
  // channel with a blank name and no privacy flag.
  if (changes.delete) content.deleted = true;

  // Highest head wins, and the FOLD wins a tie — its hash is the one other
  // clients already hold, so chaining onto ours would fork a private history
  // nobody else can resolve.
  const candidates: ChannelHead[] = [];
  if (foldHead?.hash) candidates.push(foldHead);
  if (local?.edVersion && local.edEid) candidates.push({ ev: local.edVersion, hash: local.edEid });
  const head = candidates.reduce<ChannelHead | undefined>((best, c) => (!best || c.ev > best.ev ? c : best), undefined);

  // Refuse rather than restart, and never RECONSTRUCT. The old fallback hashed
  // the channel's current name as though it were v1's — correct only for a
  // still-v1 public channel, and wrong for every renamed, private or
  // externally-authored one, where it named a parent that does not exist and
  // the edition was dropped by every folder that holds the real v1.
  if (!head) throw new Error("channel chain head unknown");
  const version = head.ev + 1;

  return {
    version,
    prevHash: head.hash,
    content,
    // Hash the SAME object the caller will serialize, so the id we record
    // matches the content byte for byte — a mismatch makes the next edition's
    // `ep` unresolvable.
    eid: computeEditionId(channelId, version, head.hash, JSON.stringify(content)),
  };
}
