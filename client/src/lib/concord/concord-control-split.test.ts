/**
 * The Control Plane split (CORD-02 §2/§5, CORD-06 §2). The spec landed it on
 * 2026-08-06, after we built ours (found in the 2026-09-11 deep dive):
 *
 *   control_pk       = group_key("concord/control-signer", control_root, community_id, epoch).pk
 *   control_conv_key = group_key("concord/control",        community_root, community_id, epoch).conv_key
 *
 * The admin plane's ADDRESS (and wrap signer) derives from a staff-only
 * control_root; its ENCRYPTION still derives from community_root, so every
 * member reads it and only staff write it. Members learn control_pk from
 * invites, the Community List and base rekey blobs. We only ever listened at
 * the legacy address, so in a group a current app made we would see no rooms,
 * no name and no roles. Legacy epochs MUST stay readable.
 */
import { describe, it, expect } from "vitest";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import {
  groupKey, planeConvKey, LABEL_CONTROL, LABEL_CONTROL_SIGNER, KIND_SEAL_PLAIN,
  computeLocator, epochKeyCommitment, concatBytes, u64BE, rekeyScopeId,
} from "./concord-crypto";
import { governancePlanes, publishToPlane, publishControlEdition, decodeStreamEvent } from "./concord-stream";
import { buildControlEdition, parseControlEdition, VSK, type Member } from "./concord-events";
import { adoptBaseRekey, type StoredCommunity } from "./concord-keys";
import { recordFromBundle, bundleFromCommunity, type InviteBundle } from "./concord-invites";
import { receiveRekey, type RekeyAuthority } from "./concord-rekey";

