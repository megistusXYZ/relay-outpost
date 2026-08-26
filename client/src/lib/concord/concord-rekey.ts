/**
 * Concord rekey (CORD-06): rotate a scope's key to cut off removed members.
 * Every remaining member gets a per-recipient blob (locator + pairwise-encrypted
 * 72-byte payload); a member who holds all chunks but finds no matching locator
 * has been removed. The rotator must strictly outrank every target.
 *
 * The blob layout, locator matching, chunk-completeness, and removal detection
 * are pure and unit-tested; the pairwise NIP-44 (signer) I/O is not.
 */
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, type Event } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { computeLocator, epochKeyCommitment, epochKeyCommitmentLegacy, channelRekeyAddress, baseRekeyAddress, u64BE, concatBytes, type GroupKey } from "./concord-crypto";
import { KIND_REKEY, buildJoinLeaveRumor, hasPermission, canActOn, PERM, OWNER_POSITION, type RumorTemplate, type Member } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";
import { controlPlaneKey, publishToPlane } from "./concord-stream";
import { KIND_SEAL_PLAIN, KIND_SEAL_ENC } from "./concord-crypto";

/**
 * Recipients (blobs) per 3303 chunk. Matched to Vector's SEND cap
 * (`MAX_REKEY_BLOBS_PER_EVENT = 80`, vector-core rekey.rs): the spec's stated
 * 120 overflows strfry's 64 KB `maxEventSize` once the blob array rides the
 * CORD-01 double-wrap (~77 KB at 120; ~55 KB at 80). Receivers stay tolerant —
 * chunk parsing here has no per-event blob floor/ceiling tied to this constant.
 */
const PSEUDONYM_CHUNK = 80;

export interface RekeyBlob { locator: string; wrapped: string }

// ── Pure payload codec (CORD-06 §2) ──────────────────────────────────────────
/** 72-byte wrapped plaintext: scope_id[32] ‖ epoch_be[8] ‖ new_key[32]. */
export function buildRekeyPayload(scopeId: string, epoch: bigint, newKey: Uint8Array): Uint8Array {
  if (newKey.length !== 32) throw new Error("newKey must be 32 bytes");
  return concatBytes(hexToBytes(scopeId), u64BE(epoch), newKey);
}
export function parseRekeyPayload(payload: Uint8Array): { scopeId: string; epoch: bigint; newKey: Uint8Array } | null {
  if (payload.length !== 72) return null;
  const scopeId = bytesToHex(payload.slice(0, 32));
  let epoch = 0n;
  for (const b of payload.slice(32, 40)) epoch = (epoch << 8n) | BigInt(b);
  return { scopeId, epoch, newKey: payload.slice(40, 72) };
}

/** Split recipient pubkeys into chunk groups (each becomes one 3303 event). */
export function chunkRecipients<T>(recipients: T[], perChunk = PSEUDONYM_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < recipients.length; i += perChunk) out.push(recipients.slice(i, i + perChunk));
  if (out.length === 0) out.push([]); // always at least one chunk
  return out;
}

/** Find the blob addressed to me across a chunk's blobs. */
export function matchOwnBlob(blobs: RekeyBlob[], myLocator: string): RekeyBlob | null {
  return blobs.find((b) => b.locator === myLocator) ?? null;
}

/**
 * Removal detection (CORD-06 §4): only once ALL n chunks are present and none
 * carries my locator am I removed. A missing chunk is never a removal.
 */
export function isRemoved(chunks: { i: number; n: number; blobs: RekeyBlob[] }[], myLocator: string): boolean {
  if (chunks.length === 0) return false;
  const n = chunks[0].n;
  const have = new Set(chunks.map((c) => c.i));
  if (have.size < n) return false; // incomplete → not a removal
  return !chunks.some((c) => c.blobs.some((b) => b.locator === myLocator));
}

// ── Rekey authority (CORD-04/06) ─────────────────────────────────────────────
/** The folded authority a receiver checks a rotation against: the community
 *  owner + the current roster (rank + permission bits per member). */
export interface RekeyAuthority { ownerPubkey: string; roster: Member[] }

/** All-zeros scope id = a community_root base rotation (Refounding). */
const BASE_SCOPE = "00".repeat(32);

