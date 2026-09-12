/**
 * An Armada poll and a vote, sealed and wrapped for real, arriving through the
 * room's live subscription. Routing them was half the fix; the subscription
 * also passed on only messages, replies, reactions, deletes, edits and timers,
 * so a routed poll still never reached the chat.
 */
import { describe, it, expect } from "vitest";
import { getPublicKey, generateSecretKey, getEventHash, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { groupKey, wrapStream, buildEncryptedSeal, planeConvKey, LABEL_CHANNEL } from "./concord-crypto";
import { subscribeChannel, type DecodedRumor } from "./concord-stream";
import type { StoredCommunity } from "./concord-keys";
import { KIND_POLL, buildVoteRumor } from "./concord-polls";

// Author signs a rumor's seal; plane wraps it — mirrors publishToPlane without a signer mock.
function authorEncryptedWrap(authorSk: Uint8Array, plane: ReturnType<typeof groupKey>, rumor: object, createdAt: number): Event {
  const rumorWithId = { ...rumor, id: getEventHash(rumor as never) };
  const seal = buildEncryptedSeal(getPublicKey(authorSk), JSON.stringify(rumorWithId), planeConvKey(plane), createdAt);
  const signedSeal = finalizeEvent({ kind: seal.kind, created_at: seal.created_at, tags: seal.tags, content: seal.content }, authorSk);
  return wrapStream(plane, signedSeal as never, createdAt);
}

describe("a poll made in Armada, arriving in the room", () => {
  const root = new Uint8Array(32).fill(3);
  const ch = { id: "aa".repeat(32), epoch: 0, name: "general", isPrivate: false };
  const community: StoredCommunity = {
    community_id: bytesToHex(new Uint8Array(32).fill(2)), owner: getPublicKey(generateSecretKey()), owner_salt: "11".repeat(32),
    community_root: bytesToHex(root), root_epoch: 0, channels: [ch], relays: ["wss://r"], name: "G", addedAt: 0,
  };
  const plane = groupKey(LABEL_CHANNEL, root, ch.id, 0n);
  const askerSk = generateSecretKey();
  const asker = getPublicKey(askerSk);
  const poll = {
    kind: KIND_POLL, pubkey: asker, created_at: 1_700_000_000, content: "Lunch?",
    tags: [["channel", ch.id], ["epoch", "0"], ["ms", "417"], ["option", "a1", "Tacos"], ["option", "b2", "Sushi"], ["polltype", "singlechoice"], ["alt", "Poll: Lunch?"]],
  };
  const pollId = getEventHash(poll as never);
  const vote = buildVoteRumor(asker, ch.id, 0n, pollId, ["a1"], 912, 1_700_000_010);
  const wraps = [authorEncryptedWrap(askerSk, plane, poll, poll.created_at), authorEncryptedWrap(askerSk, plane, vote, vote.created_at)];

  it("the poll and its vote both reach the chat", async () => {
    const got: DecodedRumor[] = [];
    subscribeChannel("viewer-" + Math.random(), community, ch, (r) => got.push(r), (_relays, filter, onevent) => {
      for (const w of wraps) if (filter.authors.includes(w.pubkey)) onevent(w);
      return { close: () => {} };
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(got.map((r) => r.kind).sort()).toEqual([1018, 1068]);
    expect(got.find((r) => r.kind === KIND_POLL)?.content).toBe("Lunch?");
  });
});
