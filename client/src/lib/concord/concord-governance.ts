/**
 * Concord governance ops (CORD-04/06): remove/ban a member (with the rekey that
 * actually cuts their access), and create a private channel (independent key,
 * distributed to current members via a channel-scoped rekey). Owner-gated for
 * Slice 4; custom roles/grants are a follow-up (owner can already do everything).
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { randomBytes32, rekeyScopeId } from "./concord-crypto";
import { VSK, PERM, ADMIN_ROLE_ID, buildControlEdition, buildJoinLeaveRumor, buildAuditRumor, computeEditionId, serializePermissions, type Member, type ChannelMetadata } from "./concord-events";
import { nextChannelEdition, type ChannelChanges, type ChannelHead } from "./concord-channel-edition";
import { nextGrantEdition, type GrantHead } from "./concord-grant-edition";
import { putCommunity, deleteCommunity, publishCommunityList, adoptBaseRekey, type StoredCommunity, type StoredChannel } from "./concord-keys";
import { nextBanlistEdition, type BanlistHead } from "./concord-banlist";
import { refreshInviteLinks } from "./concord-invites";
import { publishControlEdition, publishGuestbook, publishGuestbookSnapshot, channelPlaneKey } from "./concord-stream";
import { sendRekey } from "./concord-rekey";

type PublishFn = (event: Event, relays: string[]) => Promise<unknown>;
type PublishSelfFn = (event: Event) => Promise<unknown>;
type ProgressFn = (done: number, total: number) => void;

/** The single built-in "Admin" role: a fixed hex id, position 1 (just under the
 *  owner), with everything except MANAGE_ROLES (only the owner grants admin).
 *  The id itself now lives in concord-events (a pure module needs it too); it is
 *  re-exported here so every existing importer keeps working. */
export { ADMIN_ROLE_ID } from "./concord-events";
export const ADMIN_ROLE_POSITION = 1;
export const ADMIN_PERMS =
  PERM.MANAGE_CHANNELS | PERM.MANAGE_METADATA | PERM.KICK | PERM.BAN |
  PERM.MANAGE_MESSAGES | PERM.CREATE_INVITE | PERM.VIEW_AUDIT_LOG;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Remove a member from the community: optionally add them to the banlist
 * (vsk-4), then rotate the community_root key so they lose all future access
 * (CORD-06 base rotation). `roster` is the current membership; the removed
 * target is excluded from the rekey recipients. Bumps the local root_epoch.
 */
