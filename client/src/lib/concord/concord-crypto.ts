/**
 * Concord protocol — pure cryptographic core (CORD-01 streams, CORD-02 keys).
 *
 * NO I/O, NO signer, NO storage — every function here is deterministic given
 * its inputs, so the whole module is unit-testable in the node vitest env.
 *
 * Concord is end-to-end-encrypted communities on plain NIP-01 relays. A
 * "community" derives a tree of symmetric keys from a root secret; members hold
 * the keys, relays only ever see kind-1059 blobs. This file implements the key
 * derivation (`groupKey`), the identity commitment (`deriveCommunityId`), and
 * the stream wrap/unwrap (reversed NIP-59) that every plane rides on.
 *
 * Spec sources: CORD-01 (Private Streams), CORD-02 (Communities). Kept separate
 * from the higher-level event/parse layer (`concord-events.ts`) on purpose.
 */
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, type Event } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

// ── Constants ────────────────────────────────────────────────────────────────
export const KIND_STREAM_WRAP = 1059;
export const KIND_EPHEMERAL_WRAP = 21059;
export const KIND_SEAL_ENC = 20013;
export const KIND_SEAL_PLAIN = 20014;

/** Plane derivation labels (CORD-02 §group_key). */
export const LABEL_CONTROL = "concord/control";
export const LABEL_GUESTBOOK = "concord/guestbook";
export const LABEL_CHANNEL = "concord/channel";
/** CORD-06 §2 / CORD-02 A.6: dedicated rekey-pseudonym address labels. */
export const LABEL_REKEY_PSEUDONYM = "concord/rekey-pseudonym";
export const LABEL_BASE_REKEY_PSEUDONYM = "concord/base-rekey-pseudonym";
const COMMUNITY_ID_PREFIX = "concord/community";
const INVITE_KEY_LABEL = "concord/invite-key";
const RECIPIENT_PSEUDONYM_LABEL = "concord/recipient-pseudonym";

/** secp256k1 group order n — a scalar is valid iff 0 < sk < n. */
const CURVE_N: bigint = secp256k1.Point.Fn.ORDER;

// ── Types ────────────────────────────────────────────────────────────────────
export interface GroupKey {
  /** 32-byte private scalar (valid secp256k1 key). */
  sk: Uint8Array;
  /** x-only public key, 64 lowercase hex chars. */
  pk: string;
}

/** A decoded Concord seal (the layer between the outer wrap and the rumor). */
export interface Seal {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id?: string;
  sig?: string;
}

