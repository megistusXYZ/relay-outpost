import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip19, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { refreshInviteLinks, decryptBundle } from "./concord-invites";
import { deriveCommunityId } from "./concord-crypto";
import type { StoredCommunity, StoredInviteSigner } from "./concord-keys";

describe("refreshing a link keeps what it says about itself (CORD-05 §1–2)", () => {
  it("a bundle refreshed after a key change keeps the link's name, expiry and creator", async () => {
    const me = getPublicKey(generateSecretKey());
    const salt = bytesToHex(generateSecretKey());
    const community = {
      community_id: deriveCommunityId(me, salt), owner: me, owner_salt: salt, community_root: bytesToHex(generateSecretKey()),
      root_epoch: 1, channels: [], relays: ["wss://r.example"], name: "Book Club", addedAt: 0,
    } as StoredCommunity;
    const sk = generateSecretKey();
    const token = generateSecretKey().slice(0, 16);
    const link: StoredInviteSigner = {
      communityId: community.community_id, linkSignerPubkey: getPublicKey(sk), linkSignerSecret: bytesToHex(sk),
      token: bytesToHex(token), label: "Flyer", createdAt: 1, expiresAt: 4_000_000_000_000,
    };
    const published: Event[] = [];
    await refreshInviteLinks(me, community, async (e) => { published.push(e); }, [link, { ...link, linkSignerPubkey: "turned-off", revoked: true }]);
    expect(published).toHaveLength(1);
    expect(decryptBundle(published[0].content, token)).toMatchObject({
      label: "Flyer", expires_at: 4_000_000_000_000, creator_npub: nip19.npubEncode(me), root_epoch: 1,
    });
  });
});