/**
 * Whether `rotatorPubkey` may rotate the given scope's key — CORD-06 §Authority:
 * "A single-channel Rekey requires MANAGE_CHANNELS, a Refounding requires BAN."
 * The owner is always authorized. (Previous rule was owner-or-MANAGE_ROLES,
 * a pre-spec guess that rejected every non-owner admin's removal-rekey — the
 * built-in Admin role holds BAN + MANAGE_CHANNELS, not MANAGE_ROLES.)
 */
export function isAuthorizedRotator(rotatorPubkey: string, auth: RekeyAuthority, scopeId: string = BASE_SCOPE): boolean {
  if (rotatorPubkey === auth.ownerPubkey) return true;
  const m = auth.roster.find((x) => x.pubkey === rotatorPubkey);
  if (!m) return false;
  return hasPermission(m, scopeId === BASE_SCOPE ? PERM.BAN : PERM.MANAGE_CHANNELS);
}

function rankOf(pubkey: string, auth: RekeyAuthority): number {
  if (pubkey === auth.ownerPubkey) return OWNER_POSITION;
  const m = auth.roster.find((x) => x.pubkey === pubkey);
  return m ? m.rank : Infinity;
}

/** Whether the rotator strictly outranks a target (owner outranks everyone). */
export function rotatorOutranks(rotatorPubkey: string, targetPubkey: string, auth: RekeyAuthority): boolean {
  return canActOn(rankOf(rotatorPubkey, auth), rankOf(targetPubkey, auth));
}

// ── Send a rekey (I/O) ────────────────────────────────────────────────────────
export interface RekeyRecipient { pubkey: string }

/**
 * Rotate a scope key. For each remaining member, compute their locator and
 * pairwise-encrypt the 72-byte payload; chunk and publish kind-3303 rumors.
 * `pairwiseEncrypt` wraps `signer.nip44.encrypt` (serialize via the decryption
 * queue in the caller). `onProgress(done,total)` powers the "re-securing keys"
 * UI. Returns the new key + epoch to persist locally.
 *
 * DUAL-WRITE (transition): every chunk publishes to BOTH locations —
 *  1. the CORD-06 §2 dedicated rekey-pseudonym address (spec-conformant:
 *     encrypted 20013 seal signed by the rotator, wrap signed by the rekey
 *     group key) — what Vector/Amethyst subscribe to; and
 *  2. the community control plane with a plaintext 20014 seal — our LEGACY
 *     location, which every currently-deployed Relay Outpost client reads.
 * The same rumor (same id) rides both wraps, so a dual-reading client
 * processes the rotation exactly once. RETIREMENT PLAN: once the deployed
 * fleet reads the pseudonym addresses (dual-read shipped in the same release
 * as this write), the legacy control-plane publish is deleted in a later
 * release; the spec address then remains as the only location.
 *
 * NOTE: callers invoke this BEFORE adopting the new key locally, so
 * `community.community_root` is still the PRIOR root — exactly the addressing
 * secret CORD-06 §2 requires for both scopes.
 */
