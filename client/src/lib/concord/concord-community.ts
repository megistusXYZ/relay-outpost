/**
 * Concord high-level community operations (CORD-02/03): create a community,
 * add a channel. Ties the crypto/events/keys/stream layers together and does
 * the persistence + relay publishing. Slice 2 covers public channels; private
 * channels + governance land in Slice 4.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { deriveCommunityId, randomBytes32, groupKey, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { VSK, buildControlEdition, buildJoinLeaveRumor, computeEditionId, type CommunityMetadata } from "./concord-events";
import { putCommunity, publishCommunityList, type StoredCommunity, type StoredChannel } from "./concord-keys";
import { nextMetadataEdition, type MetadataChanges, type MetadataHead } from "./concord-metadata-edition";
import { publishControlEdition, publishGuestbook, publishChannelMessage } from "./concord-stream";
import { buildTimerNotice } from "./concord-disappearing";

export interface CreateCommunityOpts {
  name: string;
  icon?: string;
  about?: string;
  /** Relay set for the community (≤5). Caller resolves from NIP-65 writes + defaults. */
  relays: string[];
  /** Optional client-side link to a relay-backed outpost (its relay URL). */
  relayUrl?: string;
}

type PublishFn = (event: Event, relays: string[]) => Promise<unknown>;
type PublishSelfFn = (event: Event) => Promise<unknown>;

/**
 * Create a Concord community owned by `myPubkey`. Mints the root secret + salt,
 * derives the id, opens a default public "general" channel, persists the keys
 * locally, publishes the metadata + channel editions + a guestbook join, and
 * syncs your Community List. Returns the stored record (also the route param).
 */
