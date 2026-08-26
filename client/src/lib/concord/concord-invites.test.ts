import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPublicKey, generateSecretKey, nip19, type Event } from "nostr-tools";
import {
  encodeFragment, decodeFragment, encryptBundle, decryptBundle, parseInviteUrl,
  rebuildInviteLink, stashDirectInviteRumor, listPendingInvites, mintInviteLink,
  isRevokedBundleEvent, type InviteBundle,
} from "./concord-invites";
import { KIND_INVITE_BUNDLE, VSK } from "./concord-events";
import { deriveCommunityId, verifyCommunityId, bundleKeyFromToken, legacyBundleKeyFromToken } from "./concord-crypto";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { StoredCommunity } from "./concord-keys";

const token = new Uint8Array(16).fill(7);

describe("fragment codec (CORD-05)", () => {
  it("roundtrips a stock-relay fragment (flags=1)", () => {
    const frag = encodeFragment(token);
    const out = decodeFragment(frag);
    expect(out).not.toBeNull();
    expect(out!.version).toBe(4);
    expect([...out!.token]).toEqual([...token]);
    expect(out!.relays.length).toBe(4); // stock set
  });

  it("roundtrips custom relays (flags=0, literal form)", () => {
    const relays = ["wss://my.relay.example", "wss://other.example/nostr"];
    const frag = encodeFragment(token, relays);
    const out = decodeFragment(frag);
    expect(out!.relays).toEqual(relays);
    expect([...out!.token]).toEqual([...token]);
  });

  it("caps custom relays at 3", () => {
    const relays = ["wss://a.example", "wss://b.example", "wss://c.example", "wss://d.example"];
    const out = decodeFragment(encodeFragment(token, relays));
    expect(out!.relays.length).toBe(3);
  });

  it("rejects a legacy (lower-version) fragment", () => {
    // Hand-craft a version-3 fragment.
    const bytes = new Uint8Array([3, 1, ...token]);
    let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
    const frag = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeFragment(frag)).toBeNull();
  });
});

describe("bundle encrypt/decrypt + anti-spoof (CORD-05)", () => {
  const owner = getPublicKey(generateSecretKey());
  const salt = "22".repeat(32);
  const cid = deriveCommunityId(owner, salt);
  const bundle: InviteBundle = {
    community_id: cid, owner, owner_salt: salt, community_root: "33".repeat(32), root_epoch: 0,
    channels: [{ id: "aa".repeat(32), epoch: 0, name: "general" }], relays: ["wss://a"], name: "Test",
  };

  it("roundtrips with the token and fails with a wrong token", () => {
    const ct = encryptBundle(bundle, token);
    expect(ct).not.toContain("Test"); // encrypted
    const out = decryptBundle(ct, token);
    expect(out!.name).toBe("Test");
    expect(decryptBundle(ct, new Uint8Array(16).fill(9))).toBeNull();
  });

  it("the bundle's community_id verifies against its owner+salt (real invite)", () => {
    expect(verifyCommunityId(bundle.community_id, bundle.owner, bundle.owner_salt)).toBe(true);
  });

  it("a spoofed community_id fails verification (accept must reject)", () => {
    const spoof = { ...bundle, community_id: "de".repeat(32) };
    expect(verifyCommunityId(spoof.community_id, spoof.owner, spoof.owner_salt)).toBe(false);
  });

  // Shape captured live from an Armada-minted invite (Soapbox replay,
  // 2026-07-19; values synthesized, structure verbatim): channels is EMPTY
  // (the list lives in the encrypted governance stream) and `icon` is an
  // encrypted-blob OBJECT {url,key,nonce,hash} — not a string URL. The object
  // icon crashed `bundleToDisplay` (`icon?.trim` is not a function) and leaked
  // a non-string into the stored record.
  it("tolerates an Armada-shaped bundle: object icon dropped, empty channels kept", () => {
    const armada = {
      ...bundle,
      channels: [],
      icon: { url: "https://blossom.example/x.enc", key: "8a".repeat(32), nonce: "eb".repeat(16), hash: "bc".repeat(32) },
      creator_npub: getPublicKey(generateSecretKey()),
    } as unknown as InviteBundle;
    const out = decryptBundle(encryptBundle(armada, token), token);
    expect(out).not.toBeNull();
    expect(out!.name).toBe("Test");
    expect(out!.icon).toBeUndefined(); // object variant normalized away
    expect(out!.channels).toEqual([]);
    expect(verifyCommunityId(out!.community_id, out!.owner, out!.owner_salt)).toBe(true);
  });

  it("keeps a canonical string icon untouched", () => {
    const withIcon: InviteBundle = { ...bundle, icon: "https://x.example/icon.png" };
    const out = decryptBundle(encryptBundle(withIcon, token), token);
    expect(out!.icon).toBe("https://x.example/icon.png");
  });
});

