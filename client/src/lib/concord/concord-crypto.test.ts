import { describe, it, expect } from "vitest";
import { getPublicKey, generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  groupKey,
  deriveCommunityId,
  verifyCommunityId,
  wrapStream,
  unwrapStream,
  buildPlainSeal,
  buildEncryptedSeal,
  openSeal,
  bundleKeyFromToken,
  computeLocator,
  channelRekeyAddress,
  baseRekeyAddress,
  guestbookAddress,
  deriveSnapshotId,
  epochKeyCommitment,
  planeConvKey,
  randomBytes32,
  KIND_STREAM_WRAP,
  KIND_SEAL_PLAIN,
  KIND_SEAL_ENC,
  LABEL_CONTROL,
  LABEL_CHANNEL,
  LABEL_GUESTBOOK,
  type Seal,
} from "./concord-crypto";

const secret = new Uint8Array(32).fill(7);
const id32 = bytesToHex(new Uint8Array(32).fill(3));
const otherId = bytesToHex(new Uint8Array(32).fill(4));

describe("groupKey (CORD-02)", () => {
  it("is deterministic for identical inputs", () => {
    const a = groupKey(LABEL_CONTROL, secret, id32, 1n);
    const b = groupKey(LABEL_CONTROL, secret, id32, 1n);
    expect(a.pk).toBe(b.pk);
    expect(bytesToHex(a.sk)).toBe(bytesToHex(b.sk));
  });

  it("produces a valid x-only pubkey (64 lowercase hex)", () => {
    const k = groupKey(LABEL_CONTROL, secret, id32, 1n);
    expect(k.pk).toMatch(/^[0-9a-f]{64}$/);
    expect(getPublicKey(k.sk)).toBe(k.pk); // sk↔pk consistent
  });

  it("rotates the key when the epoch changes", () => {
    const e1 = groupKey(LABEL_CHANNEL, secret, id32, 1n);
    const e2 = groupKey(LABEL_CHANNEL, secret, id32, 2n);
    expect(e1.pk).not.toBe(e2.pk);
  });

  it("separates planes by label and by id", () => {
    const control = groupKey(LABEL_CONTROL, secret, id32, 1n);
    const channel = groupKey(LABEL_CHANNEL, secret, id32, 1n);
    const otherChannel = groupKey(LABEL_CHANNEL, secret, otherId, 1n);
    expect(control.pk).not.toBe(channel.pk);
    expect(channel.pk).not.toBe(otherChannel.pk);
  });

  it("supports epoch-less derivation (distinct from epoch 0)", () => {
    const none = groupKey(LABEL_CONTROL, secret, id32);
    const zero = groupKey(LABEL_CONTROL, secret, id32, 0n);
    expect(none.pk).not.toBe(zero.pk);
  });

  it("rejects a non-32-byte id", () => {
    expect(() => groupKey(LABEL_CONTROL, secret, "abcd", 1n)).toThrow();
  });
});

describe("deriveCommunityId (CORD-02)", () => {
  const owner = getPublicKey(generateSecretKey()); // x-only hex
  const salt = randomBytes32();

  it("is deterministic and 64 hex chars", () => {
    const a = deriveCommunityId(owner, salt);
    const b = deriveCommunityId(owner, bytesToHex(salt));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with a different salt", () => {
    expect(deriveCommunityId(owner, salt)).not.toBe(deriveCommunityId(owner, randomBytes32()));
  });

  it("verifyCommunityId accepts the real owner+salt and rejects a wrong salt", () => {
    const cid = deriveCommunityId(owner, salt);
    expect(verifyCommunityId(cid, owner, salt)).toBe(true);
    expect(verifyCommunityId(cid, owner, randomBytes32())).toBe(false);
  });
});

describe("stream wrap/unwrap (CORD-01, reversed NIP-59)", () => {
  const plane = groupKey(LABEL_CONTROL, secret, id32, 1n);
  const seal: Seal = buildPlainSeal("aa".repeat(32), JSON.stringify({ kind: 9, content: "hi" }), 1_700_000_000);

  it("roundtrips a seal through wrap → unwrap", () => {
    const wrap = wrapStream(plane, seal, 1_700_000_000);
    expect(wrap.kind).toBe(KIND_STREAM_WRAP);
    expect(wrap.pubkey).toBe(plane.pk); // fixed author = plane key
    expect(wrap.tags[0][0]).toBe("p"); // ephemeral p tag
    const out = unwrapStream(plane, wrap);
    expect(out).not.toBeNull();
    expect(out!.content).toBe(seal.content);
    expect(out!.kind).toBe(KIND_SEAL_PLAIN);
  });

  it("uses a fresh ephemeral p tag each wrap (unlinkable)", () => {
    const w1 = wrapStream(plane, seal, 1_700_000_000);
    const w2 = wrapStream(plane, seal, 1_700_000_000);
    expect(w1.tags[0][1]).not.toBe(w2.tags[0][1]);
  });

  it("returns null for the wrong plane key", () => {
    const wrap = wrapStream(plane, seal, 1_700_000_000);
    const wrongPlane = groupKey(LABEL_CHANNEL, secret, id32, 1n);
    expect(unwrapStream(wrongPlane, wrap)).toBeNull();
  });

  it("returns null for tampered content", () => {
    const wrap = wrapStream(plane, seal, 1_700_000_000);
    const tampered = { ...wrap, content: wrap.content.slice(0, -2) + "00" };
    expect(unwrapStream(plane, tampered)).toBeNull();
  });

  it("returns null for a non-1059 event", () => {
    const wrap = wrapStream(plane, seal, 1_700_000_000);
    expect(unwrapStream(plane, { ...wrap, kind: 1 })).toBeNull();
  });
});

