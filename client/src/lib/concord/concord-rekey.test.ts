import { describe, it, expect } from "vitest";
import {
  buildRekeyPayload, parseRekeyPayload, chunkRecipients, matchOwnBlob, isRemoved,
  isAuthorizedRotator, rotatorOutranks, receiveRekey, receiveChannelGrant, sendRekey, type RekeyBlob, type RekeyAuthority,
} from "./concord-rekey";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import {
  computeLocator, rekeyScopeId, epochKeyCommitment, epochKeyCommitmentLegacy,
  baseRekeyAddress, channelRekeyAddress, unwrapStream, KIND_SEAL_ENC, KIND_SEAL_PLAIN,
} from "./concord-crypto";
import { controlPlaneKey, decodeStreamEvent, type DecodedRumor } from "./concord-stream";
import type { StoredCommunity } from "./concord-keys";
import { PERM, type Member } from "./concord-events";
import type { ISigner } from "applesauce-signers";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

const scope = "aa".repeat(32);
const newKey = new Uint8Array(32).fill(9);

describe("rekey payload codec (CORD-06 §2)", () => {
  it("roundtrips the 72-byte payload", () => {
    const p = buildRekeyPayload(scope, 5n, newKey);
    expect(p.length).toBe(72);
    const out = parseRekeyPayload(p);
    expect(out!.scopeId).toBe(scope);
    expect(out!.epoch).toBe(5n);
    expect(bytesToHex(out!.newKey)).toBe(bytesToHex(newKey));
  });
  it("rejects a wrong-length payload", () => {
    expect(parseRekeyPayload(new Uint8Array(40))).toBeNull();
  });
});

describe("scope id + commitment", () => {
  it("rekeyScopeId uses the channel id, or all-zeros for base rotation", () => {
    expect(rekeyScopeId("bb".repeat(32))).toBe("bb".repeat(32));
    expect(rekeyScopeId()).toBe("00".repeat(32));
  });
  it("epochKeyCommitment is deterministic and key/epoch sensitive", () => {
    const k = new Uint8Array(32).fill(3);
    const a = epochKeyCommitment(1n, k);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(epochKeyCommitment(1n, k)).toBe(a);
    expect(epochKeyCommitment(2n, k)).not.toBe(a);
    expect(epochKeyCommitment(1n, new Uint8Array(32).fill(4))).not.toBe(a);
  });
});

