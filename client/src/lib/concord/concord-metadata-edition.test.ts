/**
 * The base half and the chain half of a metadata edit, tested separately
 * because they fail differently: a wrong base destroys other people's data, a
 * wrong chain makes the edit vanish while reporting success.
 */
import { describe, it, expect } from "vitest";
import { computeEditionId, type CommunityMetadata } from "./concord-events";
import type { StoredCommunity } from "./concord-keys";
import { canPublishMetadata, nextMetadataEdition, type MetadataHead } from "./concord-metadata-edition";

const CID = "c".repeat(64);
const OWNER = "a".repeat(64);
const ADMIN = "b".repeat(64);
// Real 32-byte hex: computeEditionId hashes the parent, so H(4) is not a hash.
const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

/** What a link-joined admin holds: name + icon, no about, no policy, no cursor. */
const joined = (over: Partial<StoredCommunity> = {}): StoredCommunity => ({
  community_id: CID, owner: OWNER, name: "Group", icon: "local.png",
  relays: ["wss://bootstrap"], channels: [],
  ...over,
} as StoredCommunity);

/** What the creator holds right after createCommunity: a v1 cursor, no fold. */
const created = (over: Partial<StoredCommunity> = {}): StoredCommunity =>
  joined({ metaVersion: 1, metaEid: H(1), ...over });

const fold = (over: Partial<CommunityMetadata> = {}): CommunityMetadata =>
  ({ name: "Group", relays: [], ...over });

describe("nextMetadataEdition — the base", () => {
  it("takes an untouched policy from the FOLD, not the stale record", () => {
    // The reported bug: renaming republished the record's invite policy.
    const out = nextMetadataEdition(
      joined({ allowMemberInvites: true }), fold({ allowMemberInvites: false }),
      { ev: 4, hash: H(4) }, { name: "Renamed" });
    expect(out.content.allow_member_invites).toBe(false);
  });

  it("takes an untouched about and picture from the fold", () => {
    const out = nextMetadataEdition(
      joined(), fold({ about: "live description", picture: "live.png" }),
      { ev: 4, hash: H(4) }, { name: "Renamed" });
    expect(out.content.description).toBe("live description");
    expect(out.content.picture).toBe("live.png");
  });

  it("still lets an explicit edit override the fold", () => {
    const out = nextMetadataEdition(
      joined(), fold({ allowMemberInvites: true }),
      { ev: 4, hash: H(4) }, { allowMemberInvites: false });
    expect(out.content.allow_member_invites).toBe(false);
  });

  it("keeps a deliberately cleared field cleared", () => {
    // "" must not fall through to the base — that is what a `??` chain would do.
    const out = nextMetadataEdition(
      joined(), fold({ picture: "live.png" }), { ev: 4, hash: H(4) }, { icon: "" });
    expect(out.content.picture).toBe("");
  });

  it("falls back to the local record only when there is no fold (owner, just created)", () => {
    const out = nextMetadataEdition(
      created({ about: "mine", allowMemberInvites: true }), undefined, undefined, { name: "Renamed" });
    expect(out.content.description).toBe("mine");
    expect(out.content.allow_member_invites).toBe(true);
  });

  it("republishes the FOLD's relay list, not the local bootstrap set", () => {
    const out = nextMetadataEdition(
      joined({ relays: ["wss://bootstrap"] }),
      fold({ relays: ["wss://a", "wss://b", "wss://c", "wss://d", "wss://e", "wss://f"] }),
      { ev: 4, hash: H(4) }, { name: "Renamed" });
    expect(out.content.relays).toEqual(["wss://a", "wss://b", "wss://c", "wss://d", "wss://e"]);
  });

  it("with no changes at all, reproduces the folded base exactly", () => {
    const live = fold({ about: "x", picture: "p", allowMemberInvites: true, relays: ["wss://a"] });
    const out = nextMetadataEdition(joined(), live, { ev: 4, hash: H(4) }, {});
    expect(out.content).toEqual({
      name: "Group", description: "x", picture: "p", relays: ["wss://a"], allow_member_invites: true,
    });
  });
});

/**
 * CORD-02 §6: "An editor MUST round-trip unknown fields." Found in the
 * 2026-09-11 spec deep dive: we rebuilt the content from the five fields we
 * know, so one rename from us in a Vector group turned its disappearing timer
 * off and dropped its banner, rules and encrypted icon. We also wrote the
 * description as `about`, where no other app looks.
 */
