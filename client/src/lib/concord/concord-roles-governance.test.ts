/**
 * What making and giving roles puts on the wire, with real crypto (only the
 * local IndexedDB writes are stubbed). Giving or taking one role must leave a
 * member's other roles alone: "remove admin" used to publish an empty grant,
 * which would now wipe every other role they hold.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./concord-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./concord-keys")>()),
  putCommunity: async () => {},
  deleteCommunity: async () => {},
  publishCommunityList: async () => {},
}));

import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { createRole, setMemberRoles, setAdmin, ADMIN_ROLE_ID } from "./concord-governance";
import { decodeStreamEvent, governancePlanes } from "./concord-stream";
import { deriveCommunityId, groupKey, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { parseControlEdition, VSK, PERM, type Role } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";

const signer = (sk: Uint8Array) => ({
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
}) as unknown as ISigner;
const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const member = getPublicKey(generateSecretKey());
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const controlRoot = generateSecretKey();
const group: StoredCommunity = {
  community_id: cid, owner, owner_salt: salt, community_root: bytesToHex(generateSecretKey()), root_epoch: 0,
  control_pk: groupKey(LABEL_CONTROL_SIGNER, controlRoot, cid, 0n).pk, control_root: bytesToHex(controlRoot),
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0, adminRolePublished: true,
};
const MOD = "e5".repeat(32), PINNER = "e6".repeat(32), GREETER = "e7".repeat(32);
const role = (id: string, position: number, permissions: bigint): Role => ({ role_id: id, name: id.slice(0, 4), position, permissions, scope: { kind: "server" } });
const roles = new Map<string, Role>([
  [ADMIN_ROLE_ID, role(ADMIN_ROLE_ID, 1, PERM.BAN | PERM.KICK)],
  [MOD, role(MOD, 2, PERM.KICK)],
  [PINNER, role(PINNER, 3, PERM.PIN_MESSAGES)],
  [GREETER, role(GREETER, 4, PERM.CREATE_INVITE)],
]);

/** The admin-plane editions a set of published wraps carries. */
const editionsIn = (published: Event[]) => {
  const planes = new Map(governancePlanes(group).map((p) => [p.pk, p]));
  return published.flatMap((e) => {
    const plane = planes.get(e.pubkey);
    const rumor = plane ? decodeStreamEvent(plane, e) : null;
    const ed = rumor ? parseControlEdition(rumor) : null;
    return ed ? [ed] : [];
  });
};
const grantIn = (published: Event[]) => JSON.parse(editionsIn(published).find((e) => e.vsk === VSK.GRANT)!.content);
const capture = () => { const published: Event[] = []; return { published, publish: async (e: Event) => { published.push(e); } }; };

describe("making a role", () => {
  it("publishes it as the spec shapes it, at the position it was given", async () => {
    const { published, publish } = capture();
    await createRole(signer(ownerSk), owner, group, { name: "Moderator", permissions: PERM.KICK | PERM.PIN_MESSAGES, position: 2 }, publish);
    const ed = editionsIn(published).find((e) => e.vsk === VSK.ROLE)!;
    expect(ed.ev).toBe(1);
    expect(JSON.parse(ed.content)).toMatchObject({ role_id: ed.eid, name: "Moderator", position: 2, permissions: String(PERM.KICK | PERM.PIN_MESSAGES), scope: { kind: "server" } });
  });
});

describe("giving and taking roles", () => {
  it("giving someone a role keeps the roles they already have", async () => {
    const { published, publish } = capture();
    await setMemberRoles(signer(ownerSk), owner, group, member, { before: [ADMIN_ROLE_ID], after: [ADMIN_ROLE_ID, MOD], roles }, undefined, true, publish, async () => {});
    expect(grantIn(published).role_ids).toEqual([ADMIN_ROLE_ID, MOD]);
  });

  it("removing Admin from someone keeps their other roles", async () => {
    const { published, publish } = capture();
    await setAdmin(signer(ownerSk), owner, group, member, false, undefined, true, publish, async () => {}, [ADMIN_ROLE_ID, MOD]);
    expect(grantIn(published).role_ids).toEqual([MOD]);
  });

  it("only the grant that first makes someone staff carries the admin plane's key", async () => {
    const first = capture();
    await setMemberRoles(signer(ownerSk), owner, group, member, { before: [MOD], after: [MOD, PINNER], roles }, undefined, true, first.publish, async () => {});
    expect(typeof grantIn(first.published).control_wrap).toBe("string");
    const again = capture();
    await setMemberRoles(signer(ownerSk), owner, group, member, { before: [PINNER], after: [PINNER, GREETER], roles }, undefined, true, again.publish, async () => {});
    expect(grantIn(again.published).control_wrap).toBeUndefined();
  });
});
