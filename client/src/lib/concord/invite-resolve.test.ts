import { describe, it, expect, beforeEach } from "vitest";
import { getPublicKey, generateSecretKey, nip19 } from "nostr-tools";
import {
  bundleToDisplay,
  deriveInviteResolveParams,
  resolveInviteBundle,
  __clearInviteBundleCache,
} from "./invite-resolve";
import { encodeFragment, encryptBundle, type InviteBundle } from "./concord-invites";
import { KIND_INVITE_BUNDLE, VSK } from "./concord-events";
import { finalizeEvent, type Event } from "nostr-tools";

const baseBundle: InviteBundle = {
  community_id: "aa".repeat(32),
  owner: "bb".repeat(32),
  owner_salt: "cc".repeat(32),
  community_root: "dd".repeat(32),
  root_epoch: 1,
  channels: [
    { id: "11".repeat(32), epoch: 1, name: "general" },
    { id: "22".repeat(32), epoch: 1, name: "random" },
  ],
  relays: ["wss://relay.example"],
  name: "Cool Group",
  icon: "https://img.example/icon.png",
};

describe("bundleToDisplay (pure mapping)", () => {
  it("maps name → title, icon → photo, channels → 'N channels · encrypted'", () => {
    expect(bundleToDisplay(baseBundle)).toEqual({
      photo: "https://img.example/icon.png",
      title: "Cool Group",
      subtitle: "2 channels · encrypted",
    });
  });

  it("prefers the bundle label/description for the subtitle when present", () => {
    expect(bundleToDisplay({ ...baseBundle, label: "Founders only" }).subtitle).toBe("Founders only");
  });

  it("singularizes a one-channel group", () => {
    expect(bundleToDisplay({ ...baseBundle, channels: [baseBundle.channels[0]] }).subtitle).toBe("1 channel · encrypted");
  });

  it("falls back to the generic title when name is missing/blank", () => {
    expect(bundleToDisplay({ ...baseBundle, name: "" }).title).toBe("Group chat invite");
    expect(bundleToDisplay({ ...baseBundle, name: "   " }).title).toBe("Group chat invite");
  });

  it("falls back to the generic subtitle when there is no label AND no channels", () => {
    expect(bundleToDisplay({ ...baseBundle, label: undefined, channels: [] }).subtitle).toBe(
      "Join this encrypted group in Relay Outpost",
    );
  });

  it("leaves photo undefined (→ lock glyph) when there is no icon", () => {
    expect(bundleToDisplay({ ...baseBundle, icon: undefined }).photo).toBeUndefined();
    expect(bundleToDisplay({ ...baseBundle, icon: "  " }).photo).toBeUndefined();
  });

  it("never throws on an Armada-shaped bundle (object icon, empty channels)", () => {
    // Armada carries `icon` as an encrypted-blob OBJECT; `icon?.trim()` threw
    // and the card crashed instead of rendering the generic fallback.
    const armada = {
      ...baseBundle,
      channels: [],
      label: undefined,
      icon: { url: "https://blossom.example/x.enc", key: "8a".repeat(32), nonce: "eb".repeat(16), hash: "bc".repeat(32) },
    } as unknown as typeof baseBundle;
    expect(bundleToDisplay(armada)).toEqual({
      photo: undefined,
      title: "Cool Group",
      subtitle: "Join this encrypted group in Relay Outpost",
    });
  });
});

describe("deriveInviteResolveParams (naddr + token extraction)", () => {
  const linkSk = generateSecretKey();
  const linkPk = getPublicKey(linkSk);
  const token = new Uint8Array(16).fill(9);
  const naddr = nip19.naddrEncode({ kind: KIND_INVITE_BUNDLE, pubkey: linkPk, identifier: "", relays: ["wss://coord.example"] });
  const fragment = encodeFragment(token, ["wss://boot.example"]);

  it("pulls link_signer, union of relays, and the 16-byte token from a real link", () => {
    const params = deriveInviteResolveParams({ naddr, fragment });
    expect(params).not.toBeNull();
    expect(params!.linkSigner).toBe(linkPk);
    expect([...params!.token]).toEqual([...token]);
    expect(params!.relays).toEqual(expect.arrayContaining(["wss://coord.example", "wss://boot.example"]));
  });

  it("returns null when the link carries no fragment (nothing to decrypt)", () => {
    expect(deriveInviteResolveParams({ naddr, fragment: "" })).toBeNull();
  });

  it("returns null for a malformed fragment", () => {
    expect(deriveInviteResolveParams({ naddr, fragment: "!!!not-base64url!!!" })).toBeNull();
  });

  it("returns null when the naddr is the wrong kind (not an invite bundle)", () => {
    const wrong = nip19.naddrEncode({ kind: 30023, pubkey: linkPk, identifier: "post" });
    expect(deriveInviteResolveParams({ naddr: wrong, fragment })).toBeNull();
  });

  it("returns null for a corrupted naddr", () => {
    expect(deriveInviteResolveParams({ naddr: naddr.slice(0, -4) + "qqqq", fragment })).toBeNull();
  });
});

describe("resolveInviteBundle (fetch + decrypt, cached)", () => {
  const linkSk = generateSecretKey();
  const linkPk = getPublicKey(linkSk);
  const token = new Uint8Array(16).fill(3);
  const naddr = nip19.naddrEncode({ kind: KIND_INVITE_BUNDLE, pubkey: linkPk, identifier: "" });
  const fragment = encodeFragment(token);

  const bundleEvent = (): Event =>
    finalizeEvent(
      { kind: KIND_INVITE_BUNDLE, created_at: 1, tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content: encryptBundle(baseBundle, token) },
      linkSk,
    );

  beforeEach(() => __clearInviteBundleCache());

  it("fetches, decrypts, and returns the bundle", async () => {
    const out = await resolveInviteBundle({ naddr, fragment }, async () => bundleEvent());
    expect(out?.name).toBe("Cool Group");
  });

  it("caches by naddr — a second resolve does NOT hit the network", async () => {
    let calls = 0;
    const fetchEvent = async () => { calls++; return bundleEvent(); };
    await resolveInviteBundle({ naddr, fragment }, fetchEvent);
    await resolveInviteBundle({ naddr, fragment }, fetchEvent);
    expect(calls).toBe(1);
  });

  it("returns null (→ generic card) for a revoked tombstone", async () => {
    const tomb = finalizeEvent({ kind: KIND_INVITE_BUNDLE, created_at: 2, tags: [["d", ""], ["vsk", String(VSK.REVOKED)]], content: "" }, linkSk);
    expect(await resolveInviteBundle({ naddr, fragment }, async () => tomb)).toBeNull();
  });

  it("returns null for an expired bundle", async () => {
    const expired = finalizeEvent(
      { kind: KIND_INVITE_BUNDLE, created_at: 3, tags: [["d", ""], ["vsk", String(VSK.INVITE)]], content: encryptBundle({ ...baseBundle, expires_at: 1 }, token) },
      linkSk,
    );
    expect(await resolveInviteBundle({ naddr, fragment }, async () => expired)).toBeNull();
  });

  it("returns null when the relays yield no event, and does NOT poison the cache", async () => {
    expect(await resolveInviteBundle({ naddr, fragment }, async () => null)).toBeNull();
    // A later render finds the event: transient miss must not be cached.
    const out = await resolveInviteBundle({ naddr, fragment }, async () => bundleEvent());
    expect(out?.name).toBe("Cool Group");
  });

  it("returns null for a link with no fragment", async () => {
    expect(await resolveInviteBundle({ naddr, fragment: "" }, async () => bundleEvent())).toBeNull();
  });
});