describe("seals", () => {
  it("plaintext seal preserves rumor bytes verbatim", () => {
    const rumor = JSON.stringify({ kind: 9, content: "exact" });
    const s = buildPlainSeal("bb".repeat(32), rumor, 1_700_000_000);
    expect(s.kind).toBe(KIND_SEAL_PLAIN);
    expect(openSeal(s)).toBe(rumor);
  });

  it("encrypted seal roundtrips with its key and fails without it", () => {
    const rumor = JSON.stringify({ kind: 9, content: "secret" });
    const sealKey = randomBytes32();
    const s = buildEncryptedSeal("cc".repeat(32), rumor, sealKey, 1_700_000_000);
    expect(s.kind).toBe(KIND_SEAL_ENC);
    expect(s.content).not.toContain("secret"); // actually encrypted
    expect(openSeal(s, sealKey)).toBe(rumor);
    expect(openSeal(s)).toBeNull(); // no key
    expect(openSeal(s, randomBytes32())).toBeNull(); // wrong key
  });
});

/**
 * Cross-client conformance: byte-for-byte golden vectors from the Vector
 * reference client (Rust `vector-core`, `community/v2/derive.rs` + `rekey.rs`).
 * These are the acceptance oracle for Concord crypto interop — if any assertion
 * drifts, our construction has diverged from Vector/Amethyst and messages or
 * rekeys will fail to cross clients.
 *
 * Test helpers mirror Vector's:
 *   secret() = [0x00, 0x01, .., 0x1f]      (i as u8)
 *   id32()   = [0xff, 0xfe, .., 0xe0]      (255 - i as u8)
 */