export async function sendRekey(
  signer: ISigner,
  rotatorPubkey: string,
  community: StoredCommunity,
  params: { scopeId: string; prevEpoch: number; prevKey: Uint8Array; newKey: Uint8Array; remaining: RekeyRecipient[] },
  publish: (event: Event, relays: string[]) => Promise<unknown>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ newEpoch: number } | null> {
  if (!signer.nip44) return null;
  const newEpoch = params.prevEpoch + 1;
  // EMIT the Vector-conformant commitment (label ‖ epoch ‖ key, no scope_id).
  const prevcommit = epochKeyCommitment(BigInt(params.prevEpoch), params.prevKey);
  const payload = buildRekeyPayload(params.scopeId, BigInt(newEpoch), params.newKey);
  const payloadB64 = bytesToBase64(payload);

  const groups = chunkRecipients(params.remaining, PSEUDONYM_CHUNK);
  const n = groups.length;
  let done = 0;
  const total = params.remaining.length;

  const legacyPlane = controlPlaneKey(community);
  // CORD-06 §2 pseudonym address: base rotations under the (still-prior)
  // community_root + community_id; channel rotations under the community_root +
  // channel_id. Both at the NEW epoch.
  const rootBytes = hexToBytes(community.community_root);
  const specPlane = params.scopeId === BASE_SCOPE
    ? baseRekeyAddress(rootBytes, community.community_id, BigInt(newEpoch))
    : channelRekeyAddress(rootBytes, params.scopeId, BigInt(newEpoch));
  const createdAt = Math.floor(Date.now() / 1000);
  for (let i = 0; i < groups.length; i++) {
    const blobs: RekeyBlob[] = [];
    for (const r of groups[i]) {
      const locator = computeLocator(rotatorPubkey, r.pubkey, params.scopeId, BigInt(newEpoch));
      // Pairwise NIP-44 to the recipient — payload is already ciphertext of the raw bytes.
      const wrapped = await signer.nip44.encrypt(r.pubkey, payloadB64).catch(() => null);
      if (wrapped) blobs.push({ locator, wrapped });
      onProgress?.(++done, total);
    }
    const rumor: RumorTemplate = {
      kind: KIND_REKEY,
      pubkey: rotatorPubkey,
      created_at: createdAt,
      content: JSON.stringify(blobs),
      tags: [
        ["scope", params.scopeId],
        ["newepoch", String(newEpoch)],
        ["prevepoch", String(params.prevEpoch)],
        ["prevcommit", prevcommit],
        // 1-BASED chunk indices (CORD-06 / Vector: `i >= 1, i <= n`; Vector
        // rejects a 0th chunk). Our receive side counts distinct indices, so
        // both this and the old 0-based form keep working on the legacy path.
        ["chunk", String(i + 1), String(n)],
      ],
    };
    // Spec path first (the durable, cross-client location), then legacy.
    await publishToPlane(signer, rotatorPubkey, specPlane, rumor, KIND_SEAL_ENC, (e) => publish(e, community.relays), createdAt).catch(() => null);
    await publishToPlane(signer, rotatorPubkey, legacyPlane, rumor, KIND_SEAL_PLAIN, (e) => publish(e, community.relays), createdAt).catch(() => null);
  }
  return { newEpoch };
}

/**
 * Receive/apply rekeys for a scope. Given the collected 3303 rumors, verifies a
 * complete chunk set, matches my locator, decrypts my payload, checks the
 * prevcommit continuity against the key I hold, and returns the new key+epoch —
 * or a "removed" signal. Pairwise decrypt goes through `signer.nip44`.
 *
 * AUTHORITY (CORD-04/06): the rotation is only honored if `rotatorPubkey` holds
 * rekey authority (owner or MANAGE_ROLES, per `auth`). Because evicted peers are
 * pseudonymous (locators reveal no identity), the outrank-every-target rule is
 * enforced from the receiver's own vantage: I refuse MY OWN eviction unless the
 * rotator strictly outranks me. An unauthorized rotator's rotation is ignored.
 */
export async function receiveRekey(
  signer: ISigner,
  myPubkey: string,
  rotatorPubkey: string,
  params: { scopeId: string; myCurrentKey: Uint8Array; myCurrentEpoch: number },
  rumors: { tags: string[][]; content: string }[],
  auth: RekeyAuthority,
): Promise<{ status: "rekeyed"; newKey: Uint8Array; newEpoch: number } | { status: "removed" } | { status: "pending" }> {
  if (!signer.nip44) return { status: "pending" };
  // Ignore rotations from a member who lacks rekey authority for this scope.
  if (!isAuthorizedRotator(rotatorPubkey, auth, params.scopeId)) return { status: "pending" };
  // Parse rumors into chunks for the target newepoch (highest seen).
  const parsed = rumors.map((r) => {
    const get = (k: string) => r.tags.find((t) => t[0] === k);
    const chunk = get("chunk");
    return {
      newepoch: Number(get("newepoch")?.[1] ?? 0),
      prevepoch: Number(get("prevepoch")?.[1] ?? 0),
      prevcommit: get("prevcommit")?.[1] ?? "",
      i: Number(chunk?.[1] ?? 0),
      n: Number(chunk?.[2] ?? 0),
      blobs: safeParseBlobs(r.content),
    };
  }).filter((r) => r.prevepoch === params.myCurrentEpoch); // only rotations extending my key
  if (parsed.length === 0) return { status: "pending" };

  const newEpoch = Math.max(...parsed.map((p) => p.newepoch));
  const chunks = parsed.filter((p) => p.newepoch === newEpoch);
  // DUAL-VERIFY continuity: accept the Vector-conformant commitment (emitted by
  // current clients) OR the legacy form (in-flight rekey chains from our older
  // clients). We only ever EMIT the new form; see epochKeyCommitmentLegacy for
  // the mid-chain-switch caveat.
  const expectCommit = epochKeyCommitment(BigInt(params.myCurrentEpoch), params.myCurrentKey);
  const expectCommitLegacy = epochKeyCommitmentLegacy(params.scopeId, BigInt(params.myCurrentEpoch), params.myCurrentKey);
  if (!chunks.every((c) => c.prevcommit === expectCommit || c.prevcommit === expectCommitLegacy)) return { status: "pending" }; // not our continuation

  const myLocator = computeLocator(rotatorPubkey, myPubkey, params.scopeId, BigInt(newEpoch));
  if (isRemoved(chunks.map((c) => ({ i: c.i, n: c.n, blobs: c.blobs })), myLocator)) {
    // Refuse my own eviction from a rotator who does not strictly outrank me.
    return rotatorOutranks(rotatorPubkey, myPubkey, auth) ? { status: "removed" } : { status: "pending" };
  }

  for (const c of chunks) {
    const blob = matchOwnBlob(c.blobs, myLocator);
    if (!blob) continue;
    const b64 = await signer.nip44.decrypt(rotatorPubkey, blob.wrapped).catch(() => null);
    if (!b64) continue;
    const payload = parseRekeyPayload(base64ToBytes(b64));
    if (payload && payload.epoch === BigInt(newEpoch) && payload.scopeId === params.scopeId) {
      return { status: "rekeyed", newKey: payload.newKey, newEpoch };
    }
  }
  return { status: "pending" };
}

