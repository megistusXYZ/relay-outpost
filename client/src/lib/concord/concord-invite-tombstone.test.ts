import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import { pickBundleEvent, revokeInviteLink, refreshInviteLinks, encryptBundle, type InviteBundle } from "./concord-invites";
import { deriveCommunityId } from "./concord-crypto";
import { KIND_INVITE_BUNDLE, VSK } from "./concord-events";
import type { StoredCommunity, StoredInviteSigner } from "./concord-keys";

const linkSk = generateSecretKey();
const token = generateSecretKey().slice(0, 16);
const bundle = { community_id: "aa".repeat(32), owner: "bb".repeat(32), owner_salt: "cc".repeat(32), community_root: "dd".repeat(32), root_epoch: 0, channels: [], relays: [], name: "G" } as InviteBundle;
const live = (t: number): Event => finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: t, tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content: encryptBundle(bundle, token) }, linkSk);
const tomb = (t: number): Event => finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: t, tags: [["d", ""], ["vsk", String(VSK.REVOKED)]], content: "" }, linkSk);
const isTomb = (e: Event | null) => !!e?.tags.some((t) => t[0] === "vsk" && t[1] === String(VSK.REVOKED));

describe("a turned-off link stays off (CORD-05 §2)", () => {
  it("a tombstone wins over a bundle from the same second", () => {
    expect(isTomb(pickBundleEvent([live(100), tomb(100)]))).toBe(true);
    expect(isTomb(pickBundleEvent([tomb(100), live(100)]))).toBe(true);
  });

  it("a tombstone wins over a later bundle a stale device posted", () => {
    expect(isTomb(pickBundleEvent([tomb(100), live(200)]))).toBe(true);
  });

  it("otherwise the newest bundle, or nothing", () => {
    expect(pickBundleEvent([live(100), live(300), live(200)])?.created_at).toBe(300);
    expect(pickBundleEvent([])).toBeNull();
  });

  it("a tombstone is dated after the link's last bundle, even one from this very second", async () => {
    const out: Event[] = [];
    const lastBundle = Math.floor(Date.now() / 1000) + 5;
    await revokeInviteLink(bytesToHex(linkSk), ["wss://r.example"], async (e) => { out.push(e); }, lastBundle);
    expect(out[0].created_at).toBe(lastBundle + 1);
  });

  it("a refresh never re-posts a link whose address already holds a tombstone", async () => {
    const me = getPublicKey(generateSecretKey());
    const salt = bytesToHex(generateSecretKey());
    const community = {
      community_id: deriveCommunityId(me, salt), owner: me, owner_salt: salt, community_root: bytesToHex(generateSecretKey()),
      root_epoch: 1, channels: [], relays: ["wss://r.example"], name: "G", addedAt: 0,
    } as StoredCommunity;
    const link: StoredInviteSigner = {
      communityId: community.community_id, linkSignerPubkey: getPublicKey(linkSk), linkSignerSecret: bytesToHex(linkSk),
      token: bytesToHex(token), createdAt: 1,
    };
    const published: Event[] = [];
    await refreshInviteLinks(me, community, async (e) => { published.push(e); }, [link], async () => [live(100), tomb(150)]);
    expect(published).toEqual([]);
    await refreshInviteLinks(me, community, async (e) => { published.push(e); }, [link], async () => [live(100)]);
    expect(published).toHaveLength(1);
  });
});
