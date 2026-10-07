/**
 * Which call rooms a device asks to be rung for while the app is closed
 * (owner, 2026-10-06): calls on, holding the room's key, and neither the group
 * nor the room muted. Each comes with this device's proof that it holds the
 * room's key, and the name the phone shows ("Call in Bali crew") — kept on
 * the phone, never sent.
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import { roomVoiceKeys } from "@/lib/concord/concord-voice";
import { ringRooms } from "./push-rooms";

const hex = () => randomBytes(32).toString("hex");
const group = (name: string, channels: Array<{ name: string; isPrivate?: boolean; key?: string }>): StoredCommunity => ({
  community_id: hex(), owner: hex(), owner_salt: hex(), community_root: hex(), root_epoch: 0,
  relays: [], name, addedAt: 0,
  channels: channels.map((c) => ({ id: hex(), epoch: 0, name: c.name, isPrivate: !!c.isPrivate, ...(c.key ? { key: c.key } : {}) })),
} as StoredCommunity);

describe("rooms that ring this device", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/phone";
  const bali = group("Bali crew", [{ name: "general" }, { name: "planning" }]);
  const club = group("Book club", [{ name: "general" }, { name: "staff", isPrivate: true }]); // a private room we hold no key for

  it("every room you hold the key for, with proof and the name the phone shows", () => {
    const rooms = ringRooms([bali, club], { endpoint, callsOn: true, muted: () => false });
    expect(rooms.map((r) => r.label)).toEqual(["Bali crew", "Bali crew", "Book club"]);
    const first = rooms[0];
    expect(first.room).toBe(roomVoiceKeys(bali, bali.channels[0])!.room);
    expect(first.open).toBe(`/outposts/c/${bali.community_id}?channel=${bali.channels[0].id}`);
    expect(schnorr.verify(hexToBytes(first.proof), sha256(utf8ToBytes(`concord-push:${endpoint}`)), hexToBytes(first.room))).toBe(true);
  });

  it("nothing while calls are off on this device", () => {
    expect(ringRooms([bali, club], { endpoint, callsOn: false, muted: () => false })).toEqual([]);
  });

  it("a muted group, or a muted room, doesn't ring", () => {
    const planning = bali.channels[1].id;
    const rooms = ringRooms([bali, club], { endpoint, callsOn: true, muted: (cid, chid) => cid === club.community_id || chid === planning });
    expect(rooms.map((r) => r.open)).toEqual([`/outposts/c/${bali.community_id}?channel=${bali.channels[0].id}`]);
  });
});
