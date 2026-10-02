import { describe, it, expect } from "vitest";
import {
  sealRow, openRow, isSealedRow, newDeviceKey,
  MESSAGE_SECRETS, MESSAGE_BOUND, CONVERSATION_SECRETS, CONVERSATION_BOUND,
} from "./dm-seal";

const OWNER = "aa".repeat(32);
const PEER = "bb".repeat(32);

const message = {
  id: "m1",
  ownerPubkey: OWNER,
  peerPubkey: PEER,
  content: "the door code is 4471",
  from: PEER,
  timestamp: 1_700_000_000,
  encryption: "nip17" as const,
  fileMetadata: { url: "https://files.example/x", encKey: "cd".repeat(32), encNonce: "ef".repeat(16) },
  quotedNoteId: "12".repeat(32),
  expiresAt: 1_800_000_000,
};

/** Everything a stored row would show to someone reading the device's storage. */
function visible(row: unknown): string {
  return JSON.stringify(row, (_k, v) =>
    v instanceof ArrayBuffer ? Buffer.from(v).toString("latin1")
    : ArrayBuffer.isView(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("latin1")
    : v);
}

describe("a stored private message", () => {
  it("comes back exactly as it went in", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    expect(await openRow(key, stored, MESSAGE_BOUND)).toEqual(message);
  });

  it("keeps its text, its sender, its file key and the quoted note out of what is stored", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    const seen = visible(stored);
    expect(seen).not.toContain("door code");
    expect(seen).not.toContain(message.fileMetadata.encKey);
    expect(seen).not.toContain(message.fileMetadata.url);
    expect(seen).not.toContain(message.quotedNoteId);
    expect("from" in stored).toBe(false);
    expect("content" in stored).toBe(false);
  });

  it("leaves in the clear only what the store looks rows up by", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    const { sealed, ...clear } = stored as Record<string, unknown>;
    expect(sealed).toBeTruthy();
    expect(clear).toEqual({
      id: "m1", ownerPubkey: OWNER, peerPubkey: PEER, timestamp: 1_700_000_000, expiresAt: 1_800_000_000,
    });
  });

  it("is sealed differently every time, so equal messages don't look equal", async () => {
    const key = await newDeviceKey();
    const a = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    const b = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    expect(visible(a.sealed)).not.toEqual(visible(b.sealed));
  });

  it("cannot be opened with another device's key", async () => {
    const stored = await sealRow(await newDeviceKey(), message, MESSAGE_SECRETS, MESSAGE_BOUND);
    expect(await openRow(await newDeviceKey(), stored, MESSAGE_BOUND)).toBeNull();
  });

  it("cannot be moved into another chat, or passed off as another message", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    expect(await openRow(key, { ...stored, peerPubkey: "cc".repeat(32) }, MESSAGE_BOUND)).toBeNull();
    expect(await openRow(key, { ...stored, id: "m2" }, MESSAGE_BOUND)).toBeNull();
    expect(await openRow(key, { ...stored, ownerPubkey: "cc".repeat(32) }, MESSAGE_BOUND)).toBeNull();
  });

  it("does not open once its sealed part has been altered", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND);
    const ct = new Uint8Array(stored.sealed.ct.slice(0));
    ct[0] ^= 1;
    expect(await openRow(key, { ...stored, sealed: { ...stored.sealed, ct: ct.buffer } }, MESSAGE_BOUND)).toBeNull();
  });
});

describe("a row stored before sealing existed", () => {
  it("is recognised as not sealed, and read as it is", async () => {
    const key = await newDeviceKey();
    expect(isSealedRow(message)).toBe(false);
    expect(await openRow(key, message, MESSAGE_BOUND)).toEqual(message);
  });

  it("is recognised as sealed once it has been", async () => {
    const key = await newDeviceKey();
    expect(isSealedRow(await sealRow(key, message, MESSAGE_SECRETS, MESSAGE_BOUND))).toBe(true);
  });
});

describe("a stored chat", () => {
  const chat = {
    ownerPubkey: OWNER, peerPubkey: PEER,
    lastMessage: "see you at nine", lastTimestamp: 1_700_000_500,
    subject: "Lisbon trip", subjectAt: 1_700_000_100,
  };

  it("keeps its preview and its name out of what is stored, and gives them back", async () => {
    const key = await newDeviceKey();
    const stored = await sealRow(key, chat, CONVERSATION_SECRETS, CONVERSATION_BOUND);
    const seen = visible(stored);
    expect(seen).not.toContain("see you at nine");
    expect(seen).not.toContain("Lisbon");
    const { sealed, ...clear } = stored as Record<string, unknown>;
    expect(sealed).toBeTruthy();
    expect(clear).toEqual({ ownerPubkey: OWNER, peerPubkey: PEER, lastTimestamp: 1_700_000_500 });
    expect(await openRow(key, stored, CONVERSATION_BOUND)).toEqual(chat);
  });

  it("with no name stores none and returns none", async () => {
    const key = await newDeviceKey();
    const plain = { ownerPubkey: OWNER, peerPubkey: PEER, lastMessage: "hi", lastTimestamp: 5 };
    const back = await openRow(key, await sealRow(key, plain, CONVERSATION_SECRETS, CONVERSATION_BOUND), CONVERSATION_BOUND);
    expect(back).toEqual(plain);
    expect("subject" in (back as object)).toBe(false);
  });
});

describe("the device key", () => {
  it("cannot be read out of the browser", async () => {
    const key = await newDeviceKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toBeTruthy();
  });
});