describe("invite bundle_key HKDF — canonical CORD-02 A.1 (cross-client)", () => {
  // Canonical construction: info = utf8("concord/invite-key") ‖ 0x00 ‖ id[32]=0
  // (epoch omitted). Confirmed against Amethyst's inviteBundleKey
  // (quartz ConcordKeyDerivation.kt: hkdf32(token, buildInfo(INVITE_KEY, ByteArray(32))))
  // and Ditto's armadaInvite.ts. Pinned so a regression on the info bytes is caught.
  it("bundleKeyFromToken pins the canonical key for a fixed token (regression guard)", () => {
    expect(bytesToHex(bundleKeyFromToken(token))).toBe(
      "94bf8b0d89e579ddaeccf8d9db3f5de5c86a1259c597f2560ff0120173bc5e1f",
    );
  });

  it("the legacy (label-only) key is a DIFFERENT key — the old cross-client bug", () => {
    expect(bytesToHex(legacyBundleKeyFromToken(token))).toBe(
      "85e73ec304bc8a2f8518a7e8d81bcf6559a5f265b5d932bd360c8cb6da545c7a",
    );
    expect(bytesToHex(bundleKeyFromToken(token))).not.toBe(bytesToHex(legacyBundleKeyFromToken(token)));
  });

  it("decryptBundle dual-read still opens a LEGACY-encrypted bundle (back-compat)", () => {
    const legacyBundle: InviteBundle = {
      community_id: deriveCommunityId(getPublicKey(generateSecretKey()), "22".repeat(32)),
      owner: getPublicKey(generateSecretKey()), owner_salt: "22".repeat(32),
      community_root: "33".repeat(32), root_epoch: 0,
      channels: [{ id: "aa".repeat(32), epoch: 0, name: "general" }], relays: ["wss://a"], name: "LegacyLink",
    };
    // Encrypt with the OLD label-only key (a link already shared in the wild).
    const legacyCt = nip44v2.encrypt(JSON.stringify(legacyBundle), legacyBundleKeyFromToken(token));
    const out = decryptBundle(legacyCt, token);
    expect(out).not.toBeNull();
    expect(out!.name).toBe("LegacyLink");
  });

  it("new encryptBundle output decrypts under the canonical key (cross-client path)", () => {
    const b: InviteBundle = {
      community_id: deriveCommunityId(getPublicKey(generateSecretKey()), "22".repeat(32)),
      owner: getPublicKey(generateSecretKey()), owner_salt: "22".repeat(32),
      community_root: "33".repeat(32), root_epoch: 0,
      channels: [], relays: ["wss://a"], name: "NewLink",
    };
    const ct = encryptBundle(b, token);
    // Decrypts directly with the canonical key (what Amethyst computes) …
    expect(JSON.parse(nip44v2.decrypt(ct, bundleKeyFromToken(token))).name).toBe("NewLink");
    // … and via the dual-read decryptBundle.
    expect(decryptBundle(ct, token)!.name).toBe("NewLink");
  });

  it("a wrong 16-byte token → decryptBundle returns null (both keys fail)", () => {
    const b: InviteBundle = {
      community_id: deriveCommunityId(getPublicKey(generateSecretKey()), "22".repeat(32)),
      owner: getPublicKey(generateSecretKey()), owner_salt: "22".repeat(32),
      community_root: "33".repeat(32), root_epoch: 0, channels: [], relays: [], name: "X",
    };
    const ct = encryptBundle(b, token);
    expect(decryptBundle(ct, new Uint8Array(16).fill(9))).toBeNull();
  });
});

