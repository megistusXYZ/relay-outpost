import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { buildJoinLeaveRumor, readInviteAttribution } from "./concord-events";
import { inviteAttribution, joinCountsByLabel, expiryAfter, EXPIRY_CHOICES, linkExpiry } from "./concord-invite-links";

const me = getPublicKey(generateSecretKey());
const other = getPublicKey(generateSecretKey());
const joiner = () => getPublicKey(generateSecretKey());
const DAY = 86_400_000;

describe("Join attribution (CORD-05 §1, CORD-02 §5)", () => {
  it("a Join through a link names the link's creator and label", () => {
    const rumor = buildJoinLeaveRumor(joiner(), true, 100, 0, { creator: me, label: "Bio link" });
    expect(rumor.tags).toContainEqual(["invite", me, "Bio link"]);
    expect(rumor.content).toBe("join");
  });

  it("a Leave never carries it, and a plain Join is unchanged", () => {
    expect(buildJoinLeaveRumor(joiner(), false, 100, 0, { creator: me, label: "x" }).tags.some((t) => t[0] === "invite")).toBe(false);
    expect(buildJoinLeaveRumor(joiner(), true, 100).tags.some((t) => t[0] === "invite")).toBe(false);
  });

  it("reads a creator back only when it is a real key", () => {
    expect(readInviteAttribution({ tags: [["invite", me, "Reddit"]] })).toEqual({ creator: me, label: "Reddit" });
    expect(readInviteAttribution({ tags: [["invite", me]] })).toEqual({ creator: me, label: "" });
    expect(readInviteAttribution({ tags: [["invite", "npub-ish", "Reddit"]] })).toBeNull();
    expect(readInviteAttribution({ tags: [] })).toBeNull();
  });

  it("takes the creator from a bundle's npub or hex, and none without one", () => {
    expect(inviteAttribution({ creator_npub: nip19.npubEncode(me), label: " Conf 2026 " })).toEqual({ creator: me, label: "Conf 2026" });
    expect(inviteAttribution({ creator_npub: me })).toEqual({ creator: me, label: "" });
    expect(inviteAttribution({ label: "orphan" })).toBeNull();
    expect(inviteAttribution({ creator_npub: "not a key", label: "x" })).toBeNull();
  });
});

describe("join counts per link", () => {
  const join = (pubkey: string, label: string, creator = me, t = 1) => ({ ...buildJoinLeaveRumor(pubkey, true, t, 0, { creator, label }), pubkey });

  it("counts the distinct people who joined through each of my links", () => {
    const a = joiner(), b = joiner(), c = joiner();
    const counts = joinCountsByLabel([join(a, "Bio link"), join(b, "Bio link"), join(c, "Flyer")], me);
    expect(counts.get("Bio link")).toBe(2);
    expect(counts.get("Flyer")).toBe(1);
  });

  it("counts someone who left and came back once, and ignores other creators' links and plain Joins", () => {
    const a = joiner();
    const counts = joinCountsByLabel([
      join(a, "Bio link", me, 1),
      { ...buildJoinLeaveRumor(a, false, 2), pubkey: a },
      join(a, "Bio link", me, 3),
      join(joiner(), "Bio link", other),
      { ...buildJoinLeaveRumor(joiner(), true, 4), pubkey: "x" },
    ], me);
    expect(counts.get("Bio link")).toBe(1);
    expect(counts.size).toBe(1);
  });
});

describe("link expiry", () => {
  it("offers never, a day, a week and a month", () => {
    expect(EXPIRY_CHOICES.map((c) => c.label)).toEqual(["Never", "1 day", "7 days", "30 days"]);
    expect(expiryAfter("never", 1000)).toBeUndefined();
    expect(expiryAfter("7d", 1000)).toBe(1000 + 7 * DAY);
  });

  it("says when a link runs out, and that it has", () => {
    const now = 1_000_000_000_000;
    expect(linkExpiry(undefined, now)).toBeNull();
    expect(linkExpiry(now + 3 * DAY + 5, now)).toEqual({ expired: false, text: "Expires in 3 days" });
    expect(linkExpiry(now + 2 * 3_600_000, now)).toEqual({ expired: false, text: "Expires in 2 hours" });
    expect(linkExpiry(now - 1, now)).toEqual({ expired: true, text: "Expired" });
  });
});
