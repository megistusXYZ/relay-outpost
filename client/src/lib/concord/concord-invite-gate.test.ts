/**
 * The invite gate is the ONLY enforcement point for "who may hand out read
 * access to this encrypted community" — nothing below the UI re-checks it — so
 * it is tested as a table, with the fail-closed cases stated explicitly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PERM, OWNER_POSITION, type Member, type FoldedState } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";

vi.mock("./concord-roster", () => ({
  getRosterSnapshot: vi.fn(() => null),
}));

import { canInviteToCommunity, membersMayInvite, rosterPubkeys } from "./concord-invite-gate";
import { getRosterSnapshot } from "./concord-roster";

const OWNER = "a".repeat(64);
const ADMIN = "b".repeat(64);
const PLAIN = "c".repeat(64);
const OUTSIDER = "d".repeat(64);

const community = (over: Partial<StoredCommunity> = {}): StoredCommunity => ({
  community_id: "cid",
  owner: OWNER,
  ...over,
} as StoredCommunity);

const member = (pubkey: string, over: Partial<Member> = {}): Member => ({
  pubkey,
  joinedAt: 0,
  roleIds: [],
  permissions: 0n,
  rank: 5,
  ...over,
});

const meta = (over: Partial<NonNullable<FoldedState["metadata"]>> = {}) =>
  ({ name: "g", ...over }) as NonNullable<FoldedState["metadata"]>;

describe("canInviteToCommunity", () => {
  describe("the owner never waits for the fold", () => {
    it("allows the owner before any fold has arrived", () => {
      // The moment after createCommunity: no roster, no metadata, no relay
      // round-trip. This is what makes "add encrypted channels → invite" work.
      expect(canInviteToCommunity({
        community: community(), pubkey: OWNER, myMember: undefined, govMetadata: undefined,
      })).toBe(true);
    });

    it("allows the owner even with no permission bits set", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: OWNER,
        myMember: member(OWNER, { rank: OWNER_POSITION, permissions: 0n }),
        govMetadata: meta(),
      })).toBe(true);
    });
  });

  describe("fails closed while the fold is loading", () => {
    it("denies a non-owner pre-fold even when the local record says invites are open", () => {
      // The pre-fold window is exactly when a stale record is all we have.
      expect(canInviteToCommunity({
        community: community({ allowMemberInvites: true } as Partial<StoredCommunity>),
        pubkey: PLAIN, myMember: undefined, govMetadata: undefined,
      })).toBe(false);
    });

    it("denies a member whose roles the fold has not admitted", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: PLAIN,
        myMember: member(PLAIN, { permissions: 0n, rank: Infinity }),
        govMetadata: meta(),
      })).toBe(false);
    });
  });

  describe("explicit grant", () => {
    it("allows a member holding CREATE_INVITE", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: ADMIN,
        myMember: member(ADMIN, { permissions: PERM.CREATE_INVITE }),
        govMetadata: meta(),
      })).toBe(true);
    });

    it("denies a member holding a different permission", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: ADMIN,
        myMember: member(ADMIN, { permissions: PERM.MENTION_EVERYONE }),
        govMetadata: meta(),
      })).toBe(false);
    });
  });

  describe("open-invite policy", () => {
    it("allows a seated member when the live policy is open", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: PLAIN, myMember: member(PLAIN),
        govMetadata: meta({ allowMemberInvites: true }),
      })).toBe(true);
    });

    it("lets the LIVE policy close invites that the stale local record still calls open", () => {
      // The direction that must never fail open: the owner turned invites off.
      expect(canInviteToCommunity({
        community: community({ allowMemberInvites: true } as Partial<StoredCommunity>),
        pubkey: PLAIN, myMember: member(PLAIN),
        govMetadata: meta({ allowMemberInvites: false }),
      })).toBe(false);
    });

    it("falls back to the local record only while there is no folded metadata", () => {
      expect(canInviteToCommunity({
        community: community({ allowMemberInvites: true } as Partial<StoredCommunity>),
        pubkey: PLAIN, myMember: member(PLAIN), govMetadata: undefined,
      })).toBe(true);
    });

    it("denies a NON-member under an open policy — removal beats policy", () => {
      // A banned pubkey is dropped from the roster but keeps its record and its
      // community_root until a rekey reaches that device. Policy alone would let
      // someone we removed go on minting working links.
      expect(canInviteToCommunity({
        community: community(), pubkey: OUTSIDER, myMember: undefined,
        govMetadata: meta({ allowMemberInvites: true }),
      })).toBe(false);
    });
  });

  describe("nothing to decide about", () => {
    it("denies with no community", () => {
      expect(canInviteToCommunity({
        community: null, pubkey: OWNER, myMember: undefined, govMetadata: undefined,
      })).toBe(false);
    });
    it("denies a signed-out viewer", () => {
      expect(canInviteToCommunity({
        community: community(), pubkey: null, myMember: undefined, govMetadata: undefined,
      })).toBe(false);
    });
  });
});

describe("rosterPubkeys", () => {
  beforeEach(() => { vi.mocked(getRosterSnapshot).mockReturnValue(null); });

  it("uses the live fold once it has seen a join", () => {
    expect(rosterPubkeys("cid", [member(OWNER), member(PLAIN)])).toEqual([OWNER, PLAIN]);
  });

  it("falls back to the snapshot while the fold is just the owner", () => {
    vi.mocked(getRosterSnapshot).mockReturnValue([OWNER, PLAIN, ADMIN]);
    expect(rosterPubkeys("cid", [member(OWNER)])).toEqual([OWNER, PLAIN, ADMIN]);
  });

  it("returns an empty list when there is no snapshot either", () => {
    expect(rosterPubkeys("cid", [])).toEqual([]);
  });
});

/**
 * The admin drawer DISPLAYS this, so it is now load-bearing twice over: get the
 * precedence backwards and the screen tells an owner their invite door is open
 * after they closed it.
 */
describe("membersMayInvite — policy precedence", () => {
  it("lets a live fold FALSE override a stale local true", () => {
    // The dangerous direction. Closing invites is the one that must propagate.
    expect(membersMayInvite(
      community({ allowMemberInvites: true }),
      { allowMemberInvites: false } as FoldedState["metadata"],
    )).toBe(false);
  });

  it("lets a live fold TRUE override a stale local false", () => {
    expect(membersMayInvite(
      community({ allowMemberInvites: false }),
      { allowMemberInvites: true } as FoldedState["metadata"],
    )).toBe(true);
  });

  it("falls back to the local record before the fold arrives", () => {
    expect(membersMayInvite(community({ allowMemberInvites: true }), undefined)).toBe(true);
    expect(membersMayInvite(community({ allowMemberInvites: false }), undefined)).toBe(false);
  });

  it("treats an absent flag as closed on both sources", () => {
    // Fail closed: an unset policy is not permission.
    expect(membersMayInvite(community(), undefined)).toBe(false);
    expect(membersMayInvite(community({ allowMemberInvites: true }), {} as FoldedState["metadata"])).toBe(false);
  });
});
