/**
 * The spec's derived coordinates for Grants and the Banlist (CORD-02 A.6,
 * CORD-04 §1): hkdf over the community_id, labelled, with the member (or 32
 * zero bytes) as the id and no epoch, so they survive every Refounding and
 * every client derives the same ones. The Pin List's locator is the same
 * construction (concord-pins).
 *
 * This client first wrote Grants at the member's pubkey and the Banlist at a
 * fixed `"ba"×32`, which no other Concord app reads. Those old coordinates are
 * still read (concord-events foldEditions); new editions go here.
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";

const LABEL_GRANT = "concord/grant";
const LABEL_BANLIST = "concord/banlist";
const LABEL_INVITE_LINKS = "concord/invite-links";
const ZERO_ID = new Uint8Array(32);

/** This client's original Banlist coordinate: still read, never written. */
export const LEGACY_BANLIST_EID = "ba".repeat(32);

function locator(communityId: string, label: string, id: Uint8Array): string {
  const info = concatBytes(utf8ToBytes(label), new Uint8Array([0x00]), id);
  return bytesToHex(hkdf(sha256, hexToBytes(communityId), undefined, info, 32));
}

/** `grant_locator(community_id, member)`: where a member's Grant lives. */
export function grantLocator(communityId: string, member: string): string {
  return locator(communityId, LABEL_GRANT, hexToBytes(member));
}

/** `banlist_locator(community_id)`: where the Banlist lives. */
export function banlistLocator(communityId: string): string {
  return locator(communityId, LABEL_BANLIST, ZERO_ID);
}

/** `invite-links(community_id, creator)`: where a creator's invite Registry lives (CORD-05 §5). */
export function inviteLinksLocator(communityId: string, creator: string): string {
  return locator(communityId, LABEL_INVITE_LINKS, hexToBytes(creator));
}