describe("chunking + locator matching", () => {
  it("chunks recipients and always yields at least one chunk", () => {
    expect(chunkRecipients([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkRecipients([])).toEqual([[]]);
  });
  it("matchOwnBlob finds my blob by locator", () => {
    const blobs: RekeyBlob[] = [{ locator: "x", wrapped: "a" }, { locator: "y", wrapped: "b" }];
    expect(matchOwnBlob(blobs, "y")!.wrapped).toBe("b");
    expect(matchOwnBlob(blobs, "z")).toBeNull();
  });
});

describe("removal detection (CORD-06 §4)", () => {
  const rotator = getPublicKey(generateSecretKey());
  const alice = getPublicKey(generateSecretKey());
  const bob = getPublicKey(generateSecretKey());
  const aliceLoc = computeLocator(rotator, alice, scope, 2n);
  const bobLoc = computeLocator(rotator, bob, scope, 2n);

  it("a member whose locator is present is NOT removed", () => {
    const chunks = [{ i: 0, n: 1, blobs: [{ locator: aliceLoc, wrapped: "w" }, { locator: bobLoc, wrapped: "w" }] }];
    expect(isRemoved(chunks, aliceLoc)).toBe(false);
  });
  it("a member absent from a COMPLETE chunk set is removed", () => {
    const chunks = [{ i: 0, n: 1, blobs: [{ locator: aliceLoc, wrapped: "w" }] }];
    expect(isRemoved(chunks, bobLoc)).toBe(true); // bob missing, set complete (n=1)
  });
  it("an incomplete chunk set is NEVER a removal", () => {
    const chunks = [{ i: 0, n: 2, blobs: [{ locator: aliceLoc, wrapped: "w" }] }]; // only 1 of 2 chunks
    expect(isRemoved(chunks, bobLoc)).toBe(false);
  });
  it("empty chunks → not removed", () => {
    expect(isRemoved([], bobLoc)).toBe(false);
  });
  it("works with 1-BASED chunk indices (CORD-06/Vector) and with the legacy 0-based form", () => {
    // Spec/Vector chunks are (1..n); our old clients minted (0..n-1). The
    // completeness check counts DISTINCT indices, so both conventions complete.
    const oneBased = [
      { i: 1, n: 2, blobs: [{ locator: aliceLoc, wrapped: "w" }] },
      { i: 2, n: 2, blobs: [] as RekeyBlob[] },
    ];
    expect(isRemoved(oneBased, aliceLoc)).toBe(false);
    expect(isRemoved(oneBased, bobLoc)).toBe(true);
    const zeroBased = [
      { i: 0, n: 2, blobs: [{ locator: aliceLoc, wrapped: "w" }] },
      { i: 1, n: 2, blobs: [] as RekeyBlob[] },
    ];
    expect(isRemoved(zeroBased, aliceLoc)).toBe(false);
    expect(isRemoved(zeroBased, bobLoc)).toBe(true);
  });
});

describe("rekey authority (CORD-04/06)", () => {
  const OWNER = getPublicKey(generateSecretKey());
  const PEER = getPublicKey(generateSecretKey());
  const STRANGER = getPublicKey(generateSecretKey());
  const ME = getPublicKey(generateSecretKey());
  const member = (pubkey: string, rank: number, permissions: bigint): Member => ({ pubkey, joinedAt: 0, roleIds: [], permissions, rank });

  it("isAuthorizedRotator: CORD-06 — a Refounding (base scope) requires BAN", () => {
    const base = "00".repeat(32);
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(PEER, 3, PERM.BAN), member(ME, 3, PERM.MANAGE_ROLES)] };
    expect(isAuthorizedRotator(OWNER, auth, base)).toBe(true);
    expect(isAuthorizedRotator(PEER, auth, base)).toBe(true);    // BAN holder
    expect(isAuthorizedRotator(ME, auth, base)).toBe(false);     // MANAGE_ROLES is NOT rekey authority
    expect(isAuthorizedRotator(STRANGER, auth, base)).toBe(false); // not on the roster
  });

  it("isAuthorizedRotator: CORD-06 — a single-channel rekey requires MANAGE_CHANNELS", () => {
    const channel = "cc".repeat(32);
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(PEER, 3, PERM.MANAGE_CHANNELS), member(ME, 3, PERM.BAN)] };
    expect(isAuthorizedRotator(OWNER, auth, channel)).toBe(true);
    expect(isAuthorizedRotator(PEER, auth, channel)).toBe(true);  // MANAGE_CHANNELS holder
    expect(isAuthorizedRotator(ME, auth, channel)).toBe(false);   // BAN alone doesn't rotate a channel
  });

  it("isAuthorizedRotator: the built-in Admin permission set may rotate BOTH scopes", () => {
    // Regression: the old owner-or-MANAGE_ROLES rule rejected every admin's
    // removal-rekey (the Admin role deliberately lacks MANAGE_ROLES).
    const adminPerms = PERM.MANAGE_CHANNELS | PERM.MANAGE_METADATA | PERM.KICK | PERM.BAN | PERM.MANAGE_MESSAGES | PERM.CREATE_INVITE | PERM.VIEW_AUDIT_LOG;
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(PEER, 1, adminPerms)] };
    expect(isAuthorizedRotator(PEER, auth, "00".repeat(32))).toBe(true);
    expect(isAuthorizedRotator(PEER, auth, "cc".repeat(32))).toBe(true);
  });

  it("rotatorOutranks: owner outranks everyone; equal ranks cannot act on each other", () => {
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(PEER, 3, PERM.MANAGE_ROLES), member(ME, 3, 0n)] };
    expect(rotatorOutranks(OWNER, ME, auth)).toBe(true);
    expect(rotatorOutranks(PEER, ME, auth)).toBe(false); // rank 3 vs rank 3
  });

  // A signer stub whose nip44 is never reached (the removal path returns before
  // any decrypt) — the authority gate is what we exercise here.
  const stubSigner = { nip44: {} } as unknown as ISigner;
  const scope = "aa".repeat(32);
  const myKey = new Uint8Array(32).fill(7);
  // A complete (n=1) chunk set for newepoch 1 that does NOT carry my locator →
  // isRemoved would fire, so the authority gate decides the outcome.
  const rumorsEvicting = (rotator: string) => {
    const someoneElse = computeLocator(rotator, STRANGER, scope, 1n);
    return [{
      tags: [
        ["scope", scope], ["newepoch", "1"], ["prevepoch", "0"],
        ["prevcommit", epochKeyCommitment(0n, myKey)], ["chunk", "0", "1"],
      ],
      content: JSON.stringify([{ locator: someoneElse, wrapped: "w" }] as RekeyBlob[]),
    }];
  };
  const params = { scopeId: scope, myCurrentKey: myKey, myCurrentEpoch: 0 };

  it("receiveRekey: an unauthorized rotator's rotation is ignored (pending, not removed)", async () => {
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(ME, 3, 0n)] };
    const res = await receiveRekey(stubSigner, ME, STRANGER, params, rumorsEvicting(STRANGER), auth);
    expect(res.status).toBe("pending");
  });

  it("receiveRekey: an authorized rotator who outranks me can evict me (removed)", async () => {
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(ME, 3, 0n)] };
    const res = await receiveRekey(stubSigner, ME, OWNER, params, rumorsEvicting(OWNER), auth);
    expect(res.status).toBe("removed");
  });

  it("receiveRekey: dual-verify — a LEGACY-form prevcommit still passes continuity", async () => {
    // Same eviction rumor but with the pre-conformance commitment. If continuity
    // rejected the legacy form we'd get "pending"; reaching "removed" proves the
    // receiver accepted it and fell through to the (owner-outranks) authority gate.
    const rumorsLegacy = (rotator: string) => {
      const someoneElse = computeLocator(rotator, STRANGER, scope, 1n);
      return [{
        tags: [
          ["scope", scope], ["newepoch", "1"], ["prevepoch", "0"],
          ["prevcommit", epochKeyCommitmentLegacy(scope, 0n, myKey)], ["chunk", "0", "1"],
        ],
        content: JSON.stringify([{ locator: someoneElse, wrapped: "w" }] as RekeyBlob[]),
      }];
    };
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(ME, 3, 0n)] };
    const res = await receiveRekey(stubSigner, ME, OWNER, params, rumorsLegacy(OWNER), auth);
    expect(res.status).toBe("removed");
  });

  it("receiveRekey: a bogus prevcommit (neither form) is rejected as non-continuation (pending)", async () => {
    const rumorsBogus = (rotator: string) => {
      const someoneElse = computeLocator(rotator, STRANGER, scope, 1n);
      return [{
        tags: [
          ["scope", scope], ["newepoch", "1"], ["prevepoch", "0"],
          ["prevcommit", "ff".repeat(32)], ["chunk", "0", "1"],
        ],
        content: JSON.stringify([{ locator: someoneElse, wrapped: "w" }] as RekeyBlob[]),
      }];
    };
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(ME, 3, 0n)] };
    const res = await receiveRekey(stubSigner, ME, OWNER, params, rumorsBogus(OWNER), auth);
    expect(res.status).toBe("pending");
  });

  it("receiveRekey: an authorized peer who does NOT outrank me cannot evict me (pending)", async () => {
    // PEER holds channel-rekey authority (MANAGE_CHANNELS, scope is a channel
    // id) but sits at MY rank — the strict-outrank gate must refuse my eviction.
    const auth: RekeyAuthority = { ownerPubkey: OWNER, roster: [member(PEER, 3, PERM.MANAGE_CHANNELS), member(ME, 3, 0n)] };
    const res = await receiveRekey(stubSigner, ME, PEER, params, rumorsEvicting(PEER), auth);
    expect(res.status).toBe("pending");
  });
});

