/**
 * A new group is split from creation (CORD-02 §2): "32 random bytes minted by
 * the creator alongside the community_root, held only by the owner and staff".
 * Only the local IndexedDB writes are stubbed; everything that reaches the
 * wire is real.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  putCommunity: async () => {},
  publishCommunityList: async () => {},
}));

import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { createCommunity } from "./concord-community";
import { bundleFromCommunity, recordFromBundle } from "./concord-invites";
import { governancePlanes, decodeStreamEvent } from "./concord-stream";
import { parseControlEdition, foldEditions } from "./concord-events";
import { groupKey, LABEL_CONTROL_SIGNER } from "./concord-crypto";

const signer = (sk: Uint8Array) => ({
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;

describe("a new group is split from creation", () => {
  it("mints a staff-only control_root, writes its first settings at the split address, and whoever joins by invite reads them", async () => {
    const sk = generateSecretKey();
    const me = getPublicKey(sk);
    const published: Event[] = [];
    const record = await createCommunity(signer(sk), me,
      { name: "Book Club", about: "One book a month", relays: ["wss://r"] },
      async (e) => { published.push(e); }, async () => {});

    // The owner holds the secret, and it derives to the address members get.
    expect(record.control_root).toMatch(/^[0-9a-f]{64}$/);
    expect(groupKey(LABEL_CONTROL_SIGNER, hexToBytes(record.control_root!), record.community_id, 0n).pk).toBe(record.control_pk);

    // Invites hand out the address, never the staff secret.
    const bundle = bundleFromCommunity(record);
    expect(bundle.control_pk).toBe(record.control_pk);
    expect(JSON.stringify(bundle)).not.toContain(record.control_root!);

    // The first settings (name + #general) land at the split address.
    expect(published.filter((e) => e.pubkey === record.control_pk)).toHaveLength(2);

    // Someone who joins by that invite folds them.
    const joiner = recordFromBundle(bundle, []);
    const planes = new Map(governancePlanes(joiner).map((p) => [p.pk, p]));
    const editions = published.flatMap((e) => {
      const plane = planes.get(e.pubkey);
      const rumor = plane ? decodeStreamEvent(plane, e) : null;
      const edition = rumor ? parseControlEdition(rumor) : null;
      return edition ? [edition] : [];
    });
    const state = foldEditions(editions, me);
    expect(state.metadata?.name).toBe("Book Club");
    expect(state.metadata?.about).toBe("One book a month");
    expect([...state.channels.values()].map((c) => c.name)).toContain("general");
  });
});
