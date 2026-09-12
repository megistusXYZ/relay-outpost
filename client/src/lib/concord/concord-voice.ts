/**
 * Call keys for group-chat rooms (Concord CORD-07 §1). Every room can host a
 * call; there is no separate voice-room type. A call's coordinates derive from
 * the same secret and epoch that address the room's messages, so the rekey
 * that cuts a removed member off from chat cuts them off from calls too.
 *
 *   voice_key       = group_key("concord/voice-signer", secret, channel_id, epoch)
 *   voice_media_key = hkdf(secret, "concord/voice-media", channel_id, epoch)
 *
 * voice_key.pk names the call's room on the media server, and its secret key
 * signs the call-token request (server/concord-av.ts checks it). The media key
 * is the root every caller's frame key derives from. Pure; matches Armada's
 * derive.ts byte for byte (see the test's vectors).
 */
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent } from "nostr-tools";
import { groupKey } from "./concord-crypto";

const LABEL_VOICE_SIGNER = "concord/voice-signer";
const LABEL_VOICE_MEDIA = "concord/voice-media";
const LABEL_VOICE_SENDER = "concord/voice-sender";

export interface VoiceKeys {
  /** The call's room name on the media server: voice_key's x-only public key, hex. */
  room: string;
  /** voice_key's secret key: signs the call-token request. */
  signer: Uint8Array;
  /** The 32-byte media root every caller's frame key derives from. */
  mediaKey: Uint8Array;
}

/** A room's call keys, from the secret and epoch that address its messages. */
export function voiceKeys(secret: Uint8Array, channelId: string | Uint8Array, epoch: bigint): VoiceKeys {
  const id = typeof channelId === "string" ? hexToBytes(channelId) : channelId;
  // groupKey always derives the secret key; the type allows read-only planes without one.
  const { pk, sk } = groupKey(LABEL_VOICE_SIGNER, secret, id, epoch);
  if (!sk) throw new Error("call keys: the room's call key has no secret");
  return { room: pk, signer: sk, mediaKey: hkdf32(secret, info(LABEL_VOICE_MEDIA, id, epoch)) };
}

/**
 * A room's call keys from what we hold for it (CORD-03 §1, reused by CORD-07):
 * a public room calls on the group's root key at the root epoch; a private
 * room calls on its own key and epoch. Null for a private room whose key we
 * don't hold: we can't join what we can't read.
 */
export function roomVoiceKeys(
  group: { community_root: string; root_epoch: number },
  room: { id: string; key?: string; epoch: number; isPrivate: boolean },
): VoiceKeys | null {
  if (room.isPrivate) {
    return room.key ? voiceKeys(hexToBytes(room.key), room.id, BigInt(room.epoch)) : null;
  }
  return voiceKeys(hexToBytes(group.community_root), room.id, BigInt(group.root_epoch));
}

/** The call-token request's kind (CORD-07 §2). */
export const KIND_AV_TOKEN_REQUEST = 27235;

/**
 * The `Authorization` header that asks a call-token service for this room's
 * call (CORD-07 §2): signed by the room's call key (so the service knows we
 * hold the room, not who we are), naming the exact link and GET, with a random
 * nonce. Every member signs with the same key, so without the nonce two joins
 * in the same second would be byte-identical and the second taken for a replay
 * (Armada adds it for the same reason).
 */
export function buildAvTokenRequest(keys: VoiceKeys, url: string, now: number): string {
  const nonce = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const event = finalizeEvent({
    kind: KIND_AV_TOKEN_REQUEST,
    created_at: now,
    tags: [["u", url], ["method", "GET"], ["nonce", nonce]],
    content: "",
  }, keys.signer);
  return `Concord ${btoa(JSON.stringify(event))}`;
}

/**
 * One caller's frame key (CORD-07 §3): hkdf(media_key, "concord/voice-sender",
 * sha256(utf8(identity))), with no epoch, since the media key already carries
 * it. Everyone derives every caller's key from the identity the media server
 * reports, so nothing is exchanged, and each caller encrypts under their own key.
 */
export function voiceSenderKey(mediaKey: Uint8Array, identity: string): Uint8Array {
  if (mediaKey.length !== 32) throw new Error("call keys: media key must be 32 bytes");
  return hkdf32(mediaKey, info(LABEL_VOICE_SENDER, sha256(utf8ToBytes(identity))));
}

/** CORD-02 Appendix A.1: utf8(label) || 0x00 || id[32] || epoch_be[8] (epoch omitted where a shape has none). */
function info(label: string, id32: Uint8Array, epoch?: bigint): Uint8Array {
  if (id32.length !== 32) throw new Error("call keys: id must be 32 bytes");
  const head = concatBytes(utf8ToBytes(label), new Uint8Array([0x00]), id32);
  return epoch === undefined ? head : concatBytes(head, u64be(epoch));
}

function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n);
  return out;
}

function hkdf32(ikm: Uint8Array, infoBytes: Uint8Array): Uint8Array {
  return hkdf(sha256, ikm, undefined, infoBytes, 32);
}
