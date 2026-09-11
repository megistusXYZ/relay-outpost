/**
 * The Invite Registry (CORD-05 §5). Each creator of live links lists them, by
 * their locators only, at a coordinate bound to the creator. Members fold every
 * creator's list, honoured only while its author holds CREATE_INVITE, into one
 * set: non-empty means the group is Public, empty means Private.
 */
import { describe, it, expect } from "vitest";
import { foldEditions, computeEditionId, VSK, PERM, type ControlEdition } from "./concord-events";
import { grantLocator, inviteLinksLocator } from "./concord-locators";
import { activeInviteLinks, groupLinksWith, nextRegistryEdition } from "./concord-registry";
import type { StoredInviteSigner } from "./concord-keys";

const hex = (c: string) => c.repeat(64);
const CID = hex("c"), OWNER = hex("0"), ADMIN = "ad".repeat(32), MEMBER = hex("b");
const L1 = hex("1"), L2 = hex("2"), L3 = hex("3");
const ROLE = "70".repeat(32);

let rid = 0;
const ed = (by: string, vsk: number, eid: string, content: unknown, ev = 1, ep?: string): ControlEdition =>
  ({ vsk, eid, ev, ...(ep ? { ep } : {}), content: JSON.stringify(content), rumorId: String(++rid).padStart(64, "0"), pubkey: by });
const hashOf = (e: ControlEdition) => computeEditionId(e.eid, e.ev, e.ep, e.content);

// ADMIN holds a role that may create invites; MEMBER holds nothing.
const inviter = ed(OWNER, VSK.ROLE, ROLE, { role_id: ROLE, name: "Inviter", position: 5, permissions: String(PERM.CREATE_INVITE), scope: { kind: "server" } });
const grant = ed(OWNER, VSK.GRANT, grantLocator(CID, ADMIN), { member: ADMIN, role_ids: [ROLE] });
const list = (by: string, links: unknown[], ev = 1, ep?: string) => ed(by, VSK.REGISTRY, inviteLinksLocator(CID, by), links, ev, ep);
const fold = (...eds: ControlEdition[]) => foldEditions(eds, OWNER, CID);

describe("which live links a group has", () => {
  it("the owner's links make the group Public", () => {
    expect(activeInviteLinks(fold(list(OWNER, [L1, L2])), OWNER, CID)).toEqual([L1, L2]);
  });

  it("no links, or no list at all, is a Private group", () => {
    expect(activeInviteLinks(fold(list(OWNER, [])), OWNER, CID)).toEqual([]);
    expect(activeInviteLinks(fold(), OWNER, CID)).toEqual([]);
  });

  it("every creator's list counts while they may create invites", () => {
    expect(activeInviteLinks(fold(inviter, grant, list(OWNER, [L1]), list(ADMIN, [L2])), OWNER, CID)).toEqual([L1, L2]);
  });

  it("a member who can't create invites lists nothing", () => {
    expect(activeInviteLinks(fold(list(MEMBER, [L3])), OWNER, CID)).toEqual([]);
  });

  it("nobody can write into someone else's list", () => {
    const mine = list(OWNER, [L1]);
    const forged = ed(ADMIN, VSK.REGISTRY, inviteLinksLocator(CID, OWNER), [L3], 2, hashOf(mine));
    expect(activeInviteLinks(fold(inviter, grant, mine, forged), OWNER, CID)).toEqual([L1]);
  });

  it("a creator who loses the permission stops counting", () => {
    const revoke = ed(OWNER, VSK.GRANT, grantLocator(CID, ADMIN), { member: ADMIN, role_ids: [] }, 2, hashOf(grant));
    expect(activeInviteLinks(fold(inviter, grant, revoke, list(ADMIN, [L2])), OWNER, CID)).toEqual([]);
  });

  it("ignores anything in a list that isn't a link's locator", () => {
    expect(activeInviteLinks(fold(list(OWNER, [L1, "nope", 7, L1])), OWNER, CID)).toEqual([L1]);
  });
});

describe("turning a link off", () => {
  it("leaves the group Public while someone else's link is live, and Private once none is", () => {
    expect(groupLinksWith(fold(inviter, grant, list(OWNER, [L1]), list(ADMIN, [L2])), OWNER, CID, OWNER, [])).toEqual([L2]);
    expect(groupLinksWith(fold(list(OWNER, [L1])), OWNER, CID, OWNER, [])).toEqual([]);
  });
});

describe("the next list I publish", () => {
  const link = (pk: string, over: Partial<StoredInviteSigner> = {}): StoredInviteSigner =>
    ({ communityId: CID, linkSignerPubkey: pk, linkSignerSecret: hex("9"), token: "00".repeat(16), createdAt: 1, ...over });

  it("starts a chain with my live links", () => {
    const next = nextRegistryEdition(fold(), CID, OWNER, [link(L2), link(L1)], 5000);
    expect(next).toMatchObject({ eid: inviteLinksLocator(CID, OWNER), version: 1, links: [L1, L2] });
    expect(next.prevHash).toBeUndefined();
  });

  it("keeps links from my other devices, and chains onto the list the group holds", () => {
    const held = list(OWNER, [L1]);
    expect(nextRegistryEdition(fold(held), CID, OWNER, [link(L2)], 5000)).toMatchObject({ version: 2, prevHash: hashOf(held), links: [L1, L2] });
  });

  it("drops links that were turned off or have expired", () => {
    const held = list(OWNER, [L1, L2, L3]);
    const next = nextRegistryEdition(fold(held), CID, OWNER, [link(L1, { revoked: true }), link(L2, { expiresAt: 1000 })], 5000);
    expect(next.links).toEqual([L3]);
  });

  it("never chains below a version this device already published", () => {
    const next = nextRegistryEdition(fold(list(OWNER, [L1])), CID, OWNER, [link(L2)], 5000, { ev: 3, hash: hex("f") });
    expect(next).toMatchObject({ version: 4, prevHash: hex("f") });
  });
});