const signer = (sk: Uint8Array) => ({
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;
const b64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const memberSk = generateSecretKey();
const memberPk = getPublicKey(memberSk);
const cid = bytesToHex(generateSecretKey());
const root = generateSecretKey();
const controlRoot = generateSecretKey();
const readKey = groupKey(LABEL_CONTROL, root, cid, 0n);
const signerKey = groupKey(LABEL_CONTROL_SIGNER, controlRoot, cid, 0n);
const now = 1_789_000_000;

/** What a member holds after joining a current-spec group: the group key and the admin address. */
const member: StoredCommunity = {
  community_id: cid, owner, owner_salt: "11".repeat(32), community_root: bytesToHex(root), root_epoch: 0,
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0, control_pk: signerKey.pk,
};

/** How staff in a current-spec app write to the admin plane: signed by the
 *  control signer, encrypted under the members' read key. */
async function staffWrites(content: unknown): Promise<Event> {
  const out: Event[] = [];
  await publishToPlane(signer(ownerSk), owner, { ...signerKey, conv: planeConvKey(readKey) },
    buildControlEdition(owner, VSK.METADATA, cid, 1, content, now), KIND_SEAL_PLAIN, async (e) => { out.push(e); }, now);
  return out[0];
}

describe("reading the admin plane of a group a current-spec app made", () => {
  it("a member holding only the group key and control_pk reads what staff wrote at the admin address", async () => {
    const wrap = await staffWrites({ name: "Book Club", relays: [] });
    expect(wrap.pubkey).toBe(signerKey.pk);
    const plane = governancePlanes(member).find((p) => p.pk === wrap.pubkey);
    expect(plane).toBeDefined();
    const edition = parseControlEdition(decodeStreamEvent(plane!, wrap)!);
    expect(JSON.parse(edition!.content).name).toBe("Book Club");
  });

  it("still reads the legacy address, for older epochs and groups not yet upgraded", () => {
    expect(governancePlanes(member).map((p) => p.pk)).toContain(readKey.pk);
  });

  it("a legacy group, with no control_pk, is read at the legacy address only", () => {
    const pks = governancePlanes({ ...member, control_pk: undefined }).map((p) => p.pk);
    expect(pks).toContain(readKey.pk);
    expect(pks).not.toContain(signerKey.pk);
  });

  it("a member's view of the admin plane can read but never write: it holds no signing key", () => {
    expect(governancePlanes(member).find((p) => p.pk === signerKey.pk)!.sk).toBeUndefined();
  });

  it("after a rotation, the previous epoch's admin plane stays readable alongside the new one", () => {
    const nextPk = groupKey(LABEL_CONTROL_SIGNER, generateSecretKey(), cid, 1n).pk;
    const pks = governancePlanes(adoptBaseRekey(member, bytesToHex(generateSecretKey()), 1, { controlPk: nextPk })).map((p) => p.pk);
    expect(pks).toContain(signerKey.pk);
    expect(pks).toContain(nextPk);
  });
});

describe("joining by a current-spec invite", () => {
  const bundle = (over: Partial<InviteBundle> = {}): InviteBundle => ({
    community_id: cid, owner, owner_salt: "11".repeat(32), community_root: bytesToHex(root), root_epoch: 0,
    control_pk: signerKey.pk, channels: [], relays: ["wss://r"], name: "Book Club", ...over,
  });

  it("gives the new member the admin address, so they see the group's rooms, name and roles", () => {
    const record = recordFromBundle(bundle(), []);
    expect(record.control_pk).toBe(signerKey.pk);
    expect(governancePlanes(record).map((p) => p.pk)).toContain(signerKey.pk);
  });

  it("ignores a control_pk that isn't a key", () => {
    expect(recordFromBundle(bundle({ control_pk: "npub1notakey" }), []).control_pk).toBeUndefined();
  });

  it("our own invites pass the admin address on to whoever joins", () => {
    expect(bundleFromCommunity(member).control_pk).toBe(signerKey.pk);
  });
});

describe("base rotations from a current-spec app (CORD-06 §2 blob widths)", () => {
  const base = rekeyScopeId();
  const auth: RekeyAuthority = { ownerPubkey: owner, roster: [{ pubkey: memberPk, joinedAt: 0, roleIds: [], permissions: 0n, rank: 3 } as Member] };
  const newRoot = new Uint8Array(32).fill(5);
  const newControlRoot = generateSecretKey();
  const newControlPk = groupKey(LABEL_CONTROL_SIGNER, newControlRoot, cid, 1n).pk;
  const hexBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

  async function rotation(scope: string, payload: Uint8Array) {
    const wrapped = await signer(ownerSk).nip44!.encrypt(memberPk, b64(payload));
    return [{
      tags: [["scope", scope], ["newepoch", "1"], ["prevepoch", "0"], ["prevcommit", epochKeyCommitment(0n, root)], ["chunk", "1", "1"]],
      content: JSON.stringify([{ locator: computeLocator(owner, memberPk, scope, 1n), wrapped }]),
    }];
  }
  const held = { scopeId: base, myCurrentKey: root, myCurrentEpoch: 0, communityId: cid };

  it("the 104-byte member blob hands members the new admin address with the new group key", async () => {
    const payload = concatBytes(hexBytes(base), u64BE(1n), newRoot, hexBytes(newControlPk));
    const res = await receiveRekey(signer(memberSk), memberPk, owner, held, await rotation(base, payload), auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      expect(bytesToHex(res.newKey)).toBe(bytesToHex(newRoot));
      expect(res.controlPk).toBe(newControlPk);
      expect(res.controlRoot).toBeUndefined();
    }
  });

  it("the 136-byte staff blob also hands over the new control_root, when it derives to that address", async () => {
    const payload = concatBytes(hexBytes(base), u64BE(1n), newRoot, hexBytes(newControlPk), newControlRoot);
    const res = await receiveRekey(signer(memberSk), memberPk, owner, held, await rotation(base, payload), auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") {
      expect(res.controlPk).toBe(newControlPk);
      expect(res.controlRoot).toBe(bytesToHex(newControlRoot));
    }
  });

  it("refuses a staff blob whose control_root doesn't derive to its control_pk", async () => {
    const payload = concatBytes(hexBytes(base), u64BE(1n), newRoot, hexBytes(newControlPk), generateSecretKey());
    const res = await receiveRekey(signer(memberSk), memberPk, owner, held, await rotation(base, payload), auth);
    expect(res.status).toBe("pending");
  });

  it("a legacy 72-byte base blob still rotates, and names no admin address", async () => {
    const payload = concatBytes(hexBytes(base), u64BE(1n), newRoot);
    const res = await receiveRekey(signer(memberSk), memberPk, owner, held, await rotation(base, payload), auth);
    expect(res.status).toBe("rekeyed");
    if (res.status === "rekeyed") expect(res.controlPk).toBeUndefined();
  });

  it("a private room's key delivery must be the 72-byte form; a longer one is dropped", async () => {
    const room = "cc".repeat(32);
    const payload = concatBytes(hexBytes(room), u64BE(1n), newRoot, hexBytes(newControlPk));
    const res = await receiveRekey(signer(memberSk), memberPk, owner, { ...held, scopeId: room }, await rotation(room, payload), auth);
    expect(res.status).toBe("pending");
  });
});

/**
 * Writing the admin plane (CORD-02 §5). Staff sign at control_pk; a device
 * without the epoch's control_root keeps the legacy address, which our
 * clients always read, rather than write somewhere members can't.
 */
describe("writing the admin plane", () => {
  const ownerView: StoredCommunity = { ...member, control_root: bytesToHex(controlRoot) };
  async function write(record: StoredCommunity): Promise<Event> {
    const out: Event[] = [];
    await publishControlEdition(signer(ownerSk), owner, record,
      buildControlEdition(owner, VSK.METADATA, cid, 1, { name: "Book Club", relays: [] }, now), async (e) => { out.push(e); });
    return out[0];
  }

  it("the owner of a split group writes at the split address, where every member reads it", async () => {
    const wrap = await write(ownerView);
    expect(wrap.pubkey).toBe(signerKey.pk);
    const plane = governancePlanes(member).find((p) => p.pk === wrap.pubkey)!;
    expect(JSON.parse(parseControlEdition(decodeStreamEvent(plane, wrap)!)!.content).name).toBe("Book Club");
  });

  it("a device without the group's control_root keeps writing at the legacy address", async () => {
    expect((await write(member)).pubkey).toBe(readKey.pk);
  });

  it("never writes where members can't read: a control_root that doesn't match the group's address falls back to legacy", async () => {
    expect((await write({ ...ownerView, control_root: bytesToHex(generateSecretKey()) })).pubkey).toBe(readKey.pk);
  });

  it("the owner's own view of the admin plane holds its key, so it can answer relay AUTH as that address", () => {
    expect(governancePlanes(ownerView).find((p) => p.pk === signerKey.pk)!.sk).toBeDefined();
  });
});
