import { describe, it, expect } from "vitest";
import {
  concordCapabilities,
  nip29Capabilities,
  hasAnyCapability,
  isReversible,
  NO_CAPABILITIES,
} from "./space-admin";
import { nip19 } from "nostr-tools";
import { PERM, OWNER_POSITION, type Member } from "@/lib/concord/concord-events";
import type { GroupAdmin } from "@/lib/nip29";

// Real hex. The originals were "m"/"o" repeated — not hex at all, which the raw
// string compare happily accepted. Once isGroupModerator normalizes both sides,
// an unparseable key is correctly refused, and these fixtures started failing.
// The test data was wrong, not the code.
const ME = "1a".repeat(32);
const OTHER = "2b".repeat(32);

/** A non-owner member holding exactly the given permission bits. */
const member = (permissions: bigint, rank = 5): Member =>
  ({ pubkey: ME, joinedAt: 1, roleIds: [], permissions, rank }) as Member;

const admins = (...pubkeys: string[]): GroupAdmin[] =>
  pubkeys.map((pubkey) => ({ pubkey, roles: [] })) as GroupAdmin[];

describe("concordCapabilities — nine bits, reported as nine", () => {
  it("grants the owner everything, including dissolve", () => {
    const caps = concordCapabilities(member(0n, OWNER_POSITION));
    expect(caps).toEqual({
      editMetadata: true, manageMembers: true, invite: true, removeMessages: true,
      manageChannels: true, viewAuditLog: true, dissolve: true,
    });
  });

  it("does NOT flatten: a member with only KICK gets only manageMembers", () => {
    // The whole reason this is per-capability. A moderator who can remove people
    // must not therefore be handed the rename field.
    const caps = concordCapabilities(member(PERM.KICK));
    expect(caps.manageMembers).toBe(true);
    expect(caps.editMetadata).toBe(false);
    expect(caps.removeMessages).toBe(false);
    expect(caps.manageChannels).toBe(false);
  });

  it("treats BAN as sufficient for manageMembers, like KICK", () => {
    expect(concordCapabilities(member(PERM.BAN)).manageMembers).toBe(true);
  });

  it("withholds dissolve from a non-owner however many bits they hold", () => {
    // Ending the community is owner-only BY DESIGN — there is no PERM bit for it
    // because it is not delegable. A member granted every permission still
    // cannot do it.
    const everything = Object.values(PERM).reduce((a, b) => a | b, 0n);
    const caps = concordCapabilities(member(everything, 1));
    expect(caps.editMetadata).toBe(true);
    expect(caps.manageChannels).toBe(true);
    expect(caps.dissolve).toBe(false);
  });

  it("grants nothing for an unresolved member", () => {
    // The fold has not answered yet. Absence of evidence is not authority, and a
    // drawer that flashes admin controls while state loads is worse than one
    // that fills in a beat later.
    expect(concordCapabilities(null)).toEqual(NO_CAPABILITIES);
    expect(concordCapabilities(undefined)).toEqual(NO_CAPABILITIES);
  });
});

describe("nip29Capabilities — one bit, honestly reported as one bit", () => {
  it("gives an admin everything the protocol actually offers", () => {
    const caps = nip29Capabilities(admins(ME), ME);
    expect(caps.editMetadata).toBe(true);
    expect(caps.manageMembers).toBe(true);
    expect(caps.invite).toBe(true);
    expect(caps.removeMessages).toBe(true);
    expect(caps.viewAuditLog).toBe(true);
  });

  it("never claims manageChannels — a NIP-29 group IS the room", () => {
    // Reporting true would put a control in the drawer with nothing behind it.
    expect(nip29Capabilities(admins(ME), ME).manageChannels).toBe(false);
  });

  it("allows any admin to dissolve, unlike Concord", () => {
    // Deliberate divergence, and the reason it is worth a test: NIP-29 has no
    // owner or rank, so the app CANNOT tell the founder from someone added as a
    // moderator last week. Inventing that distinction would be a lie about who
    // holds authority. The relay is the real arbiter; the drawer adds friction.
    expect(nip29Capabilities(admins(ME), ME).dissolve).toBe(true);
  });

  it("grants nothing to a non-admin", () => {
    expect(nip29Capabilities(admins(OTHER), ME)).toEqual(NO_CAPABILITIES);
  });

  it("grants nothing when signed out or when admins are unknown", () => {
    expect(nip29Capabilities(admins(ME), null)).toEqual(NO_CAPABILITIES);
    expect(nip29Capabilities(null, ME)).toEqual(NO_CAPABILITIES);
    expect(nip29Capabilities(undefined, ME)).toEqual(NO_CAPABILITIES);
  });
});

