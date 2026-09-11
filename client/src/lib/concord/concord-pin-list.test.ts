/**
 * Reading a room's Pin List (CORD-04 §7). A public room's list is plaintext;
 * a private room's is sealed under the room's key at a named epoch. What this
 * device cannot read is "unavailable", never "empty": publishing from an
 * empty-looking view would silently drop every pin it couldn't see.
 */
import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { makePinEntry, readPinList, type PinEntry } from "./concord-pins";
import { buildMessageRumor, type RumorTemplate } from "./concord-events";
import { buildEncryptedSeal, planeConvKey, groupKey, LABEL_CHANNEL } from "./concord-crypto";

const sk = generateSecretKey();
const author = getPublicKey(sk);
const room = "c3".repeat(32);
const conv = planeConvKey(groupKey(LABEL_CHANNEL, generateSecretKey(), room, 4n));
const pinOf = (text: string, at: number): PinEntry => {
  const r: RumorTemplate = buildMessageRumor(author, room, 4n, text, 1, at);
  const s = buildEncryptedSeal(author, JSON.stringify({ ...r, id: getEventHash(r as never) }), conv, at);
  return makePinEntry(finalizeEvent({ kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content }, sk), conv);
};
const good = pinOf("Meet at 6", 1_789_000_000);
const loaded = { foldLoaded: true };

describe("reading a room's pins", () => {
  it("a public room's list shows each pin it can prove; a bad entry is dropped alone", () => {
    const bad = { ...pinOf("Tampered", 1_789_000_001), keys: "00".repeat(76) };
    const view = readPinList(JSON.stringify({ entries: [good, bad] }), room, loaded);
    expect(view.status).toBe("ok");
    if (view.status !== "ok") return;
    expect(view.pins.map((p) => p.rumor.content)).toEqual(["Meet at 6"]);
  });

  it("a private room's list opens with the room's key at its epoch; without that key it is unavailable", () => {
    const sealed = JSON.stringify({ epoch: "4", sealed: nip44v2.encrypt(JSON.stringify({ entries: [good] }), conv) });
    const withKey = readPinList(sealed, room, { foldLoaded: true, convKeyAt: (e) => (e === 4 ? conv : undefined) });
    expect(withKey.status === "ok" && withKey.pins.length).toBe(1);
    expect(readPinList(sealed, room, { foldLoaded: true, convKeyAt: () => undefined }).status).toBe("unavailable");
  });

  it("no list at all is empty only once the group's settings have arrived; before that it is unavailable", () => {
    expect(readPinList(undefined, room, { foldLoaded: true })).toEqual({ status: "ok", pins: [] });
    expect(readPinList(undefined, room, { foldLoaded: false }).status).toBe("unavailable");
  });

  it("over 25 pins, or over 32,768 bytes, and the list reads as empty", () => {
    expect(readPinList(JSON.stringify({ entries: Array(26).fill(good) }), room, loaded)).toEqual({ status: "ok", pins: [] });
    expect(readPinList(JSON.stringify({ entries: [good], note: "x".repeat(33_000) }), room, loaded)).toEqual({ status: "ok", pins: [] });
  });
});