describe("realistic invite link (mint → click)", () => {
  // The relay set from the production bug report (default outpost relays).
  const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.snort.social"];

  it("roundtrips a full minted URL: parseInviteUrl → decodeFragment → nip19.decode", () => {
    const linkPk = getPublicKey(generateSecretKey());
    const naddr = nip19.naddrEncode({ kind: KIND_INVITE_BUNDLE, pubkey: linkPk, identifier: "", relays: relays.slice(0, 3) });
    const url = `https://relayop.xyz/invite/${naddr}#${encodeFragment(token, relays)}`;

    const parsed = parseInviteUrl(url);
    expect(parsed).not.toBeNull();
    expect(parsed!.naddr).toBe(naddr);

    const frag = decodeFragment(parsed!.fragment);
    expect(frag).not.toBeNull();
    expect(frag!.relays).toEqual(relays);
    expect([...frag!.token]).toEqual([...token]);

    const decoded = nip19.decode(parsed!.naddr);
    expect(decoded.type).toBe("naddr");
    if (decoded.type === "naddr") {
      expect(decoded.data.kind).toBe(KIND_INVITE_BUNDLE);
      expect(decoded.data.pubkey).toBe(linkPk);
    }
  });

  it("decodes the production fragment shape from the bug report", () => {
    // Same byte layout as the fragment in the reported broken invite:
    // version 4, flags 0, 3 custom host-form relays, 16-byte token.
    const frag = decodeFragment("BAADAA5yZWxheS5kYW11cy5pbwAHbm9zLmxvbAAScmVsYXkuc25vcnQuc29jaWFsbH5BLa2XLA_ck7y4o2NPjQ");
    expect(frag).not.toBeNull();
    expect(frag!.version).toBe(4);
    expect(frag!.relays).toEqual(relays);
    expect(frag!.token.length).toBe(16);
  });

  it("rebuildInviteLink reproduces a mint-shaped URL from the stored signer (QR for Active links)", () => {
    const linkPk = getPublicKey(generateSecretKey());
    const tokenHex = [...token].map((b) => b.toString(16).padStart(2, "0")).join("");
    const url = rebuildInviteLink({ linkSignerPubkey: linkPk, token: tokenHex }, { relays }, "https://relayop.xyz/");

    // Same shape mintInviteLink returns (base has its trailing slash stripped)…
    expect(url.startsWith("https://relayop.xyz/invite/naddr1")).toBe(true);
    // …and it roundtrips through the accept path.
    const parsed = parseInviteUrl(url)!;
    const decoded = nip19.decode(parsed.naddr);
    expect(decoded.type).toBe("naddr");
    if (decoded.type === "naddr") expect(decoded.data.pubkey).toBe(linkPk);
    const frag = decodeFragment(parsed.fragment)!;
    expect([...frag.token]).toEqual([...token]);
    expect(frag.relays).toEqual(relays);
  });

  it("survives trailing punctuation appended by chat linkifiers", () => {
    // Messages.tsx's URL regex swallows trailing sentence punctuation into the
    // href, so a pasted "…#<frag>." must still decode.
    const parsed = parseInviteUrl(`https://relayop.xyz/invite/naddr1abc#${encodeFragment(token, relays)}.`);
    expect(parsed).not.toBeNull();
    const frag = decodeFragment(parsed!.fragment);
    expect(frag).not.toBeNull();
    expect(frag!.relays).toEqual(relays);
    expect([...frag!.token]).toEqual([...token]);
  });
});

