import { describe, it, expect } from "vitest";
import { SPACE_ADMIN_SECTIONS, visibleSections } from "./space-admin-sections";
import { concordCapabilities, nip29Capabilities, NO_CAPABILITIES } from "@/lib/space-admin";
import { PERM, OWNER_POSITION, type Member } from "@/lib/concord/concord-events";
import type { GroupAdmin } from "@/lib/nip29";

const ME = "1a".repeat(32);
const member = (permissions: bigint, rank = 5): Member =>
  ({ pubkey: ME, joinedAt: 1, roleIds: [], permissions, rank }) as Member;
const admins = (...pks: string[]): GroupAdmin[] => pks.map((pubkey) => ({ pubkey, roles: [] })) as GroupAdmin[];
const ids = (caps: Parameters<typeof visibleSections>[0], b: Parameters<typeof visibleSections>[1]) =>
  visibleSections(caps, b).map((s) => s.id);

describe("visibleSections — two gates, asked separately", () => {
  it("shows a Concord owner everything Concord has", () => {
    expect(ids(concordCapabilities(member(0n, OWNER_POSITION)), "concord"))
      .toEqual(["people", "history", "channels", "access", "details", "danger"]);
  });

  it("shows a NIP-29 admin everything NIP-29 has", () => {
    expect(ids(nip29Capabilities(admins(ME), ME), "nip29"))
      .toEqual(["requests", "people", "history", "access", "details", "danger"]);
  });

  it("never shows Channels on NIP-29 — the group IS the room", () => {
    expect(ids(nip29Capabilities(admins(ME), ME), "nip29")).not.toContain("channels");
  });

  it("never shows Waiting-to-join on Concord — there is no queue of strangers", () => {
    expect(ids(concordCapabilities(member(0n, OWNER_POSITION)), "concord")).not.toContain("requests");
  });
});

describe("the backend gate does work the capability gate cannot", () => {
  it("hides Channels from a NIP-29 admin even though caps and backend AGREE", () => {
    // Here a caps-only check would already be correct — manageChannels is false.
    // Kept as a test so the weaker gate is never mistaken for sufficient, which
    // the next case proves it is not.
    const caps = nip29Capabilities(admins(ME), ME);
    expect(caps.manageChannels).toBe(false);
    expect(ids(caps, "nip29")).not.toContain("channels");
  });

  it("is the ONLY thing stopping removeMessages becoming a dead Concord control", () => {
    // The load-bearing case. A Concord admin with MANAGE_MESSAGES has a
    // genuinely true capability — the permission is real and the descriptor is
    // right to report it. But ConcordChat's fold drops any delete whose author
    // is not the message author, so a button would silently do nothing.
    const caps = concordCapabilities(member(PERM.MANAGE_MESSAGES));
    expect(caps.removeMessages).toBe(true);
    // No section claims that capability, on any backend.
    expect(SPACE_ADMIN_SECTIONS.some((s) => s.capability === "removeMessages")).toBe(false);
    expect(ids(caps, "concord")).toEqual([]);
  });

  it("gives `invite` no section either — it is member-level, not authority", () => {
    // Putting invite behind an admin door would REMOVE it from most of the
    // people who have it. It stays in the ⋯ menu.
    const caps = concordCapabilities(member(PERM.CREATE_INVITE));
    expect(caps.invite).toBe(true);
    expect(ids(caps, "concord")).toEqual([]);
    expect(SPACE_ADMIN_SECTIONS.some((s) => s.capability === "invite")).toBe(false);
  });
});