export async function removeMember(
  signer: ISigner,
  ownerPubkey: string,
  community: StoredCommunity,
  target: string,
  opts: {
    ban: boolean;
    currentBanlist: string[];
    roster: Member[];
    /**
     * The winning banlist edition from the LIVE fold (FoldedState.heads), or
     * undefined when none has folded yet. Replaces a caller-supplied version
     * number, which was always the literal 1 — see concord-banlist.ts.
     */
    banHead?: BanlistHead;
    reason?: string;
  },
  publish: PublishFn,
  onProgress?: ProgressFn,
): Promise<StoredCommunity | null> {
  const now = Math.floor(Date.now() / 1000);

  // 1. Banlist edition (vsk-4) if banning. CHAINED: version one past the highest
  //    head we can prove, carrying its hash as `ep`. Publishing version 1 every
  //    time put two different payloads on one fold coordinate, where only one
  //    survives and it REPLACES the set — silently un-banning somebody.
  if (opts.ban) {
    const next = nextBanlistEdition(target, opts.currentBanlist, opts.banHead, {
      version: community.banVersion, eid: community.banEid, snapshot: community.banSnapshot,
    });
    // Hash the SAME array buildControlEdition will serialize, so the id we
    // record matches the content byte-for-byte (JSON.stringify, key order and
    // all) — a mismatch here makes the next edition's `ep` unresolvable.
    const eid = computeEditionId(next.eid, next.version, next.prevHash, JSON.stringify(next.banlist));
    await publishControlEdition(signer, ownerPubkey, community,
      buildControlEdition(ownerPubkey, VSK.BANLIST, next.eid, next.version, next.banlist, now,
        next.prevHash ? { prevHash: next.prevHash } : undefined),
      publish).catch(() => null);
    // Record the chain cursor NOW, not after the rekey. The edition is already on
    // the wire at this point, and the rekey below can still fail — sendRekey
    // returns null for a signer without nip44 (some extensions and bunkers), and
    // removeMember then returns early. Remembering only on the success path left
    // a published version this device had no memory of, so the next ban reused
    // that version and collided: the exact failure this function is fixing.
    community = { ...community, banVersion: next.version, banEid: eid, banSnapshot: next.banlist };
    await putCommunity(ownerPubkey, community).catch(() => {});
  }

  // Record the moderation action in the audit log (guestbook plane).
  await publishGuestbook(signer, ownerPubkey, community,
    buildAuditRumor(ownerPubkey, opts.ban ? "ban" : "kick", now, { target, reason: opts.reason }),
    publish).catch(() => null);

  // 2. Rotate community_root, excluding the target.
  const scopeId = rekeyScopeId(); // all-zeros = base rotation
  const newKey = randomBytes32();
  const remaining = opts.roster.filter((m) => m.pubkey !== target && m.pubkey !== ownerPubkey).map((m) => ({ pubkey: m.pubkey }));
  const res = await sendRekey(
    signer, ownerPubkey, community,
    { scopeId, prevEpoch: community.root_epoch, prevKey: hexToBytes(community.community_root), newKey, remaining },
    publish, onProgress,
  ).catch(() => null);
  if (!res) return null;

  // 3. Adopt the new root locally, RETAINING the prior root so the earlier
  //    epochs' governance/guestbook/channel planes stay readable (without this,
  //    the roster + audit history vanish the moment the epoch bumps).
  // `community` already carries the banlist cursor recorded in step 1, and
  // adoptBaseRekey spreads the record, so it survives the epoch bump.
  const updated = adoptBaseRekey(community, bytesToHex(newKey), res.newEpoch);
  await putCommunity(ownerPubkey, updated);

  // 3.5 Refounding guestbook snapshot (CORD-06 §3 / CORD-02 §5): seed the
  //     survivors (everyone but the removed target — includes the refounder)
  //     into the NEW epoch's Guestbook so a post-removal fresh joiner recovers
  //     the pre-removal roster. Published under the new root/epoch (`updated`),
  //     sealed encrypted. Best-effort: a Refounding succeeds without it, and an
  //     omitted member heals by publishing their own Join.
  const survivors = [...new Set([ownerPubkey, ...remaining.map((r) => r.pubkey)])];
  await publishGuestbookSnapshot(signer, ownerPubkey, updated, survivors, publish).catch(() => {});

  // 4. Refresh this creator's live invite links so a shared link/QR hands out
  //    the NEW root (CORD-05 §2 — a link survives every rotation). Best-effort.
  await refreshInviteLinks(ownerPubkey, updated, publish).catch(() => {});
  return updated;
}

/**
 * Create a PRIVATE channel: a fresh independent secret + epoch 1, published as a
 * vsk-2 channel edition, its key distributed to current members via a
 * channel-scoped rekey. Returns the updated community with the private channel.
 */
export async function createPrivateChannel(
  signer: ISigner,
  ownerPubkey: string,
  community: StoredCommunity,
  opts: { name: string; roster: Member[] },
  publish: PublishFn,
  onProgress?: ProgressFn,
): Promise<StoredCommunity> {
  const channelId = bytesToHex(randomBytes32());
  const channelKey = randomBytes32();
  const now = Math.floor(Date.now() / 1000);

  const v1Content = { channel_id: channelId, name: opts.name, private: true };
  await publishControlEdition(signer, ownerPubkey, community,
    buildControlEdition(ownerPubkey, VSK.CHANNEL, channelId, 1, v1Content, now),
    publish).catch(() => null);

  // Distribute the channel key (epoch 1) to current members via a rekey.
  const scopeId = rekeyScopeId(channelId);
  const recipients = opts.roster.filter((m) => m.pubkey !== ownerPubkey).map((m) => ({ pubkey: m.pubkey }));
  await sendRekey(
    signer, ownerPubkey, community,
    { scopeId, prevEpoch: 0, prevKey: channelKey, newKey: channelKey, remaining: recipients },
    publish, onProgress,
  ).catch(() => null);

  // Record the v1 edition id, as createChannel does. Without it a private
  // channel could never be renamed or deleted BY ANYONE: the old self-heal
  // reconstructed v1 as `{channel_id, name}` while the real one serializes
  // `private: true` too, so every successor cited a parent that does not exist
  // and was dropped by every folder holding v1.
  const channel: StoredChannel = {
    id: channelId, key: bytesToHex(channelKey), epoch: 1, name: opts.name, isPrivate: true,
    edVersion: 1, edEid: computeEditionId(channelId, 1, undefined, JSON.stringify(v1Content)),
  };
  const updated: StoredCommunity = { ...community, channels: [...community.channels, channel] };
  await putCommunity(ownerPubkey, updated);
  return updated;
}