describe("Vector golden vectors (cross-client conformance)", () => {
  const vSecret = Uint8Array.from({ length: 32 }, (_, i) => i);
  const vId = bytesToHex(Uint8Array.from({ length: 32 }, (_, i) => (255 - i) & 0xff));

  it("epoch_key_commitment(Epoch(2), secret()) matches Vector", () => {
    // Vector: sha256("concord/epoch-key-commitment" ‖ epoch_be[8] ‖ key[32])
    expect(epochKeyCommitment(2n, vSecret)).toBe(
      "3e6d6a3c9973c16d1ca7c5602d36979927c55c21a7e2c840f883af3f047e80a4",
    );
  });

  it('group_key("concord/channel", secret(), chan(), Epoch(0)) seed+pk match Vector', () => {
    const gk = groupKey(LABEL_CHANNEL, vSecret, vId, 0n);
    expect(bytesToHex(gk.sk)).toBe(
      "1a99a5958bf9fcc5336e6e19db42aabf36ffbfa12f38a1d5fbde2ae383ed751b",
    );
    expect(gk.pk).toBe(
      "7a5c5dff759a63f1fc2779864487432bae3d1ea72c4ffabd39f4c1fdaf62097a",
    );
  });

  it('group_key("concord/channel", secret(), chan(), Epoch(0x0102030405060708)) pk matches Vector', () => {
    const gk = groupKey(LABEL_CHANNEL, vSecret, vId, 0x0102030405060708n);
    expect(gk.pk).toBe(
      "f20c7d192cc87615d7341e86f38f85303f4708b40232d4fea521ab8217767391",
    );
  });

  it("CORD-06 §2 channel rekey-pseudonym address matches Vector's GOLDEN_CHANNEL_REKEY_E1_PK", () => {
    // Vector derive.rs: channel_rekey_group_key(secret(), chan(), Epoch(1)).
    // Independent-implementation golden — a match proves a Vector-minted channel
    // rekey and ours land at the SAME on-wire address.
    expect(channelRekeyAddress(vSecret, vId, 1n).pk).toBe(
      "7c55cdb957e9db2b4800d687b2a07d3f7066b1a35824a1e86ba871f55e87e8b5",
    );
  });

  it("CORD-06 §2 base rekey-pseudonym address matches Vector's GOLDEN_BASE_REKEY_E1_PK", () => {
    // Vector derive.rs: base_rekey_group_key(secret(), cid(), Epoch(1)).
    expect(baseRekeyAddress(vSecret, vId, 1n).pk).toBe(
      "fb2fa44fba66ba15595f784255a1cb569531db8784432ac0e4fe838498dd9dea",
    );
  });

  it("CORD-06 §3 guestbook snapshot address matches Vector's GOLDEN_GUESTBOOK_E0_PK", () => {
    // Vector derive.rs: guestbook_group_key(secret(), cid()=id32(), Epoch(0)).
    // A Refounding's kind-3312 snapshot rides the ordinary Guestbook plane, so
    // its address IS the guestbook group key at the NEW epoch — a match proves a
    // snapshot we publish and one Vector publishes land at the SAME on-wire
    // address, so a fresh joiner reads either.
    expect(guestbookAddress(vSecret, vId, 0n).pk).toBe(
      "ad09de582026fa7a052db18bb5827fa24c15e929d59aadcc91efb8508f5368ad",
    );
    // The snapshot address is exactly the guestbook plane key (same derivation).
    expect(guestbookAddress(vSecret, vId, 7n).pk).toBe(groupKey(LABEL_GUESTBOOK, vSecret, vId, 7n).pk);
  });

  it("snapshot id is deterministic per (community_id, epoch) and epoch-bound", () => {
    // NOT a frozen/cross-client derivation — Vector mints a RANDOM snap id and
    // reads ours verbatim from the tag (opaque). We derive deterministically so a
    // retried Refounding re-emits the SAME id (idempotent, relay-deduped). Pinned
    // for self-consistency only.
    const a = deriveSnapshotId(vId, 3n);
    expect(a).toBe(deriveSnapshotId(vId, 3n));            // stable
    expect(a).not.toBe(deriveSnapshotId(vId, 4n));         // epoch-bound
    expect(a).toMatch(/^[0-9a-f]{64}$/);                   // 32-byte hex, tag-shaped
  });

  it("CORD-06 §2 recipient locator matches Vector's GOLDEN_RECIPIENT_LOCATOR", () => {
    // Vector derive.rs: recipient_locator(secret(), alt()=0x11×32, id32(), Epoch(3)).
    expect(computeLocator(bytesToHex(vSecret), "11".repeat(32), vId, 3n)).toBe(
      "342deb400e191f0f52c81f27600934552550beb85aa9bf169f02d0e7f826cf74",
    );
  });

  it("channel seal conv_key: kind-20013 seal AND kind-1059 wrap both ride planeConvKey (self-ECDH) of the channel group key", () => {
    // Vector encrypts the 20013 seal under the channel group conv_key and reuses
    // the SAME conv_key for the outer 1059 wrap. Lock that our channel plane's
    // seal opens with planeConvKey and the wrap is authored by the plane key.
    const chan = groupKey(LABEL_CHANNEL, vSecret, vId, 0n);
    const convKey = planeConvKey(chan);
    const rumor = JSON.stringify({ kind: 9, content: "gm" });
    const seal = buildEncryptedSeal("dd".repeat(32), rumor, convKey, 1_700_000_000);
    expect(seal.kind).toBe(KIND_SEAL_ENC);
    expect(openSeal(seal, convKey)).toBe(rumor);
    const wrap = wrapStream(chan, seal, 1_700_000_000);
    expect(wrap.kind).toBe(KIND_STREAM_WRAP);
    expect(wrap.pubkey).toBe(chan.pk); // wrap authored by (and keyed on) the channel group key
    expect(unwrapStream(chan, wrap)!.content).toBe(seal.content);
  });
});

describe("invite + rekey key helpers (CORD-05/06)", () => {
  it("bundleKeyFromToken is deterministic 32-byte", () => {
    const token = new Uint8Array(16).fill(1);
    const a = bundleKeyFromToken(token);
    expect(a.length).toBe(32);
    expect(bytesToHex(bundleKeyFromToken(token))).toBe(bytesToHex(a));
  });

  it("computeLocator is deterministic and unique per recipient/epoch", () => {
    const rotator = getPublicKey(generateSecretKey());
    const alice = getPublicKey(generateSecretKey());
    const bob = getPublicKey(generateSecretKey());
    const scope = id32;
    const la = computeLocator(rotator, alice, scope, 1n);
    expect(la).toMatch(/^[0-9a-f]{64}$/);
    expect(computeLocator(rotator, alice, scope, 1n)).toBe(la); // deterministic
    expect(computeLocator(rotator, bob, scope, 1n)).not.toBe(la); // per-recipient
    expect(computeLocator(rotator, alice, scope, 2n)).not.toBe(la); // per-epoch
  });
});
