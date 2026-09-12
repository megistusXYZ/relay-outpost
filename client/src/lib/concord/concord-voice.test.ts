/**
 * Call keys (Concord CORD-07 §1). Every room can host a call; its call's
 * coordinates derive from the room's own secret and epoch, so a rekey rolls
 * the call too. The expected values below were computed by Armada's own
 * derive.ts (armada main 17d4fcb0) for the same inputs: matching them is what
 * lets a call started here and one started in Armada meet in the same room.
 */
import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { voiceKeys, voiceSenderKey, roomVoiceKeys, buildAvTokenRequest } from "./concord-voice";
import { issueAvToken } from "../../../../server/concord-av";

const SECRET = new Uint8Array(32).fill(0x11);
const CHANNEL_ID = new Uint8Array(32).fill(0x22);

describe("call keys", () => {
  it("names a room's call and derives its media root exactly as Armada does", () => {
    const keys = voiceKeys(SECRET, CHANNEL_ID, 0n);
    expect(keys.room).toBe("adcafc48018ac99ebe4a2ffdfaf6d450a390564d0edbc645c6c2e37037560664");
    expect(bytesToHex(keys.mediaKey)).toBe("723508a54b592d767d13d3f9fdfc7389bd836f464be8f0b2047f75a05807d9b4");
  });

  it("gives each caller the same frame key Armada derives from the identity the media server assigns", () => {
    const { mediaKey } = voiceKeys(SECRET, CHANNEL_ID, 0n);
    expect(bytesToHex(voiceSenderKey(mediaKey, "0123456789abcdef0123456789abcdef")))
      .toBe("bb0406988b998a791df740f7990ae6f7cb1413067c180f62621028650af0349a");
  });

  it("moves the call to a new room with a new media root when the room's key changes, exactly as Armada does", () => {
    const keys = voiceKeys(SECRET, CHANNEL_ID, 7n);
    expect(keys.room).toBe("bcf70d81e79578add9a78fb84f87b6cbafabecfcbdff1c439abc8e1226d1d84d");
    expect(bytesToHex(keys.mediaKey)).toBe("cb0929062e4a82ac66cdf62e62d3d8e15a1501abf936141d42eff8c9d6554153");
    expect(bytesToHex(voiceSenderKey(keys.mediaKey, "0123456789abcdef0123456789abcdef")))
      .toBe("aabf3ef010a51d0f6416f09b8702a81495c6417db7d4e559d33b475fa871654b");
  });

  it("calls a public room on the group's root key and a private room on its own key", () => {
    const hex = (b: number) => "".padStart(64, b.toString(16).padStart(2, "0"));
    const group = { community_root: hex(0x11), root_epoch: 4 };
    const pub = { id: hex(0x22), epoch: 0, isPrivate: false };
    const priv = { id: hex(0x22), key: hex(0x33), epoch: 9, isPrivate: true };
    expect(roomVoiceKeys(group, pub)?.room).toBe(voiceKeys(SECRET, CHANNEL_ID, 4n).room);
    expect(roomVoiceKeys(group, priv)?.room).toBe(voiceKeys(new Uint8Array(32).fill(0x33), CHANNEL_ID, 9n).room);
    // A private room whose key we don't hold can't be called.
    expect(roomVoiceKeys(group, { ...priv, key: undefined })).toBeNull();
  });

  it("asks for a call token in exactly the form our call-token service accepts", () => {
    // The real server check, not a copy of it: the app and the server must agree.
    const keys = voiceKeys(SECRET, CHANNEL_ID, 0n);
    const url = `https://relayop.xyz/.well-known/concord/av/${keys.room}`;
    const now = 1_789_240_000;
    const res = issueAvToken({
      authorization: buildAvTokenRequest(keys, url, now), room: keys.room, url, now,
      seen: new Set<string>(), apiKey: "APItest", apiSecret: "s".repeat(48), livekitUrl: "wss://livekit.relayop.xyz",
    });
    expect(res.status).toBe(200);
    // Two same-second requests from one room stay distinct (the nonce), so neither is taken for a replay.
    expect(buildAvTokenRequest(keys, url, now)).not.toBe(buildAvTokenRequest(keys, url, now));
  });
});