describe("nextMetadataEdition — what other apps wrote survives our edit", () => {
  const vector = {
    name: "Book Club",
    description: "We read one book a month",
    relays: ["wss://a", "wss://b"],
    message_expiration: 604800,
    icon: { url: "https://blossom.example/i", key: "k", nonce: "n", hash: "h" },
    banner: { url: "https://blossom.example/b", key: "k2", nonce: "n2", hash: "h2" },
    custom: { rules: "Be kind", "vector/theme": "dusk" },
  };
  const live = fold({ name: vector.name, about: vector.description, relays: vector.relays, raw: vector });

  it("a rename keeps the disappearing timer, banner, icon and rules exactly", () => {
    const out = nextMetadataEdition(joined(), live, { ev: 4, hash: H(4) }, { name: "Books & Tea" });
    expect(out.content).toMatchObject({
      name: "Books & Tea",
      message_expiration: 604800,
      icon: vector.icon,
      banner: vector.banner,
      custom: vector.custom,
    });
  });

  it("writes the description where other apps read it, and adds no legacy field they never had", () => {
    const out = nextMetadataEdition(joined(), live, { ev: 4, hash: H(4) }, { about: "Two books a month" });
    expect(out.content.description).toBe("Two books a month");
    expect("about" in out.content).toBe(false);
  });

  it("keeps our older groups' about in step, so it never shows a stale description", () => {
    const ours = fold({ about: "old", raw: { name: "Group", about: "old", picture: "", relays: [] } });
    const out = nextMetadataEdition(joined(), ours, { ev: 4, hash: H(4) }, { about: "new" });
    expect(out.content.description).toBe("new");
    expect(out.content.about).toBe("new");
  });

  it("leaves another app's relay list as it was when nobody edited it", () => {
    const seven = ["wss://1", "wss://2", "wss://3", "wss://4", "wss://5", "wss://6", "wss://7"];
    const out = nextMetadataEdition(joined(), fold({ relays: seven.slice(0, 5), raw: { name: "G", relays: seven } }), { ev: 4, hash: H(4) }, { name: "R" });
    expect(out.content.relays).toEqual(seven);
  });
});

describe("nextMetadataEdition — the chain", () => {
  it("chains onto the fold head when this device has no cursor at all", () => {
    // The link-joined admin. Was publishing ev 2 with no `ep` → dropped by all.
    const out = nextMetadataEdition(joined(), fold(), { ev: 7, hash: H(7) }, { name: "R" });
    expect(out.version).toBe(8);
    expect(out.prevHash).toBe(H(7));
  });

  it("prefers the fold head over a behind local cursor", () => {
    const out = nextMetadataEdition(
      joined({ metaVersion: 3, metaEid: H(3) }), fold(), { ev: 7, hash: H(7) }, { name: "R" });
    expect(out.version).toBe(8);
    expect(out.prevHash).toBe(H(7));
  });

  it("uses the local cursor as a floor when the fold head is missing", () => {
    const out = nextMetadataEdition(
      created({ metaVersion: 5, metaEid: H(5) }), undefined, undefined, { name: "R" });
    expect(out.version).toBe(6);
    expect(out.prevHash).toBe(H(5));
  });

  it("prefers the fold's hash on an equal-version tie", () => {
    const out = nextMetadataEdition(
      joined({ metaVersion: 7, metaEid: H(0xaa) }), fold(), { ev: 7, hash: H(0xbb) }, { name: "R" });
    expect(out.prevHash).toBe(H(0xbb));
  });

  it("refuses to publish when neither a head nor a cursor is known", () => {
    // Better a thrown error than an edition every folder silently drops.
    expect(() => nextMetadataEdition(joined(), fold(), undefined, { name: "R" }))
      .toThrow(/chain head unknown/);
  });

  it("never returns an edition without a parent to chain onto", () => {
    const heads: (MetadataHead | undefined)[] = [{ ev: 1, hash: H(1) }, { ev: 9, hash: H(9) }, undefined];
    for (const h of heads) {
      let out;
      try { out = nextMetadataEdition(created(), fold(), h, {}); } catch { continue; }
      expect(out.version).toBeGreaterThan(1);
      expect(typeof out.prevHash).toBe("string");
    }
  });

  it("computes eid over the same content object the caller serializes", () => {
    const out = nextMetadataEdition(joined(), fold({ about: "x" }), { ev: 2, hash: H(2) }, { name: "R" });
    expect(out.eid).toBe(computeEditionId(CID, out.version, out.prevHash, JSON.stringify(out.content)));
  });
});

describe("canPublishMetadata", () => {
  it("lets the owner publish straight after creating, with no fold", () => {
    expect(canPublishMetadata({
      community: created(), pubkey: OWNER, govMetadata: undefined, foldHead: undefined,
    })).toBe(true);
  });

  it("refuses a non-owner who has folded nothing — the blank-description wipe", () => {
    expect(canPublishMetadata({
      community: joined(), pubkey: ADMIN, govMetadata: undefined, foldHead: undefined,
    })).toBe(false);
  });

  it("allows a non-owner admin once both the base and the head are known", () => {
    expect(canPublishMetadata({
      community: joined(), pubkey: ADMIN, govMetadata: fold(), foldHead: { ev: 3, hash: H(3) },
    })).toBe(true);
  });

  it("refuses when the base is known but the chain head is not", () => {
    expect(canPublishMetadata({
      community: joined(), pubkey: ADMIN, govMetadata: fold(), foldHead: undefined,
    })).toBe(false);
  });

  it("refuses a signed-out viewer", () => {
    expect(canPublishMetadata({
      community: created(), pubkey: null, govMetadata: fold(), foldHead: { ev: 1, hash: H(1) },
    })).toBe(false);
  });
});
