/**
 * Call presence on the wire, with real crypto: what one member sends into a
 * room arrives at everyone listening to it. It rides the ephemeral 21059 wrap
 * (relays don't keep it) with the ENCRYPTED 20013 seal, which CORD-02 §5
 * requires of every room message, and the room's typing chatter on the same
 * stream isn't mistaken for it.
 */
import { describe, it, expect } from "vitest";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { groupKey, unwrapStream, LABEL_CHANNEL, KIND_EPHEMERAL_WRAP, KIND_SEAL_ENC } from "./concord-crypto";
import { publishCallPresence, subscribeCallPresence, publishTyping } from "./concord-stream";
import type { StoredCommunity } from "./concord-keys";
import { KIND_CALL_PRESENCE } from "./concord-presence";

describe("call presence in a room", () => {
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

  it("reaches everyone in the room, sealed encrypted in a wrap relays won't keep, and typing isn't taken for it", async () => {
    const sent: Event[] = [];
    const publish = async (e: Event) => { sent.push(e); };
    await publishCallPresence(signer, me, community, ch, { state: "joined", identity: "seat-a", broker: "https://relayop.xyz" }, publish);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe(KIND_EPHEMERAL_WRAP);
    expect(unwrapStream(plane, sent[0])?.kind).toBe(KIND_SEAL_ENC);

    await publishTyping(signer, me, community, ch, publish);   // same stream, not presence
    const heard: { pubkey: string; content: string; tags: string[][] }[] = [];
    subscribeCallPresence(community, ch, (rumor) => heard.push(rumor), (_relays, filter, onevent) => {
      for (const w of sent) if (filter.kinds.includes(w.kind) && filter.authors.includes(w.pubkey)) onevent(w);
      return { close: () => {} };
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ pubkey: me, content: "joined", kind: KIND_CALL_PRESENCE });
    expect(heard[0].tags).toContainEqual(["identity", "seat-a"]);
  });
});
