/**
 * Found on the wire (2026-09-12): Jump to an older pin asked the relays for
 * the hour around the message and got its wrap back, but decoded nothing.
 * subscribeChannel drops any wrap this device's stream ledger has seen, and
 * that ledger (IndexedDB) outlives the 1000-message cache, so a message
 * received once and later evicted could never be read again. A replay decodes
 * regardless; the room's own handler already ignores what it holds.
 */
import { describe, it, expect, vi } from "vitest";

// Every wrap has been processed before, as on a device that saw this room's
// history once and has since let the cache drop it.
vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  isStreamProcessed: async () => true,
  markStreamProcessed: async () => {},
}));

import { getPublicKey, generateSecretKey, getEventHash, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { groupKey, wrapStream, buildEncryptedSeal, planeConvKey, LABEL_CHANNEL } from "./concord-crypto";
import { subscribeChannel, type DecodedRumor } from "./concord-stream";
import { buildMessageRumor } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";

// Author signs a rumor's seal; plane wraps it — mirrors publishToPlane without a signer mock.
function authorEncryptedWrap(authorSk: Uint8Array, plane: ReturnType<typeof groupKey>, rumor: DecodedRumor, createdAt: number): Event {
  const rumorWithId = { ...rumor, id: getEventHash(rumor as never) };
  const seal = buildEncryptedSeal(getPublicKey(authorSk), JSON.stringify(rumorWithId), planeConvKey(plane), createdAt);
  const signedSeal = finalizeEvent({ kind: seal.kind, created_at: seal.created_at, tags: seal.tags, content: seal.content }, authorSk);
  return wrapStream(plane, signedSeal as never, createdAt);
}

describe("reading a room's history again", () => {
  const root = new Uint8Array(32).fill(3);
  const ch = { id: "aa".repeat(32), epoch: 0, name: "general", isPrivate: false };
  const community: StoredCommunity = {
    community_id: bytesToHex(new Uint8Array(32).fill(2)), owner: getPublicKey(generateSecretKey()), owner_salt: "11".repeat(32),
    community_root: bytesToHex(root), root_epoch: 0, channels: [ch], relays: ["wss://r"], name: "G", addedAt: 0,
  };
  const authorSk = generateSecretKey();
  const plane = groupKey(LABEL_CHANNEL, root, ch.id, 0n);
  const rumor = buildMessageRumor(getPublicKey(authorSk), ch.id, 0n, "pinned months ago", 5, 1_700_000_000) as unknown as DecodedRumor;
  const wrap = authorEncryptedWrap(authorSk, plane, rumor, 1_700_000_000);
  const relay = (_relays: string[], filter: { authors: string[] }, onevent: (e: Event) => void) => {
    if (filter.authors.includes(wrap.pubkey)) onevent(wrap);
    return { close: () => {} };
  };

  it("a live subscription skips a wrap this device has already processed", async () => {
    const got: string[] = [];
    subscribeChannel("viewer", community, ch, (r) => got.push(r.content), relay);
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([]);
  });

  it("a replay decodes it anyway, so Jump can reach a message the cache let go", async () => {
    const got: string[] = [];
    subscribeChannel("viewer", community, ch, (r) => got.push(r.content), relay, { replay: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual(["pinned months ago"]);
  });
});