describe("hasAnyCapability — should the drawer exist for this person", () => {
  it("is false for a plain member of either kind", () => {
    expect(hasAnyCapability(NO_CAPABILITIES)).toBe(false);
    expect(hasAnyCapability(concordCapabilities(member(0n, 5)))).toBe(false);
    expect(hasAnyCapability(nip29Capabilities(admins(OTHER), ME))).toBe(false);
  });

  it("is true on a single permission", () => {
    expect(hasAnyCapability(concordCapabilities(member(PERM.CREATE_INVITE)))).toBe(true);
  });
});

describe("isReversible — say which way the door swings", () => {
  it("knows a Concord dissolve is final but a kick is not", () => {
    // Concord can rekey and re-admit.
    expect(isReversible("concord", "dissolve")).toBe(false);
    expect(isReversible("concord", "removeMember")).toBe(true);
    expect(isReversible("concord", "removeMessage")).toBe(true);
  });

  it("knows a NIP-29 delete is final — there is no un-delete event", () => {
    // Asking a relay to forget something has no counter-event that restores it.
    expect(isReversible("nip29", "removeMessage")).toBe(false);
    expect(isReversible("nip29", "dissolve")).toBe(false);
    expect(isReversible("nip29", "removeMember")).toBe(true);
  });
});

describe("nip29Capabilities — the pubkey compare underneath it", () => {
  // This predicate is the ENTIRE NIP-29 authority model, so a false negative
  // hides every admin surface. It used to compare raw strings, which is the
  // defect that locked a real operator out of the ops dashboard (#461).
  const HEX = "ab".repeat(32);

  it("matches when the relay tag is uppercase", () => {
    const admins = [{ pubkey: HEX.toUpperCase(), roles: [] }] as GroupAdmin[];
    expect(nip29Capabilities(admins, HEX).manageMembers).toBe(true);
  });

  it("matches when the session pubkey carries whitespace", () => {
    const admins = [{ pubkey: HEX, roles: [] }] as GroupAdmin[];
    expect(nip29Capabilities(admins, `  ${HEX}  `).manageMembers).toBe(true);
  });

  it("matches an npub against hex, in either position", () => {
    const npub = nip19.npubEncode(HEX);
    expect(nip29Capabilities([{ pubkey: npub, roles: [] }] as GroupAdmin[], HEX).manageMembers).toBe(true);
    expect(nip29Capabilities([{ pubkey: HEX, roles: [] }] as GroupAdmin[], npub).manageMembers).toBe(true);
  });

  it("still refuses a genuinely different key", () => {
    const other = "cd".repeat(32);
    expect(nip29Capabilities([{ pubkey: other, roles: [] }] as GroupAdmin[], HEX)).toEqual(NO_CAPABILITIES);
  });

  it("refuses unparseable input rather than matching loosely", () => {
    expect(nip29Capabilities([{ pubkey: "not-a-key", roles: [] }] as GroupAdmin[], HEX)).toEqual(NO_CAPABILITIES);
    expect(nip29Capabilities([{ pubkey: HEX, roles: [] }] as GroupAdmin[], "not-a-key")).toEqual(NO_CAPABILITIES);
  });
});
