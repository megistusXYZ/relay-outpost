/**
 * Which call rooms a device asks to be rung for while the app is closed
 * (owner, 2026-10-06). push-rooms.test.ts.
 *
 * Calls on for this device, holding the room's key, and neither the group nor
 * the room muted. Each carries the device's proof that it holds the room's
 * key — that key's signature over its push address, which our server checks
 * (server/push/push-devices.ts) — and, for the phone only, the name to show
 * ("Call in Bali crew") and where tapping opens. Names never leave the phone.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { roomVoiceKeys } from "@/lib/concord/concord-voice";

export interface RingRoom {
  /** The room's anonymous id: its call key's public key. */
  room: string;
  /** Proof for our server that this device holds the room's key. */
  proof: string;
  /** Shown on this phone only. */
  label: string;
  open: string;
}

export function ringRooms(communities: StoredCommunity[], o: {
  endpoint: string;
  callsOn: boolean;
  /** Muted group (no channel), or muted room. */
  muted: (communityId: string, channelId?: string) => boolean;
}): RingRoom[] {
  if (!o.callsOn) return [];
  const msg = sha256(utf8ToBytes(`concord-push:${o.endpoint}`));
  const out: RingRoom[] = [];
  for (const c of communities) {
    if (o.muted(c.community_id)) continue;
    for (const ch of c.channels ?? []) {
      if (o.muted(c.community_id, ch.id)) continue;
      const keys = roomVoiceKeys(c, ch);
      if (!keys) continue;
      out.push({
        room: keys.room,
        proof: bytesToHex(schnorr.sign(msg, keys.signer)),
        label: c.name || "your group",
        open: `/outposts/c/${c.community_id}?channel=${ch.id}`,
      });
    }
  }
  return out;
}