describe("partial authority renders partially", () => {
  it("gives a KICK-only Concord moderator People, and nothing else", () => {
    expect(ids(concordCapabilities(member(PERM.KICK)), "concord")).toEqual(["people"]);
  });

  it("gives a MANAGE_METADATA-only moderator the door and the details form, not the roster", () => {
    // `access` rides editMetadata deliberately — it is where both protocols
    // actually put the door. Give it its own invented capability and it
    // vanishes from every backend at once.
    expect(ids(concordCapabilities(member(PERM.MANAGE_METADATA)), "concord")).toEqual(["access", "details"]);
  });

  it("withholds the door from a KICK-only moderator", () => {
    // Sabotage this by re-gating `access` on `manageMembers`: a moderator whose
    // only power is removing people would be shown the invite policy.
    expect(ids(concordCapabilities(member(PERM.KICK)), "concord")).not.toContain("access");
  });

  it("withholds End-this-space from a Concord non-owner holding every bit", () => {
    const everything = Object.values(PERM).reduce((a, b) => a | b, 0n);
    const out = ids(concordCapabilities(member(everything, 1)), "concord");
    expect(out).toContain("channels");
    expect(out).not.toContain("danger");
  });
});

describe("nothing renders without authority", () => {
  it("returns nothing for a plain member of either backend", () => {
    expect(ids(NO_CAPABILITIES, "concord")).toEqual([]);
    expect(ids(NO_CAPABILITIES, "nip29")).toEqual([]);
    expect(ids(concordCapabilities(member(0n, 5)), "concord")).toEqual([]);
  });

  it("returns nothing while capabilities are still unresolved", () => {
    // The drawer must render skeletons here, never a "you have no permissions"
    // state — the fold simply has not answered yet.
    expect(ids(null, "concord")).toEqual([]);
    expect(ids(undefined, "nip29")).toEqual([]);
  });
});

describe("the table itself", () => {
  it("keeps ids unique and every section reachable on some backend", () => {
    const seen = new Set(SPACE_ADMIN_SECTIONS.map((s) => s.id));
    expect(seen.size).toBe(SPACE_ADMIN_SECTIONS.length);
    for (const s of SPACE_ADMIN_SECTIONS) expect(s.backends.length).toBeGreaterThan(0);
  });

  it("names the irreversible act after what it actually destroys", () => {
    // A NIP-29 drawer administers ONE room. A Concord drawer administers the
    // group chat those rooms live inside. Both used to read "End this space",
    // which named neither — and one shared "Delete this room" would tell a
    // Concord owner they were deleting a room while dissolving everything.
    const danger = SPACE_ADMIN_SECTIONS.find((s) => s.id === "danger")!;
    const labelOf = (caps: Parameters<typeof visibleSections>[0], b: Parameters<typeof visibleSections>[1]) =>
      visibleSections(caps, b).find((s) => s.id === "danger")?.label;
    expect(labelOf(nip29Capabilities(admins(ME), ME), "nip29")).toBe("Delete this room");
    expect(labelOf(concordCapabilities(member(0n, OWNER_POSITION)), "concord")).toBe("Delete this group chat");
    // The table's own field must not be what a renderer reads: resolution
    // happens once, in visibleSections.
    expect(danger.label).not.toBe(danger.labelByBackend?.concord);
  });

  it("orders the time-sensitive first and the irreversible last", () => {
    // Someone waiting at the door outranks configuration, and nobody should
    // reach the delete on the way to something else.
    const order = SPACE_ADMIN_SECTIONS.map((s) => s.id);
    expect(order[0]).toBe("requests");
    expect(order[order.length - 1]).toBe("danger");
  });

  it("puts the door before the name — access is not a detail", () => {
    const order = SPACE_ADMIN_SECTIONS.map((s) => s.id);
    expect(order.indexOf("access")).toBeLessThan(order.indexOf("details"));
  });

  it("gives `access` to BOTH backends — it is the only door NIP-29 has", () => {
    // Concord's door is at least reachable through the edit dialog. Drop
    // "nip29" here and a relay room loses its only statement of who can get in.
    const access = SPACE_ADMIN_SECTIONS.find((s) => s.id === "access")!;
    expect(access.backends).toEqual(["concord", "nip29"]);
  });

  it("labels in plain language — no protocol nouns on screen", () => {
    const jargon = /nip-?29|kind-?\d|relay|concord|pubkey|npub/i;
    for (const s of SPACE_ADMIN_SECTIONS) expect(s.label).not.toMatch(jargon);
  });
});
