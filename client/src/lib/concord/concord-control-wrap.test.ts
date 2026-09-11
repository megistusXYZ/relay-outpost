/**
 * control_wrap (CORD-04 §3): "A Grant that first makes its member staff
 * obliges the granter … to deliver the current control_root in the Grant
 * itself": the secret NIP-44-encrypted under the granter↔member pairwise key,
 * its plaintext the fixed-width 40 bytes epoch_be[8] ‖ control_root[32]. "The
 * recipient adopts the secret only if it derives to exactly the control_pk
 * they hold for the named epoch; any mismatch is dropped, never adopted."
 * Until now an admin got the secret only at the next removal (C2b).
 */
import { describe, it, expect } from "vitest";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { groupKey, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { sealControlWrap, openControlWrap, controlWrapFor } from "./concord-control-wrap";
import { foldEditions, VSK, ADMIN_ROLE_ID, computeEditionId, type ControlEdition } from "./concord-events";

const signer = (sk: Uint8Array) => ({
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const adminSk = generateSecretKey();
const admin = getPublicKey(adminSk);
const cid = bytesToHex(generateSecretKey());
const controlRoot = generateSecretKey();
const controlPk = groupKey(LABEL_CONTROL_SIGNER, controlRoot, cid, 3n).pk;
const held = { communityId: cid, epoch: 3, controlPk };

describe("control_wrap: a promotion hands the new admin the admin-plane secret", () => {
  it("the new admin opens the owner's wrap and gets the current control_root", async () => {
    const wrap = await sealControlWrap(signer(ownerSk), admin, 3, controlRoot);
    expect(await openControlWrap(signer(adminSk), owner, wrap, held)).toBe(bytesToHex(controlRoot));
  });

  it("refuses a wrap for another epoch: a stale secret never becomes the current one", async () => {
    const wrap = await sealControlWrap(signer(ownerSk), admin, 2, controlRoot);
    expect(await openControlWrap(signer(adminSk), owner, wrap, held)).toBeNull();
  });

  it("refuses a secret that doesn't derive to the admin address the member holds", async () => {
    const wrap = await sealControlWrap(signer(ownerSk), admin, 3, generateSecretKey());
    expect(await openControlWrap(signer(adminSk), owner, wrap, held)).toBeNull();
  });

  it("nobody but the admin it was made for can open it", async () => {
    const wrap = await sealControlWrap(signer(ownerSk), admin, 3, controlRoot);
    expect(await openControlWrap(signer(generateSecretKey()), owner, wrap, held)).toBeNull();
  });
});

/**
 * Receiving it: the member's app looks at the grant that CURRENTLY stands for
 * them. A wrap in a grant that a newer edition has since replaced (a revoke)
 * is history, not a delivery.
 */
describe("controlWrapFor: the wrap in the grant that currently stands for me", () => {
  const grant = (ev: number, content: object, rumorId: string, prev?: object): ControlEdition => ({
    vsk: VSK.GRANT, eid: admin, ev,
    ep: prev ? computeEditionId(admin, ev - 1, undefined, JSON.stringify(prev)) : undefined,
    content: JSON.stringify(content), rumorId, pubkey: owner,
  });
  const promoted = { member: admin, role_ids: [ADMIN_ROLE_ID], control_wrap: "wrap-v1" };

  it("finds the wrap and who granted it", () => {
    const editions = [grant(1, promoted, "r1")];
    expect(controlWrapFor(editions, foldEditions(editions, owner).heads, admin)).toEqual({ wrap: "wrap-v1", granter: owner });
  });

  it("ignores a wrap in a grant a newer edition replaced", () => {
    const editions = [grant(1, promoted, "r1"), grant(2, { member: admin, role_ids: [] }, "r2", promoted)];
    expect(controlWrapFor(editions, foldEditions(editions, owner).heads, admin)).toBeNull();
  });

  it("finds nothing for someone the grant isn't for", () => {
    const editions = [grant(1, promoted, "r1")];
    expect(controlWrapFor(editions, foldEditions(editions, owner).heads, owner)).toBeNull();
  });
});