// ── Low-level helpers ────────────────────────────────────────────────────────
function bytesToBigIntBE(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function u64BE(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** True iff the 32-byte seed is a usable secp256k1 private scalar (0 < s < n). */
function isValidScalar(seed: Uint8Array): boolean {
  if (seed.length !== 32) return false;
  const n = bytesToBigIntBE(seed);
  return n > 0n && n < CURVE_N;
}

// ── CORD-02: group_key derivation ────────────────────────────────────────────
/**
 * Derive a plane keypair. `group_key(label, secret, id, epoch)`:
 *   info = utf8(label) || 0x00 || id[32] || epoch_be[8]   (epoch optional)
 *   seed = HKDF-SHA256(ikm=secret, salt=∅, info, len=32)
 *   sk   = scalar_normalize(seed)  — retry with an incrementing counter byte
 *          appended to `info` (starting at 0) until the seed is a valid scalar.
 *
 * @param id 32-byte community_id or channel_id (hex string or bytes).
 * @param epoch omit for epoch-less labels; pass a u64 for the plane epoch.
 */
export function groupKey(label: string, secret: Uint8Array, id: string | Uint8Array, epoch?: bigint): GroupKey {
  const idBytes = typeof id === "string" ? hexToBytes(id) : id;
  if (idBytes.length !== 32) throw new Error("groupKey: id must be 32 bytes");
  const base = epoch === undefined
    ? concatBytes(utf8ToBytes(label), new Uint8Array([0x00]), idBytes)
    : concatBytes(utf8ToBytes(label), new Uint8Array([0x00]), idBytes, u64BE(epoch));

  // scalar_normalize: deterministic retry loop shared across implementations.
  for (let counter = -1; counter < 256; counter++) {
    const info = counter < 0 ? base : concatBytes(base, new Uint8Array([counter]));
    const seed = hkdf(sha256, secret, undefined, info, 32);
    if (isValidScalar(seed)) {
      return { sk: seed, pk: getPublicKey(seed) };
    }
  }
  // Astronomically unlikely (each attempt fails with p ≈ 2^-128).
  throw new Error("groupKey: scalar_normalize exhausted");
}

// ── CORD-02: community_id ─────────────────────────────────────────────────────
/** community_id = sha256("concord/community" || owner_xonly || owner_salt). */
export function deriveCommunityId(ownerXonly: string, ownerSalt: string | Uint8Array): string {
  const owner = hexToBytes(ownerXonly);
  if (owner.length !== 32) throw new Error("deriveCommunityId: owner must be x-only 32 bytes");
  const salt = typeof ownerSalt === "string" ? hexToBytes(ownerSalt) : ownerSalt;
  if (salt.length !== 32) throw new Error("deriveCommunityId: salt must be 32 bytes");
  return bytesToHex(sha256(concatBytes(utf8ToBytes(COMMUNITY_ID_PREFIX), owner, salt)));
}

/** Verify a claimed community_id recomputes from its owner + salt (CORD-05 join check). */
export function verifyCommunityId(communityId: string, ownerXonly: string, ownerSalt: string | Uint8Array): boolean {
  try {
    return deriveCommunityId(ownerXonly, ownerSalt) === communityId.toLowerCase();
  } catch {
    return false;
  }
}

// ── CORD-01: stream wrap / unwrap (reversed NIP-59) ──────────────────────────
/**
 * Self-ECDH NIP-44 conversation key for a plane (shared key ECDH with its own
 * pubkey). Encrypts BOTH the outer wrap AND the inner 20013 seal — confirmed
 * against the Concord reference `examples.md`: both layers use `conv_key`,
 * "NIP-44 self-ECDH of the stream key". Exported so the stream publish/decrypt
 * layer (Slice 2) doesn't re-derive it.
 */
export function planeConvKey(plane: GroupKey): Uint8Array {
  return nip44v2.utils.getConversationKey(plane.sk, plane.pk);
}
const planeConversationKey = planeConvKey;

/**
 * Wrap a seal into a kind-1059 stream event: signed BY the plane key (fixed
 * author), with a random ephemeral `p` tag, content = NIP-44(plane self-ECDH).
 * `created_at` is passed in (untweaked per spec) so this stays pure/testable.
 */
export function wrapStream(plane: GroupKey, seal: Seal, createdAt: number, kind: number = KIND_STREAM_WRAP): Event {
  const convKey = planeConversationKey(plane);
  const ephemeralPk = getPublicKey(generateSecretKey());
  const content = nip44v2.encrypt(JSON.stringify(seal), convKey);
  return finalizeEvent(
    { kind, created_at: createdAt, tags: [["p", ephemeralPk]], content },
    plane.sk,
  );
}

/**
 * Unwrap a kind-1059 stream event with the plane key. Verifies the outer sig is
 * the plane's own key, decrypts, and returns the inner seal — or null on any
 * failure (wrong plane, tampered, malformed). Never throws.
 */
export function unwrapStream(plane: GroupKey, wrap: Event): Seal | null {
  try {
    if (wrap.kind !== KIND_STREAM_WRAP && wrap.kind !== KIND_EPHEMERAL_WRAP) return null;
    if (wrap.pubkey !== plane.pk) return null; // author must be the plane key
    if (!verifyEvent(wrap)) return null;
    const convKey = planeConversationKey(plane);
    const json = nip44v2.decrypt(wrap.content, convKey);
    const seal = JSON.parse(json) as Seal;
    if (typeof seal.kind !== "number" || typeof seal.pubkey !== "string") return null;
    return seal;
  } catch {
    return null;
  }
}

// ── Seal build / open ─────────────────────────────────────────────────────────
/**
 * Build a plaintext seal (kind 20014) carrying a rumor verbatim — used on the
 * Control Plane where every member shares the plane key. The rumor's exact JSON
 * bytes are preserved (CORD-01: "a re-wrap MUST carry the exact bytes forward").
 */
export function buildPlainSeal(authorPubkey: string, rumorJson: string, createdAt: number): Seal {
  return { kind: KIND_SEAL_PLAIN, pubkey: authorPubkey, created_at: createdAt, content: rumorJson, tags: [] };
}

/**
 * Build an encrypted seal (kind 20013): the rumor is NIP-44-encrypted so the
 * inner event can never be extracted and replayed as a standalone public note.
 *
 * NOTE (confirm before Slice 2 wires real chat traffic): the exact key that
 * encrypts the inner rumor is parametrized here (`sealKey`) because the CORD-01
 * prose left it under-specified vs. reference vectors. Slice-1 ships dark, so
 * this is safe to pin down against the reference implementation next.
 */
export function buildEncryptedSeal(authorPubkey: string, rumorJson: string, sealKey: Uint8Array, createdAt: number): Seal {
  return {
    kind: KIND_SEAL_ENC,
    pubkey: authorPubkey,
    created_at: createdAt,
    content: nip44v2.encrypt(rumorJson, sealKey),
    tags: [],
  };
}

/** Open a seal back to the rumor JSON string. Plaintext seals pass through; encrypted seals need `sealKey`. */
export function openSeal(seal: Seal, sealKey?: Uint8Array): string | null {
  try {
    if (seal.kind === KIND_SEAL_PLAIN) return seal.content;
    if (seal.kind === KIND_SEAL_ENC) {
      if (!sealKey) return null;
      return nip44v2.decrypt(seal.content, sealKey);
    }
    return null;
  } catch {
    return null;
  }
}

// ── CORD-05 / CORD-06 key helpers ────────────────────────────────────────────
/**
 * bundle_key = HKDF-SHA256(ikm=token, salt=∅, info, len=32), used DIRECTLY as
 * the NIP-44 conversation key (the invite is the one exception to group_key — no
 * scalar_normalize, no ECDH).
 *
 * `info` follows the canonical CORD-02 Appendix A.1 form:
 *   info = utf8("concord/invite-key") ‖ 0x00 ‖ id[32]   (id = 32 zero bytes; epoch omitted)
 * — the same idiom `groupKey`/`computeLocator` already use. Confirmed against
 * Amethyst's `inviteBundleKey` (quartz ConcordKeyDerivation.kt:
 * `hkdf32(token, buildInfo(INVITE_KEY, ByteArray(32)))`) and Ditto's
 * `armadaInvite.ts`, both of which carry the 0x00‖ZERO32. The prior label-only
 * derivation (see `legacyBundleKeyFromToken`) produced a different conversation
 * key, so other clients' NIP-44 MAC failed — the cross-client interop bug.
 */
export function bundleKeyFromToken(token: Uint8Array): Uint8Array {
  const info = concatBytes(utf8ToBytes(INVITE_KEY_LABEL), new Uint8Array([0x00]), new Uint8Array(32));
  return hkdf(sha256, token, undefined, info, 32);
}

/**
 * Legacy (pre-fix) bundle_key: `info = utf8("concord/invite-key")` ONLY, missing
 * the `0x00 ‖ id[32]`. Retained for back-compat dual-read so invite links our
 * users already shared still open in OUR client. Never used to mint new links.
 */
export function legacyBundleKeyFromToken(token: Uint8Array): Uint8Array {
  return hkdf(sha256, token, undefined, utf8ToBytes(INVITE_KEY_LABEL), 32);
}

/**
 * Per-recipient rekey locator (CORD-06):
 *   HKDF(ikm=rotator_xonly||recipient_xonly, salt=∅,
 *        info="concord/recipient-pseudonym" || 0x00 || scope_id[32] || epoch_be[8], len=32)
 * A recipient scans a rekey's chunks for their own locator; a missing locator
 * (only after ALL chunks are present) means they were removed.
 */
export function computeLocator(rotatorXonly: string, recipientXonly: string, scopeId: string, epoch: bigint): string {
  const ikm = concatBytes(hexToBytes(rotatorXonly), hexToBytes(recipientXonly));
  const info = concatBytes(utf8ToBytes(RECIPIENT_PSEUDONYM_LABEL), new Uint8Array([0x00]), hexToBytes(scopeId), u64BE(epoch));
  return bytesToHex(hkdf(sha256, ikm, undefined, info, 32));
}

/**
 * Epoch-key commitment (CORD-06 prevcommit continuity check).
 *
 *   epoch_key_commitment = sha256( utf8("concord/epoch-key-commitment")
 *                                  ‖ epoch_be[8] ‖ key[32] )
 *
 * Byte-for-byte matched to the Vector reference client (Rust `vector-core`,
 * `community/v2/derive.rs::epoch_key_commitment`): NO scope_id, NO 0x00
 * separator, label ‖ epoch ‖ key ordering. Verified against Vector's golden
 * vector `epoch_key_commitment(Epoch(2), [0x00..0x1f]) =
 * 3e6d6a3c9973c16d1ca7c5602d36979927c55c21a7e2c840f883af3f047e80a4`
 * (see concord-crypto.test.ts). The scope is NOT part of the commitment — the
 * rekey's own `scope`/`newepoch` tags carry it; the commitment only proves the
 * rotator held the PREVIOUS (epoch, key) it claims to extend.
 */
export function epochKeyCommitment(epoch: bigint, key: Uint8Array): string {
  return bytesToHex(sha256(concatBytes(utf8ToBytes("concord/epoch-key-commitment"), u64BE(epoch), key)));
}

/**
 * Legacy (pre-Vector-conformance) epoch-key commitment:
 *   sha256( utf8("concord/epoch-commit") ‖ 0x00 ‖ scope_id[32] ‖ epoch_be[8] ‖ key )
 * Different label, includes scope_id + a 0x00 separator, and a different field
 * order. Retained ONLY so the RECEIVE path can dual-verify an in-flight rekey
 * chain minted by our older clients; new rekeys always emit the Vector form.
 *
 * CAVEAT (mid-chain switch): a member who last applied a LEGACY-form rekey holds
 * a key whose continuation could be committed either way. The receiver accepts
 * both. Once every participant has rotated past the switch, only the new form
 * appears. There is no scenario where accepting the extra legacy form weakens
 * the check — the commitment is a continuity proof, not an authority gate
 * (authority is enforced separately in receiveRekey), and forging either form
 * still requires knowing the previous key.
 */
export function epochKeyCommitmentLegacy(scopeId: string, epoch: bigint, key: Uint8Array): string {
  return bytesToHex(sha256(concatBytes(utf8ToBytes("concord/epoch-commit"), new Uint8Array([0x00]), hexToBytes(scopeId), u64BE(epoch), key)));
}

/** scope_id for a rekey: a channel's id, or all-zeros for a community_root base rotation. */
export function rekeyScopeId(channelId?: string): string {
  return channelId ?? "00".repeat(32);
}

/**
 * CORD-06 §2 dedicated rekey-pseudonym addresses — where a rotation's kind-3303
 * chunks live on the wire (spec-conformant path; cross-client with Vector).
 *
 * Channel rekey address:
 *   group_key("concord/rekey-pseudonym", addressing_root, channel_id, new_epoch)
 * Base-rotation (Refounding) address:
 *   group_key("concord/base-rekey-pseudonym", prior_root, community_id, new_epoch)
 *
 * The deriving secret is the COMMUNITY ROOT (never the channel key), so any
 * root-holding member recovers any epoch's rekey directly. For a base rotation
 * it is always the PRIOR root — the one handle every retained member still
 * holds through the rotation (CORD-06 §2/§3, CORD-02 A.6). For a channel rekey
 * Vector's reference distinguishes: a STANDALONE channel rekey rides the
 * CURRENT root; a removal-companion channel rekey rides the PRIOR root
 * alongside the base rekey (vector-core community/v2/rekey.rs
 * channel_rekey_group). Receivers cover both by deriving under every held root.
 *
 * Golden vectors: Vector derive.rs pins
 *   channel_rekey_group_key(secret, chan, Epoch(1)).pk = 7c55cdb9…5e87e8b5
 *   base_rekey_group_key(secret, cid, Epoch(1)).pk     = fb2fa44f…98dd9dea
 * (asserted in concord-crypto.test.ts).
 */
export function channelRekeyAddress(addressingRoot: Uint8Array, channelId: string, newEpoch: bigint): GroupKey {
  return groupKey(LABEL_REKEY_PSEUDONYM, addressingRoot, channelId, newEpoch);
}
export function baseRekeyAddress(priorRoot: Uint8Array, communityId: string, newEpoch: bigint): GroupKey {
  return groupKey(LABEL_BASE_REKEY_PSEUDONYM, priorRoot, communityId, newEpoch);
}

// ── CORD-06 §3 / CORD-02 §5: Refounding guestbook snapshot ───────────────────
/**
 * The Guestbook Plane address a Refounding's kind-3312 snapshot is published to
 * — the NEW epoch's Guestbook, keyed by the NEW `community_root`:
 *   group_key("concord/guestbook", new_root, community_id, new_epoch)
 * Identical derivation to every other Guestbook event (CORD-02 §5); a snapshot
 * is just a refounder-signed 3312 rumor riding the ordinary guestbook stream, so
 * a fresh joiner who holds only the new root resolves it with the same address
 * they already use for Joins/Leaves. Byte-for-byte matched to Vector's
 * `guestbook_group_key` (golden `GOLDEN_GUESTBOOK_E0_PK`, concord-crypto.test.ts).
 */
export function guestbookAddress(root: Uint8Array, communityId: string, epoch: bigint): GroupKey {
  return groupKey(LABEL_GUESTBOOK, root, communityId, epoch);
}

const GUESTBOOK_SNAPSHOT_LABEL = "concord/guestbook-snapshot";
/**
 * The `["snap", <id>, <i>, <n>]` snapshot id shared by every chunk of one
 * Refounding's snapshot (CORD-02 §5: "one id + one created_at across all n
 * chunks"). The id is OPAQUE to readers — the spec/Vector never derive it (Vector
 * mints a random 32 bytes, `community::random_32`), so it is not a frozen
 * derivation and carries no cross-client contract: a reader takes it verbatim
 * from the tag purely to group a snapshot's chunks. We derive it DETERMINISTICALLY
 * from `(community_id, new_epoch)` instead of randomly, so a resumed/retried
 * Refounding re-emits the SAME id (relays dedup it) rather than minting a second,
 * redundant snapshot set — the same idempotency discipline the rekey path gets
 * from `mint_or_reuse_rotation_key`. There is exactly one Refounding per epoch,
 * so `(community_id, epoch)` uniquely names its snapshot. Wire-compatible with
 * Vector either way (they read, never recompute, the id).
 */
export function deriveSnapshotId(communityId: string, epoch: bigint): string {
  const info = concatBytes(utf8ToBytes(GUESTBOOK_SNAPSHOT_LABEL), new Uint8Array([0x00]), hexToBytes(communityId), u64BE(epoch));
  return bytesToHex(sha256(info));
}

// ── Small exports the higher layers reuse ────────────────────────────────────
export { u64BE, concatBytes, bytesToBigIntBE };
export function randomBytes32(): Uint8Array {
  return generateSecretKey(); // 32 cryptographically-random bytes
}