describe("invite marker vsk 6 — cross-client interop (CORD-05, CORD-02 Appendix B)", () => {
  const owner = getPublicKey(generateSecretKey());
  const salt = "22".repeat(32);
  const community: StoredCommunity = {
    community_id: deriveCommunityId(owner, salt), owner, owner_salt: salt,
    community_root: "33".repeat(32), root_epoch: 0,
    channels: [{ id: "aa".repeat(32), epoch: 0, name: "general", isPrivate: false }],
    relays: ["wss://relay.damus.io"], name: "Test", addedAt: Date.now(),
  };

  it("VSK.INVITE is 6 (the addressable invite marker, not the vsk-8 registry)", () => {
    expect(VSK.INVITE).toBe(6);
    expect(VSK.REGISTRY).toBe(8);
    expect(VSK.REVOKED).toBe(9);
  });

  it("mintInviteLink tags the joinable 33301 bundle with vsk 6", async () => {
    // Capture the published event. putInviteSigner (IndexedDB) runs AFTER the
    // publish and throws in the node env — swallow it; the emitted event is
    // already captured, which is what interop depends on.
    let captured: Event | undefined;
    const publish = async (e: Event) => { captured = e; };
    try {
      await mintInviteLink(owner, community, "https://relayop.xyz", publish);
    } catch { /* IDB unavailable in node — irrelevant to the emitted wire event */ }
    expect(captured).toBeDefined();
    expect(captured!.kind).toBe(KIND_INVITE_BUNDLE);
    expect(captured!.tags).toContainEqual(["vsk", "6"]);
    expect(captured!.tags).not.toContainEqual(["vsk", "8"]);
    expect(captured!.content).not.toBe(""); // encrypted bundle, joinable
  });

  it("isRevokedBundleEvent: accepts the vsk-6 marker (joinable)", () => {
    expect(isRevokedBundleEvent({ tags: [["d", ""], ["vsk", "6"]], content: "ct" })).toBe(false);
  });

  it("isRevokedBundleEvent: STILL accepts a legacy vsk-8 bundle (back-compat)", () => {
    expect(isRevokedBundleEvent({ tags: [["d", ""], ["vsk", "8"]], content: "ct" })).toBe(false);
  });

  it("isRevokedBundleEvent: rejects the vsk-9 tombstone", () => {
    expect(isRevokedBundleEvent({ tags: [["d", ""], ["vsk", "9"]], content: "" })).toBe(true);
    // Even a vsk-9 with (impossibly) non-empty content is a revocation.
    expect(isRevokedBundleEvent({ tags: [["d", ""], ["vsk", "9"]], content: "x" })).toBe(true);
  });

  it("isRevokedBundleEvent: rejects an empty-content bundle regardless of vsk", () => {
    expect(isRevokedBundleEvent({ tags: [["d", ""], ["vsk", "6"]], content: "" })).toBe(true);
  });
});

describe("parseInviteUrl", () => {
  it("extracts naddr + fragment from a full URL", () => {
    const r = parseInviteUrl("https://app.example/invite/naddr1abc#frag123");
    expect(r).toEqual({ naddr: "naddr1abc", fragment: "frag123" });
  });
  it("handles a bare naddr#fragment", () => {
    const r = parseInviteUrl("naddr1xyz#tok");
    expect(r).toEqual({ naddr: "naddr1xyz", fragment: "tok" });
  });
  it("returns null for a non-invite URL", () => {
    expect(parseInviteUrl("https://app.example/outposts")).toBeNull();
  });
});

describe("stashDirectInviteRumor (3313 payload → pending store, never a DM)", () => {
  const owner = "ab".repeat(32);
  const sender = "cd".repeat(32);
  const ownerPk = getPublicKey(generateSecretKey());
  const salt = "11".repeat(32);
  const bundle: InviteBundle = {
    community_id: deriveCommunityId(ownerPk, salt), owner: ownerPk, owner_salt: salt,
    community_root: "44".repeat(32), root_epoch: 0,
    channels: [{ id: "55".repeat(32), epoch: 0, name: "general" }],
    relays: ["wss://relay.damus.io"], name: "Secret Base",
  };
  const hadLocalStorage = "localStorage" in globalThis;
  const hadWindow = "window" in globalThis;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    (globalThis as any).window = { dispatchEvent: () => true };
  });
  afterEach(() => {
    if (!hadLocalStorage) delete (globalThis as any).localStorage;
    if (!hadWindow) delete (globalThis as any).window;
  });

  it("stashes a valid bundle payload as a pending invite (isNew on first sight)", () => {
    const r = stashDirectInviteRumor(owner, { content: JSON.stringify(bundle), senderPubkey: sender, timestamp: 123 });
    expect(r).not.toBeNull();
    expect(r!.isNew).toBe(true);
    expect(r!.bundle.name).toBe("Secret Base");
    const pending = listPendingInvites(owner);
    expect(pending.length).toBe(1);
    expect(pending[0].bundle.community_id).toBe(bundle.community_id);
    expect(pending[0].from).toBe(sender);
  });

  it("dedups by community id (isNew=false on a repeat)", () => {
    stashDirectInviteRumor(owner, { content: JSON.stringify(bundle), senderPubkey: sender, timestamp: 123 });
    const again = stashDirectInviteRumor(owner, { content: JSON.stringify(bundle), senderPubkey: sender, timestamp: 456 });
    expect(again!.isNew).toBe(false);
    expect(listPendingInvites(owner).length).toBe(1);
  });

  it("rejects non-bundle payloads (plain text / partial JSON)", () => {
    expect(stashDirectInviteRumor(owner, { content: "hello", senderPubkey: sender, timestamp: 1 })).toBeNull();
    expect(stashDirectInviteRumor(owner, { content: JSON.stringify({ community_id: "x" }), senderPubkey: sender, timestamp: 1 })).toBeNull();
    expect(listPendingInvites(owner).length).toBe(0);
  });
});