export async function createCommunity(
  signer: ISigner,
  myPubkey: string,
  opts: CreateCommunityOpts,
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<StoredCommunity> {
  const ownerSalt = bytesToHex(randomBytes32());
  const communityRoot = bytesToHex(randomBytes32());
  const communityId = deriveCommunityId(myPubkey, ownerSalt);
  const rootEpoch = 0;
  const relays = opts.relays.slice(0, 5);
  // The split from the start (CORD-02 §2): a second secret only the owner and
  // staff hold. Its derived key addresses and signs the admin plane, so members
  // (who get only control_pk, in invites) can read it but never write it.
  const controlRoot = bytesToHex(randomBytes32());
  const controlPk = groupKey(LABEL_CONTROL_SIGNER, hexToBytes(controlRoot), communityId, BigInt(rootEpoch)).pk;

  const generalId = bytesToHex(randomBytes32());
  const generalContent = { channel_id: generalId, name: "general" };
  const general: StoredChannel = {
    id: generalId, epoch: rootEpoch, name: "general", isPrivate: false,
    edVersion: 1, edEid: computeEditionId(generalId, 1, undefined, JSON.stringify(generalContent)),
  };

  const record: StoredCommunity = {
    community_id: communityId,
    owner: myPubkey,
    owner_salt: ownerSalt,
    community_root: communityRoot,
    root_epoch: rootEpoch,
    control_pk: controlPk,
    control_root: controlRoot,
    channels: [general],
    relays,
    name: opts.name,
    icon: opts.icon,
    about: opts.about,
    addedAt: Date.now(),
    relayUrl: opts.relayUrl,
  };

  // Record the v1 metadata edition id so later edits can chain to it.
  // `description` is CORD-02 §6's name for it, where other apps read it.
  const metaContent = { name: opts.name, description: opts.about ?? "", picture: opts.icon ?? "", relays };
  record.metaVersion = 1;
  record.metaEid = computeEditionId(communityId, 1, undefined, JSON.stringify(metaContent));

  // Persist first so the UI can navigate even if a relay publish is slow.
  await putCommunity(myPubkey, record);

  // Publish the control-plane editions + guestbook join (best-effort; the local
  // record is already authoritative for the creator).
  const now = Math.floor(Date.now() / 1000);
  await publishControlEdition(signer, myPubkey, record,
    buildControlEdition(myPubkey, VSK.METADATA, communityId, 1, metaContent, now),
    publish).catch(() => null);
  await publishControlEdition(signer, myPubkey, record,
    buildControlEdition(myPubkey, VSK.CHANNEL, generalId, 1, generalContent, now),
    publish).catch(() => null);
  await publishGuestbook(signer, myPubkey, record, buildJoinLeaveRumor(myPubkey, true, now), publish).catch(() => null);
  await publishCommunityList(signer, myPubkey, publishSelf).catch(() => {});

  return record;
}

/**
 * Add a PUBLIC channel to a community (Slice 2). Private channels need key
 * distribution + grants (Slice 4) and throw here for now.
 */
export async function createChannel(
  signer: ISigner,
  myPubkey: string,
  community: StoredCommunity,
  opts: { name: string; isPrivate?: boolean },
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<StoredCommunity> {
  if (opts.isPrivate) throw new Error("Private channels arrive in a later update");
  const channelId = bytesToHex(randomBytes32());
  const chContent = { channel_id: channelId, name: opts.name };
  const channel: StoredChannel = {
    id: channelId, epoch: community.root_epoch, name: opts.name, isPrivate: false,
    edVersion: 1, edEid: computeEditionId(channelId, 1, undefined, JSON.stringify(chContent)),
  };
  const updated: StoredCommunity = { ...community, channels: [...community.channels, channel] };

  await putCommunity(myPubkey, updated);
  const now = Math.floor(Date.now() / 1000);
  await publishControlEdition(signer, myPubkey, updated,
    buildControlEdition(myPubkey, VSK.CHANNEL, channelId, 1, chContent, now),
    publish).catch(() => null);
  await publishCommunityList(signer, myPubkey, publishSelf).catch(() => {});

  return updated;
}

/**
 * Edit the outpost's name and/or image (vsk-0 metadata edition N+1, chained to
 * the tracked previous edition). Updates the local record + syncs your
 * Community List. Owner/admin gated in the UI. Returns the updated community.
 */
export async function editMetadata(
  signer: ISigner,
  myPubkey: string,
  community: StoredCommunity,
  /** ONLY what the user actually edited — see MetadataChanges. Passing every
   *  field unconditionally is what made this destructive: a concrete `false`
   *  from an untouched Switch is indistinguishable from a deliberate one. */
  changes: MetadataChanges,
  /**
   * The live fold. Required rather than optional, because the local record
   * alone cannot compose a safe base OR a valid chain link, and an optional
   * argument is one a caller forgets. See concord-metadata-edition.ts.
   */
  fold: { metadata: CommunityMetadata | undefined; head: MetadataHead | undefined },
  publish: PublishFn,
  publishSelf: PublishSelfFn,
): Promise<StoredCommunity> {
  const next = nextMetadataEdition(community, fold.metadata, fold.head, changes);
  const { name, description, picture, allow_member_invites: allowMemberInvites } = next.content;

  // The record now mirrors what we actually published — the fold's values plus
  // this edit — so the next edit from this device chains, instead of
  // resurrecting whatever it was holding before the fold arrived. A field the
  // edition didn't carry (another app's group we didn't add it to) leaves the
  // record's value alone.
  const updated: StoredCommunity = {
    ...community,
    name,
    icon: picture !== undefined ? picture || undefined : community.icon,
    about: description || undefined,
    allowMemberInvites: allowMemberInvites !== undefined ? allowMemberInvites : community.allowMemberInvites,
    metaVersion: next.version,
    metaEid: next.eid,
  };
  await putCommunity(myPubkey, updated);

  const now = Math.floor(Date.now() / 1000);
  await publishControlEdition(signer, myPubkey, updated,
    buildControlEdition(myPubkey, VSK.METADATA, community.community_id, next.version, next.content, now,
      { prevHash: next.prevHash }),
    publish).catch(() => null);
  await publishCommunityList(signer, myPubkey, publishSelf).catch(() => {});

  return updated;
}

/**
 * After the disappearing-messages timer changes, one notice into each room this
 * device holds the key for (CORD-08 §4): "Alice set disappearing messages to 7
 * days". Informational and best-effort: the group's settings are the authority,
 * so a room that gets no notice still follows the timer.
 */
export async function postTimerNotices(
  signer: ISigner,
  myPubkey: string,
  community: StoredCommunity,
  seconds: number,
  publish: PublishFn,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(community.channels
    .filter((ch) => !ch.isPrivate || !!ch.key)
    .map((ch) => {
      // A public room rides the group's epoch; a private one its own.
      const epoch = BigInt(ch.isPrivate ? ch.epoch : community.root_epoch);
      return publishChannelMessage(signer, myPubkey, community, ch,
        buildTimerNotice(myPubkey, ch.id, epoch, seconds, Date.now() % 1000, now), publish).catch(() => null);
    }));
}