/**
 * Receive an INITIAL private-channel key grant (CORD-03: an independent key
 * "delivered on grant"; CORD-06 channel-scoped rekey with nothing held yet).
 * Unlike `receiveRekey` there is no continuity to verify — the receiver holds
 * no prior key for the scope — so the gate is: the rotator must hold channel
 * rekey authority (owner or MANAGE_CHANNELS), my locator must be present, and
 * the decrypted payload's scope/epoch must match the event's tags. This is the
 * ONLY path by which a member gains a private channel's key; invite bundles
 * exclude private channels entirely (see concord-invites bundleFromCommunity).
 * Returns the delivered key+epoch, or null when the rumors grant me nothing.
 */
export async function receiveChannelGrant(
  signer: ISigner,
  myPubkey: string,
  rotatorPubkey: string,
  channelId: string,
  rumors: { tags: string[][]; content: string }[],
  auth: RekeyAuthority,
): Promise<{ key: Uint8Array; epoch: number } | null> {
  if (!signer.nip44) return null;
  if (channelId === BASE_SCOPE) return null; // base rotations go through receiveRekey
  if (!isAuthorizedRotator(rotatorPubkey, auth, channelId)) return null;
  const parsed = rumors
    .map((r) => {
      const get = (k: string) => r.tags.find((t) => t[0] === k);
      return {
        scope: get("scope")?.[1] ?? "",
        newepoch: Number(get("newepoch")?.[1] ?? 0),
        blobs: safeParseBlobs(r.content),
      };
    })
    .filter((r) => r.scope === channelId && r.newepoch >= 1);
  if (parsed.length === 0) return null;
  const newEpoch = Math.max(...parsed.map((p) => p.newepoch));
  const myLocator = computeLocator(rotatorPubkey, myPubkey, channelId, BigInt(newEpoch));
  for (const c of parsed.filter((p) => p.newepoch === newEpoch)) {
    const blob = matchOwnBlob(c.blobs, myLocator);
    if (!blob) continue;
    const b64 = await signer.nip44.decrypt(rotatorPubkey, blob.wrapped).catch(() => null);
    if (!b64) continue;
    const payload = parseRekeyPayload(base64ToBytes(b64));
    if (payload && payload.scopeId === channelId && payload.epoch === BigInt(newEpoch)) {
      return { key: payload.newKey, epoch: newEpoch };
    }
  }
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function safeParseBlobs(content: string): RekeyBlob[] {
  try {
    const arr = JSON.parse(content);
    return Array.isArray(arr) ? arr.filter((b) => typeof b?.locator === "string" && typeof b?.wrapped === "string") : [];
  } catch { return []; }
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { PSEUDONYM_CHUNK };