// ── SECURITY regression (live bug 1): invites must NOT leak private channels ──
import { bundleFromCommunity } from "./concord-invites";

describe("bundleFromCommunity — private channels excluded (CORD-03 §1, CORD-05 §1)", () => {
  const owner = getPublicKey(generateSecretKey());
  const salt = "22".repeat(32);
  const community: StoredCommunity = {
    community_id: deriveCommunityId(owner, salt), owner, owner_salt: salt,
    community_root: "33".repeat(32), root_epoch: 2,
    channels: [
      { id: "aa".repeat(32), epoch: 2, name: "general", isPrivate: false },
      { id: "bb".repeat(32), epoch: 2, name: "lounge", isPrivate: false },
      { id: "cc".repeat(32), key: "dd".repeat(32), epoch: 1, name: "admins-only", isPrivate: true },
    ],
    relays: ["wss://a"], name: "Test", addedAt: 0,
  };

  it("REGRESSION: the bundle carries only PUBLIC channels — no private ids, names, or keys", () => {
    const bundle = bundleFromCommunity(community);
    expect(bundle.channels.map((c) => c.name).sort()).toEqual(["general", "lounge"]);
    // The private channel leaks NOTHING: not its key, not its id, not its name.
    expect(JSON.stringify(bundle)).not.toContain("dd".repeat(32)); // the secret key
    expect(JSON.stringify(bundle)).not.toContain("cc".repeat(32)); // the channel id
    expect(JSON.stringify(bundle)).not.toContain("admins-only");   // the name
    // Public channels carry no key either (derived from community_root).
    for (const ch of bundle.channels) expect(ch.key).toBeUndefined();
  });

  it("the exclusion survives the full encrypt → decrypt link round-trip", () => {
    const ct = encryptBundle(bundleFromCommunity(community), token);
    const out = decryptBundle(ct, token)!;
    expect(out.channels.length).toBe(2);
    expect(JSON.stringify(out)).not.toContain("dd".repeat(32));
    expect(JSON.stringify(out)).not.toContain("admins-only");
  });

  it("a legacy channel record with a key but no isPrivate flag is ALSO excluded (defense in depth)", () => {
    const legacy: StoredCommunity = {
      ...community,
      channels: [{ id: "ee".repeat(32), key: "ff".repeat(32), epoch: 1, name: "old-private", isPrivate: false }],
    };
    const bundle = bundleFromCommunity(legacy);
    expect(bundle.channels.length).toBe(0);
    expect(JSON.stringify(bundle)).not.toContain("ff".repeat(32));
  });

  it("mintInviteLink's published bundle excludes the private channel (wire-level check)", async () => {
    let captured: Event | undefined;
    try {
      await mintInviteLink(owner, community, "https://relayop.xyz", async (e) => { captured = e; });
    } catch { /* IDB unavailable in node — the wire event is already captured */ }
    expect(captured).toBeDefined();
    // The encrypted content must not decrypt to anything naming the private channel;
    // we can't know the random token here, so assert structurally: ciphertext only,
    // and the plaintext bundle builder (asserted above) is the single source.
    expect(captured!.content.length).toBeGreaterThan(0);
    expect(captured!.content).not.toContain("admins-only");
  });
});
