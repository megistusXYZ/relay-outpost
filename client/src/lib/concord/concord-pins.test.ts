/**
 * Pins (CORD-04 §7). A pin doesn't quote a message, it proves one: the
 * message's original signed seal plus the one-shot NIP-44 keys that open it,
 * so any member (even one who joined after a rekey) can verify who said what,
 * where and when. One Pin List per room, on the admin plane.
 */
import { describe, it, expect } from "vitest";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import { pinsLocator } from "./concord-pins";

const cid = "a1".repeat(32), room = "c3".repeat(32), other = "d4".repeat(32);

describe("where a room's pins live", () => {
  it("at a coordinate derived from the group's id and the room's (CORD-02 A.1/A.6: concord/pins, no epoch)", () => {
    const expected = bytesToHex(hkdf(sha256, hexToBytes(cid), undefined,
      concatBytes(utf8ToBytes("concord/pins"), new Uint8Array([0]), hexToBytes(room)), 32));
    expect(pinsLocator(cid, room)).toBe(expected);
    expect(pinsLocator(cid, other)).not.toBe(expected);
    expect(pinsLocator(other, room)).not.toBe(expected);
  });
});
