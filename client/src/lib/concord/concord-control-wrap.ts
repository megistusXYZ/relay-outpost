/**
 * control_wrap (CORD-04 §3): how a promotion delivers the admin-plane secret.
 *
 * "A Grant that first makes its member staff obliges the granter … to deliver
 * the current control_root in the Grant itself": NIP-44 under the
 * granter↔member pairwise conversation key, its plaintext the fixed-width 40
 * bytes `epoch_be[8] ‖ control_root[32]`. "The recipient adopts the secret only
 * if it derives to exactly the control_pk they hold for the named epoch; any
 * mismatch is dropped, never adopted."
 *
 * NIP-44 carries a string, so the 40 bytes travel base64-encoded, the same
 * convention our rekey blobs use (concord-rekey). Not yet checked against
 * another client's control_wrap.
 */
import type { ISigner } from "applesauce-signers";
import { bytesToHex } from "@noble/hashes/utils.js";
import { groupKey, u64BE, concatBytes, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { computeEditionId, VSK, type ControlEdition } from "./concord-events";

const WRAP_BYTES = 40;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wrap the epoch's control_root for the member being made staff. */
export async function sealControlWrap(signer: ISigner, memberPubkey: string, epoch: number, controlRoot: Uint8Array): Promise<string> {
  if (!signer.nip44) throw new Error("sealControlWrap: this signer can't encrypt");
  if (controlRoot.length !== 32) throw new Error("sealControlWrap: control_root must be 32 bytes");
  return signer.nip44.encrypt(memberPubkey, toBase64(concatBytes(u64BE(BigInt(epoch)), controlRoot)));
}

/**
 * Open a control_wrap addressed to this member. The control_root (hex) only
 * when it is for the epoch they hold and derives to that epoch's control_pk;
 * null otherwise, including for anyone it wasn't made for.
 */
export async function openControlWrap(
  signer: ISigner,
  granterPubkey: string,
  wrap: unknown,
  held: { communityId: string; epoch: number; controlPk: string },
): Promise<string | null> {
  if (!signer.nip44 || typeof wrap !== "string") return null;
  let bytes: Uint8Array;
  try { bytes = fromBase64(await signer.nip44.decrypt(granterPubkey, wrap)); } catch { return null; }
  if (bytes.length !== WRAP_BYTES) return null;
  let epoch = 0n;
  for (const b of bytes.slice(0, 8)) epoch = (epoch << 8n) | BigInt(b);
  if (epoch !== BigInt(held.epoch)) return null;
  const root = bytes.slice(8, WRAP_BYTES);
  if (groupKey(LABEL_CONTROL_SIGNER, root, held.communityId, epoch).pk !== held.controlPk) return null;
  return bytesToHex(root);
}

/**
 * The control_wrap in the grant that currently stands for `me`, with the
 * granter who sealed it (the key it opens under). Only the fold's head counts:
 * a wrap in an edition a newer one replaced (a revoke) is history, not a
 * delivery. Matched on the grant's `member`, not its coordinate, so grants
 * addressed by the spec's derived locator are found as well as ours.
 */
export function controlWrapFor(
  editions: ControlEdition[],
  heads: Map<string, { ev: number; hash: string }>,
  me: string,
): { wrap: string; granter: string } | null {
  for (const e of editions) {
    if (e.vsk !== VSK.GRANT) continue;
    let data: { member?: unknown; control_wrap?: unknown };
    try { data = JSON.parse(e.content); } catch { continue; }
    if (data?.member !== me) continue;
    const head = heads.get(`${e.vsk}:${e.eid}`);
    if (!head || head.ev !== e.ev || computeEditionId(e.eid, e.ev, e.ep, e.content) !== head.hash) continue;
    return typeof data.control_wrap === "string" ? { wrap: data.control_wrap, granter: e.pubkey } : null;
  }
  return null;
}
