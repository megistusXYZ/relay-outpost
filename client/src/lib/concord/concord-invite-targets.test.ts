import { describe, it, expect } from "vitest";
import { invitableCommunities, inviteTargetReason, isTrustedInviteTarget, type InviteTarget } from "./concord-invite-targets";

const ME = "a".repeat(64);
const SOMEONE = "b".repeat(64);

const c = (name: string, owner: string, allowMemberInvites?: boolean): InviteTarget =>
  ({ community_id: name.toLowerCase(), name, owner, allowMemberInvites }) as InviteTarget;

describe("invitableCommunities — where can I bring this person?", () => {
  it("offers communities I own", () => {
    const out = invitableCommunities([c("Mine", ME)], ME);
    expect(out.map((x) => x.name)).toEqual(["Mine"]);
  });

  it("offers someone else's community when it lets members invite", () => {
    const out = invitableCommunities([c("Open", SOMEONE, true)], ME);
    expect(out.map((x) => x.name)).toEqual(["Open"]);
  });

  it("hides someone else's community when it doesn't", () => {
    // Offering a group you can't actually invite into would produce an invite
    // the other members never asked for — omit it rather than fail on send.
    expect(invitableCommunities([c("Closed", SOMEONE, false)], ME)).toEqual([]);
    expect(invitableCommunities([c("Unset", SOMEONE)], ME)).toEqual([]);
  });

  it("sorts by name so the list doesn't reshuffle between openings", () => {
    const out = invitableCommunities([c("zulu", ME), c("Alpha", ME), c("mike", ME)], ME);
    expect(out.map((x) => x.name)).toEqual(["Alpha", "mike", "zulu"]);
  });

  it("returns nothing when signed out", () => {
    expect(invitableCommunities([c("Mine", ME)], null)).toEqual([]);
  });
});

describe("inviteTargetReason — how far can this entry be trusted?", () => {
  it("calls my own community owner-trusted", () => {
    expect(inviteTargetReason(c("Mine", ME), ME)).toBe("owner");
    expect(isTrustedInviteTarget(c("Mine", ME), ME)).toBe(true);
  });

  it("calls someone else's open community PROVISIONAL, not trusted", () => {
    // The stored `allowMemberInvites` is a join-time snapshot nothing refreshes,
    // so it still says open after the owner closed invites — and for someone
    // who has since been removed.
    expect(inviteTargetReason(c("Open", SOMEONE, true), ME)).toBe("policy");
    expect(isTrustedInviteTarget(c("Open", SOMEONE, true), ME)).toBe(false);
  });

  it("prefers ownership when I own a community that also has invites open", () => {
    expect(inviteTargetReason(c("Mine", ME, true), ME)).toBe("owner");
  });

  it("returns null for a community I neither own nor may invite to", () => {
    expect(inviteTargetReason(c("Closed", SOMEONE, false), ME)).toBeNull();
    expect(inviteTargetReason(c("Unset", SOMEONE), ME)).toBeNull();
  });

  it("returns null when signed out", () => {
    expect(inviteTargetReason(c("Mine", ME), null)).toBeNull();
    expect(isTrustedInviteTarget(c("Mine", ME), null)).toBe(false);
  });
});
