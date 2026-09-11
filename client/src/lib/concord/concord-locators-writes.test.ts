/**
 * What role changes and bans put on the wire: the spec's derived coordinates,
 * with real crypto (only IndexedDB is stubbed). A cursor this device kept for
 * the old coordinate names a chain at a different address, so it never becomes
 * the parent of an edition at the new one.
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
import { setMemberRoles, unbanMember } from "./concord-governance";
import { decodeStreamEvent, governancePlanes } from "./concord-stream";
import { deriveCommunityId, groupKey, LABEL_CONTROL_SIGNER } from "./concord-crypto";
import { parseControlEdition, VSK, PERM, type Role } from "./concord-events";
import { grantLocator, banlistLocator } from "./concord-locators";
import type { StoredCommunity } from "./concord-keys";

const ownerSk = generateSecretKey();
const owner = getPublicKey(ownerSk);
const signer = {
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, ownerSk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(ownerSk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(ownerSk, pk)),
  },
} as unknown as ISigner;
const member = getPublicKey(generateSecretKey());
const alice = "a1".repeat(32), bob = "b2".repeat(32);
const salt = bytesToHex(generateSecretKey());
const cid = deriveCommunityId(owner, salt);
const controlRoot = generateSecretKey();
/** A group this device has already granted and banned in, at the old coordinates. */
const group: StoredCommunity = {
  community_id: cid, owner, owner_salt: salt, community_root: bytesToHex(generateSecretKey()), root_epoch: 0,
  control_pk: groupKey(LABEL_CONTROL_SIGNER, controlRoot, cid, 0n).pk, control_root: bytesToHex(controlRoot),
  channels: [], relays: ["wss://r"], name: "Book Club", addedAt: 0, adminRolePublished: true,
  grantVersions: { [member]: { version: 3, eid: "ab".repeat(32) } },
  banVersion: 4, banEid: "cd".repeat(32), banSnapshot: [alice, bob],
};
const MOD = "e5".repeat(32);
const roles = new Map<string, Role>([[MOD, { role_id: MOD, name: "Mod", position: 2, permissions: PERM.KICK, scope: { kind: "server" } }]]);

const editionsIn = (published: Event[]) => {
  const planes = new Map(governancePlanes(group).map((p) => [p.pk, p]));
  return published.flatMap((e) => {
    const plane = planes.get(e.pubkey);
    const rumor = plane ? decodeStreamEvent(plane, e) : null;
    const ed = rumor ? parseControlEdition(rumor) : null;
    return ed ? [ed] : [];
  });
};
const capture = () => { const published: Event[] = []; return { published, publish: async (e: Event) => { published.push(e); } }; };

describe("role changes land at the spec's address (CORD-04 §2)", () => {
  it("a member's grant is written at grant_locator, starting its own chain there", async () => {
    const { published, publish } = capture();
    const updated = await setMemberRoles(signer, owner, group, member, { before: [], after: [MOD], roles }, undefined, true, publish, async () => {});
    const ed = editionsIn(published).find((e) => e.vsk === VSK.GRANT)!;
    expect(ed.eid).toBe(grantLocator(cid, member));
    expect(ed.ev).toBe(1);
    expect(ed.ep).toBeUndefined();
    expect(JSON.parse(ed.content)).toMatchObject({ member, role_ids: [MOD] });
    expect(updated.grantVersions?.[member]).toMatchObject({ version: 1, coord: grantLocator(cid, member) });
  });

  it("the next change chains onto the head at that address", async () => {
    const { published, publish } = capture();
    const head = { ev: 2, hash: "f0".repeat(32) };
    await setMemberRoles(signer, owner, group, member, { before: [MOD], after: [], roles }, head, true, publish, async () => {});
    const ed = editionsIn(published).find((e) => e.vsk === VSK.GRANT)!;
    expect(ed).toMatchObject({ eid: grantLocator(cid, member), ev: 3, ep: head.hash });
  });
});

describe("bans land at the spec's address (CORD-04 §4)", () => {
  it("an unban writes the list at banlist_locator, carrying every other ban it knows", async () => {
    const { published, publish } = capture();
    const updated = await unbanMember(signer, owner, group, alice, { currentBanlist: [alice, bob] }, publish);
    const ed = editionsIn(published).find((e) => e.vsk === VSK.BANLIST)!;
    expect(ed.eid).toBe(banlistLocator(cid));
    expect(ed.ev).toBe(1);
    expect(JSON.parse(ed.content)).toEqual([bob]);
    expect(updated.banCoord).toBe(banlistLocator(cid));
  });
});