// ── Live-bug regressions: delivery + adoption round-trips ─────────────────────
// A minimal real-NIP-44 signer: encrypt/decrypt with the actual conversation
// key, exactly what receiveRekey/receiveChannelGrant do through signer.nip44.
function realSigner(sk: Uint8Array): ISigner {
  return {
    nip44: {
      encrypt: async (pk: string, plaintext: string) => nip44v2.encrypt(plaintext, nip44v2.utils.getConversationKey(sk, pk)),
      decrypt: async (pk: string, ciphertext: string) => nip44v2.decrypt(ciphertext, nip44v2.utils.getConversationKey(sk, pk)),
    },
  } as unknown as ISigner;
}

function b64(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("rekey round-trip (CORD-06 §1–2): a remaining member ADOPTS the new key", () => {
  const ownerSk = generateSecretKey();
  const owner = getPublicKey(ownerSk);
  const bobSk = generateSecretKey();
  const bob = getPublicKey(bobSk);
  const evictee = getPublicKey(generateSecretKey());
  const base = rekeyScopeId(); // all-zeros
  const oldKey = new Uint8Array(32).fill(1);
  const freshKey = new Uint8Array(32).fill(2);
  const member = (pubkey: string, rank: number, permissions: bigint): Member => ({ pubkey, joinedAt: 0, roleIds: [], permissions, rank });
  const auth: RekeyAuthority = { ownerPubkey: owner, roster: [member(bob, 3, 0n), member(evictee, 3, 0n)] };

  // What sendRekey emits per recipient, built by hand so the test stays pure:
  // locator(rotator, recipient, scope, newepoch) + NIP-44(base64(72-byte payload)).
  async function rotationRumors(recipients: string[], scope: string, prevEpoch: number, prevKey: Uint8Array, newKey: Uint8Array) {
    const rotator = realSigner(ownerSk);
    const newEpoch = prevEpoch + 1;
    const blobs: RekeyBlob[] = [];
    for (const r of recipients) {
      blobs.push({
        locator: computeLocator(owner, r, scope, BigInt(newEpoch)),
        wrapped: await rotator.nip44!.encrypt(r, b64(buildRekeyPayload(scope, BigInt(newEpoch), newKey))),
      });
    }
    return [{
      tags: [
        ["scope", scope], ["newepoch", String(newEpoch)], ["prevepoch", String(prevEpoch)],
        ["prevcommit", epochKeyCommitment(BigInt(prevEpoch), prevKey)], ["chunk", "0", "1"],
      ],
      content: JSON.stringify(blobs),
    }];
  }

  it("REGRESSION (live bug 2): remover evicts ONE member — a remaining member is rekeyed, not removed", async () => {
    const rumors = await rotationRumors([bob], base, 0, oldKey, freshKey);
    const res = await receiveRekey(realSigner(bobSk), bob, owner, { scopeId: base, myCurrentKey: oldKey, myCurrentEpoch: 0 }, rumors, auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      expect(res.newEpoch).toBe(1);
      expect(bytesToHex(res.newKey)).toBe(bytesToHex(freshKey));
    }
  });

  it("…while the evicted member (no blob) sees their own removal", async () => {
    const rumors = await rotationRumors([bob], base, 0, oldKey, freshKey);
    const evicteeSigner = realSigner(generateSecretKey());
    const res = await receiveRekey(evicteeSigner, evictee, owner, { scopeId: base, myCurrentKey: oldKey, myCurrentEpoch: 0 }, rumors, auth);
    expect(res.status).toBe("removed");
  });

  it("an already-adopted rotation is a no-op (idempotent re-processing)", async () => {
    const rumors = await rotationRumors([bob], base, 0, oldKey, freshKey);
    // Bob already sits at epoch 1 with the fresh key — the prevepoch filter skips it.
    const res = await receiveRekey(realSigner(bobSk), bob, owner, { scopeId: base, myCurrentKey: freshKey, myCurrentEpoch: 1 }, rumors, auth);
    expect(res.status).toBe("pending");
  });

  it("receiveChannelGrant: a channel-scoped delivery hands a member the private-channel key", async () => {
    const channelId = "cc".repeat(32);
    const channelKey = new Uint8Array(32).fill(7);
    // Initial delivery as createPrivateChannel sends it: prevEpoch 0 → epoch 1.
    const rumors = await rotationRumors([bob], channelId, 0, channelKey, channelKey);
    const grant = await receiveChannelGrant(realSigner(bobSk), bob, owner, channelId, rumors, auth);
    expect(grant).not.toBeNull();
    expect(grant!.epoch).toBe(1);
    expect(bytesToHex(grant!.key)).toBe(bytesToHex(channelKey));
  });

  it("receiveChannelGrant: a member NOT in the delivery gets nothing", async () => {
    const channelId = "cc".repeat(32);
    const channelKey = new Uint8Array(32).fill(7);
    const rumors = await rotationRumors([bob], channelId, 0, channelKey, channelKey);
    const outsider = getPublicKey(generateSecretKey());
    const grant = await receiveChannelGrant(realSigner(generateSecretKey()), outsider, owner, channelId, rumors, auth);
    expect(grant).toBeNull();
  });

  it("receiveChannelGrant: an unauthorized rotator's delivery is refused", async () => {
    const channelId = "cc".repeat(32);
    const channelKey = new Uint8Array(32).fill(7);
    // The evictee (no MANAGE_CHANNELS) forges a delivery to bob.
    const rumors = [{
      tags: [["scope", channelId], ["newepoch", "1"], ["prevepoch", "0"], ["prevcommit", epochKeyCommitment(0n, channelKey)], ["chunk", "0", "1"]],
      content: JSON.stringify([{ locator: computeLocator(evictee, bob, channelId, 1n), wrapped: "junk" }]),
    }];
    const grant = await receiveChannelGrant(realSigner(bobSk), bob, evictee, channelId, rumors, auth);
    expect(grant).toBeNull();
  });
});

// ── CORD-06 §2 dual-path transition: spec pseudonym address + legacy plane ────
// sendRekey must publish every chunk TWICE (identical rumor): once at the
// dedicated rekey-pseudonym address (spec, encrypted 20013 seal — the location
// Vector/Amethyst read) and once on the control plane (plaintext 20014 seal —
// the location our deployed clients read). A dual-reading client dedupes on the
// rumor id and processes the rotation exactly once.
describe("CORD-06 §2 dual-write / dual-read transition", () => {
  const ownerSk = generateSecretKey();
  const owner = getPublicKey(ownerSk);
  const bobSk = generateSecretKey();
  const bob = getPublicKey(bobSk);
  const member = (pubkey: string, rank: number, permissions: bigint): Member => ({ pubkey, joinedAt: 0, roleIds: [], permissions, rank });
  const auth: RekeyAuthority = { ownerPubkey: owner, roster: [member(bob, 3, 0n)] };

  const cid = bytesToHex(new Uint8Array(32).fill(2));
  const root = "03".repeat(32);
  const community: StoredCommunity = {
    community_id: cid, owner, owner_salt: "11".repeat(32),
    community_root: root, root_epoch: 0,
    channels: [], relays: ["wss://r"], name: "G", addedAt: 0,
  };

  // A signer that both signs seals AND does pairwise NIP-44 — the full surface
  // sendRekey touches.
  function fullSigner(sk: Uint8Array): ISigner {
    return {
      signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
      nip44: {
        encrypt: async (pk: string, plaintext: string) => nip44v2.encrypt(plaintext, nip44v2.utils.getConversationKey(sk, pk)),
        decrypt: async (pk: string, ciphertext: string) => nip44v2.decrypt(ciphertext, nip44v2.utils.getConversationKey(sk, pk)),
      },
    } as unknown as ISigner;
  }

  async function mintBaseRotation() {
    const published: Event[] = [];
    const newKey = new Uint8Array(32).fill(9);
    const res = await sendRekey(
      fullSigner(ownerSk), owner, community,
      { scopeId: rekeyScopeId(), prevEpoch: 0, prevKey: hexToBytes(root), newKey, remaining: [{ pubkey: bob }] },
      async (e) => { published.push(e); },
    );
    return { published, newKey, res };
  }

  it("dual-write: one chunk publishes two wraps — spec address (20013 seal) + control plane (20014), identical rumor", async () => {
    const { published, res } = await mintBaseRotation();
    expect(res?.newEpoch).toBe(1);
    expect(published.length).toBe(2);

    const specPlane = baseRekeyAddress(hexToBytes(root), cid, 1n);
    const legacyPlane = controlPlaneKey(community);
    const specWrap = published.find((e) => e.pubkey === specPlane.pk);
    const legacyWrap = published.find((e) => e.pubkey === legacyPlane.pk);
    expect(specWrap).toBeDefined();
    expect(legacyWrap).toBeDefined();

    // Seal kinds: the spec path MUST be encrypted (Vector rejects a plaintext-
    // sealed rekey); the legacy path stays plaintext (what deployed clients mint/read).
    expect(unwrapStream(specPlane, specWrap!)!.kind).toBe(KIND_SEAL_ENC);
    expect(unwrapStream(legacyPlane, legacyWrap!)!.kind).toBe(KIND_SEAL_PLAIN);

    // Identical rumor on both paths (same id → the dedupe key), 1-based chunk tag.
    const specRumor = decodeStreamEvent(specPlane, specWrap!)!;
    const legacyRumor = decodeStreamEvent(legacyPlane, legacyWrap!)!;
    expect(specRumor.id).toBeDefined();
    expect(specRumor.id).toBe(legacyRumor.id);
    expect(specRumor.tags).toEqual(legacyRumor.tags);
    expect(specRumor.content).toBe(legacyRumor.content);
    expect(specRumor.tags.find((t) => t[0] === "chunk")).toEqual(["chunk", "1", "1"]);
  });

  it("dual-read: a rotation arriving via the SPEC address alone is processed (the Vector-minted case)", async () => {
    const { published, newKey } = await mintBaseRotation();
    const specPlane = baseRekeyAddress(hexToBytes(root), cid, 1n);
    const specWrap = published.find((e) => e.pubkey === specPlane.pk)!;
    const rumor = decodeStreamEvent(specPlane, specWrap)!;
    const res = await receiveRekey(fullSigner(bobSk), bob, owner,
      { scopeId: rekeyScopeId(), myCurrentKey: hexToBytes(root), myCurrentEpoch: 0 }, [rumor], auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") expect(bytesToHex(res.newKey)).toBe(bytesToHex(newKey));
  });

  it("dual-read: the LEGACY control-plane copy alone still processes (deployed-fleet case)", async () => {
    const { published, newKey } = await mintBaseRotation();
    const legacyPlane = controlPlaneKey(community);
    const legacyWrap = published.find((e) => e.pubkey === legacyPlane.pk)!;
    const rumor = decodeStreamEvent(legacyPlane, legacyWrap)!;
    const res = await receiveRekey(fullSigner(bobSk), bob, owner,
      { scopeId: rekeyScopeId(), myCurrentKey: hexToBytes(root), myCurrentEpoch: 0 }, [rumor], auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") expect(bytesToHex(res.newKey)).toBe(bytesToHex(newKey));
  });

  it("dedupe: both copies decode to ONE rumor id, so the rumor-id map holds a single entry — and even the raw duplicate list processes identically", async () => {
    const { published, newKey } = await mintBaseRotation();
    const specPlane = baseRekeyAddress(hexToBytes(root), cid, 1n);
    const legacyPlane = controlPlaneKey(community);
    const specRumor = decodeStreamEvent(specPlane, published.find((e) => e.pubkey === specPlane.pk)!)!;
    const legacyRumor = decodeStreamEvent(legacyPlane, published.find((e) => e.pubkey === legacyPlane.pk)!)!;

    // The consumer (useConcordGovernance) keys its rekey accumulator by rumor id.
    const accumulator = new Map<string, DecodedRumor>();
    accumulator.set(specRumor.id, specRumor);
    accumulator.set(legacyRumor.id, legacyRumor);
    expect(accumulator.size).toBe(1);

    // Belt-and-braces: even if BOTH copies reached receiveRekey, the outcome is
    // the same single adoption (same epoch, same key) — never a double-apply.
    const res = await receiveRekey(fullSigner(bobSk), bob, owner,
      { scopeId: rekeyScopeId(), myCurrentKey: hexToBytes(root), myCurrentEpoch: 0 }, [specRumor, legacyRumor], auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      expect(res.newEpoch).toBe(1);
      expect(bytesToHex(res.newKey)).toBe(bytesToHex(newKey));
    }
  });

  it("channel-scoped dual-write lands at the channel rekey-pseudonym address (current root)", async () => {
    const channelId = "cc".repeat(32);
    const channelKey = new Uint8Array(32).fill(7);
    const published: Event[] = [];
    await sendRekey(
      fullSigner(ownerSk), owner, community,
      { scopeId: channelId, prevEpoch: 0, prevKey: channelKey, newKey: channelKey, remaining: [{ pubkey: bob }] },
      async (e) => { published.push(e); },
    );
    expect(published.length).toBe(2);
    const specPlane = channelRekeyAddress(hexToBytes(root), channelId, 1n);
    const specWrap = published.find((e) => e.pubkey === specPlane.pk);
    expect(specWrap).toBeDefined();
    // The spec copy delivers the grant end-to-end, like the legacy one always has.
    const rumor = decodeStreamEvent(specPlane, specWrap!)!;
    const grant = await receiveChannelGrant(fullSigner(bobSk), bob, owner, channelId, [rumor], auth);
    expect(grant).not.toBeNull();
    expect(bytesToHex(grant!.key)).toBe(bytesToHex(channelKey));
  });
});