/**
 * Grant or revoke the built-in Admin role for a member (owner-only in the UI).
 * Publishes the Admin role edition once (vsk-1), then a chained grant edition
 * (vsk-3, version N+1) mapping the member to [admin] or [] (revoke). Updates the
 * local grant-chain state + resyncs 13302. No rekey — role changes are cheap.
 */
export async function setAdmin(
  signer: ISigner,
  ownerPubkey: string,
  community: StoredCommunity,
  target: string,
  makeAdmin: boolean,
  /**
   * The live head of THIS target's vsk-3 chain. Required, not optional: the
   * local `grantVersions` map is written only by the device that published, so
   * any other device restarts the chain at v1 — onto a coordinate that already
   * holds one. See concord-grant-edition.ts.
   */
  foldHead: GrantHead | undefined,
  /** True once any coordinate has folded — see nextGrantEdition's `foldArrived`. */
  foldArrived: boolean,
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<StoredCommunity> {
  const now = Math.floor(Date.now() / 1000);
  let updated: StoredCommunity = { ...community };

  // 1. Publish the Admin role definition once.
  if (!community.adminRolePublished) {
    await publishControlEdition(signer, ownerPubkey, community,
      buildControlEdition(ownerPubkey, VSK.ROLE, ADMIN_ROLE_ID, 1, {
        role_id: ADMIN_ROLE_ID, name: "Admin", position: ADMIN_ROLE_POSITION,
        permissions: serializePermissions(ADMIN_PERMS), scope: { kind: "server" },
      }, now),
      publish).catch(() => null);
    updated.adminRolePublished = true;
  }

  // 2. Chained grant edition for this member — fold head first, local cursor
  //    only as a floor.
  const next = nextGrantEdition(target, community.grantVersions?.[target], foldHead,
    makeAdmin ? [ADMIN_ROLE_ID] : [], foldArrived);

  // Refuse to record a cursor for an edition that never landed. Swallowing the
  // publish left the next change to this member chaining onto an edition no
  // relay holds, and told the caller it worked. The REVOKE is what makes that
  // serious: the fold replaces roles wholesale and there is no rekey here, so a
  // revoke that does not land leaves the person holding MANAGE_CHANNELS,
  // MANAGE_METADATA, KICK and BAN — network-wide, enforced by every other
  // client, with nothing anywhere to show the owner it failed.
  const landed = await publishControlEdition(signer, ownerPubkey, updated,
    buildControlEdition(ownerPubkey, VSK.GRANT, target, next.version, next.content, now,
      next.prevHash ? { prevHash: next.prevHash } : undefined),
    publish);
  if (!landed) throw new Error("Couldn't reach any relay — the role was not changed.");

  updated.grantVersions = { ...(community.grantVersions ?? {}), [target]: { version: next.version, eid: next.eid } };
  await putCommunity(ownerPubkey, updated);

  await publishGuestbook(signer, ownerPubkey, updated,
    buildAuditRumor(ownerPubkey, makeAdmin ? "make_admin" : "remove_admin", now, { target }),
    publish).catch(() => null);
  await publishCommunityList(signer, ownerPubkey, publishSelf).catch(() => {});
  return updated;
}

/**
 * Rename or delete a channel (owner/admin). Publishes a chained vsk-2 channel
 * edition (version N+1); delete carries `deleted:true` so folds drop it. Updates
 * the local record + resyncs 13302. No rekey needed.
 */
export async function editChannel(
  signer: ISigner,
  authorPubkey: string,
  community: StoredCommunity,
  channelId: string,
  change: ChannelChanges,
  /**
   * The live fold for THIS channel. Required, not optional: the local
   * StoredChannel can compose neither a safe base nor a valid chain link, and
   * an optional argument is one a caller forgets. See concord-channel-edition.
   */
  fold: { channel: ChannelMetadata | undefined; head: ChannelHead | undefined },
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<StoredCommunity> {
  // No `if (!ch) return community`. The drawer's rows are the LIVE list —
  // stored channels UNION folded ones — so a community whose channel list came
  // from the control plane renders rows the record has never held, and
  // returning the community unchanged turned that rename into a success toast
  // with nothing on the wire.
  const ch = community.channels.find((c) => c.id === channelId);
  const next = nextChannelEdition(channelId, ch, fold.channel, fold.head, change);
  const now = Math.floor(Date.now() / 1000);

  // PUBLISH FIRST, AND CHECK IT LANDED. The old order committed the local
  // mutation before the wire and swallowed the publish, so a DELETE that never
  // reached a relay still dropped the channel from this device — taking a
  // private channel's ONLY copy of its key with it — while the channel kept
  // running for everyone else. Unrecoverable without a fresh grant.
  //
  // The null check is the load-bearing half: `publishEvent` returns false on
  // total relay failure rather than throwing, so publishing first and merely
  // not catching would still have reported success while offline.
  const landed = await publishControlEdition(signer, authorPubkey, community,
    buildControlEdition(authorPubkey, VSK.CHANNEL, channelId, next.version, next.content, now,
      { prevHash: next.prevHash }),
    publish);
  if (!landed) throw new Error("Couldn't reach any relay — nothing was changed.");

  // The record now mirrors what we published, so the next edit from this device
  // chains instead of resurrecting a pre-fold snapshot. A channel we hold no
  // record for is left alone: seating one here is how a device that is not
  // entitled to a private channel ends up owning its id and name for good.
  const channels = change.delete
    ? community.channels.filter((c) => c.id !== channelId)
    : community.channels.map((c) => (c.id === channelId
      ? { ...c, name: next.content.name, edVersion: next.version, edEid: next.eid }
      : c));
  const updated: StoredCommunity = { ...community, channels };
  await putCommunity(authorPubkey, updated);

  await publishGuestbook(signer, authorPubkey, community,
    buildAuditRumor(authorPubkey, change.delete ? "delete_channel" : "rename_channel", now, { detail: next.content.name }),
    publish).catch(() => null);
  await publishCommunityList(signer, authorPubkey, publishSelf).catch(() => {});
  return updated;
}

/**
 * Dissolve the whole outpost (owner-only): publish a vsk-10 tombstone so members'
 * apps mark it gone, then delete the local keys + resync the 13302 backup so it
 * drops off other devices. Irreversible. Returns nothing (the community is gone).
 */
export async function dissolveCommunity(
  signer: ISigner,
  ownerPubkey: string,
  community: StoredCommunity,
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await publishControlEdition(signer, ownerPubkey, community,
    buildControlEdition(ownerPubkey, VSK.DISSOLVED, community.community_id, 1, { dissolved: true }, now),
    publish).catch(() => null);
  await publishGuestbook(signer, ownerPubkey, community,
    buildAuditRumor(ownerPubkey, "dissolve", now), publish).catch(() => null);
  await deleteCommunity(ownerPubkey, community.community_id);
  await publishCommunityList(signer, ownerPubkey, publishSelf).catch(() => {});
}

/**
 * Leave an outpost (non-owner member): publish a guestbook leave so the roster
 * drops you, then remove the local keys + resync 13302. The owner can't leave —
 * they dissolve instead.
 */
export async function leaveCommunity(
  signer: ISigner,
  myPubkey: string,
  community: StoredCommunity,
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await publishGuestbook(signer, myPubkey, community, buildJoinLeaveRumor(myPubkey, false, now),
    (e, r) => publish(e, r)).catch(() => null);
  await deleteCommunity(myPubkey, community.community_id);
  await publishCommunityList(signer, myPubkey, publishSelf).catch(() => {});
}

// Re-export so the UI has one governance import surface.
export { channelPlaneKey };
