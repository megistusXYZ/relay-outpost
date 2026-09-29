/**
 * Typing indicators on the wire, with real crypto. CORD-02 §5: every Chat
 * Plane seal MUST be encrypted (kind 20013); only the Control Plane may be
 * plaintext. Ephemeral events use the same wrap-and-seal shape with a 21059
 * outer wrap. We were sending typing in the plaintext 20014 seal, so a strict
 * client (Armada, Vector) could drop it.
 */
import { describe, it, expect } from "vitest";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { groupKey, unwrapStream, LABEL_CHANNEL, KIND_EPHEMERAL_WRAP, KIND_SEAL_ENC } from "./concord-crypto";
import { publishTyping, subscribeTyping } from "./concord-stream";
import type { StoredCommunity } from "./concord-keys";

describe("typing indicators in a room", () => {
  const root = new Uint8Array(32).fill(3);
  const ch = { id: "aa".repeat(32), epoch: 0, name: "general", isPrivate: false };
  const community: StoredCommunity = {
    community_id: bytesToHex(new Uint8Array(32).fill(2)), owner: getPublicKey(generateSecretKey()), owner_salt: "11".repeat(32),
    community_root: bytesToHex(root), root_epoch: 0, channels: [ch], relays: ["wss://r"], name: "G", addedAt: 0,
  };
  const plane = groupKey(LABEL_CHANNEL, root, ch.id, 0n);
  const sk = generateSecretKey();
  const me = getPublicKey(sk);
  const signer = { getPublicKey: async () => me, signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk) } as never;

  it("go out sealed encrypted in a wrap relays won't keep, and still reach the room", async () => {
    const sent: Event[] = [];
    await publishTyping(signer, me, community, ch, async (e: Event) => { sent.push(e); });
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe(KIND_EPHEMERAL_WRAP);
    expect(unwrapStream(plane, sent[0])?.kind).toBe(KIND_SEAL_ENC);

    const typists: string[] = [];
    subscribeTyping(community, ch, (pk) => typists.push(pk), (_relays, filter, onevent) => {
      for (const w of sent) if (filter.kinds.includes(w.kind) && filter.authors.includes(w.pubkey)) onevent(w);
      return { close: () => {} };
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(typists).toEqual([me]);
  });
});
