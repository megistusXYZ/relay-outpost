/**
 * Three failure modes, tested apart because they hurt differently: a dropped
 * `private` flag advertises a room to the people it was hidden from, a broken
 * chain makes the edit vanish while the UI says it worked, and a lost base
 * erases fields nobody touched.
 */
import { describe, it, expect } from "vitest";
import { computeEditionId, type ChannelMetadata } from "./concord-events";
import type { StoredChannel } from "./concord-keys";
import { canPublishChannelEdition, nextChannelEdition, type ChannelHead } from "./concord-channel-edition";

const CID = "c".repeat(64);
// Real 32-byte hex: computeEditionId hashes the parent.
const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

/** A channel this device created: it has the chain cursor. */
const created = (over: Partial<StoredChannel> = {}): StoredChannel =>
  ({ id: CID, epoch: 1, name: "general", isPrivate: false, edVersion: 1, edEid: H(1), ...over });
/** A channel that arrived via an invite or the fold mirror: no cursor. */
const joined = (over: Partial<StoredChannel> = {}): StoredChannel =>
  ({ id: CID, epoch: 1, name: "general", isPrivate: false, ...over });
/** A private channel we hold the key for. */
const privateLocal = (over: Partial<StoredChannel> = {}): StoredChannel =>
  created({ isPrivate: true, key: "k".repeat(64), ...over });

const fold = (over: Partial<ChannelMetadata> = {}): ChannelMetadata =>
  ({ channel_id: CID, name: "general", ...over });

describe("nextChannelEdition — the private flag", () => {
  it("carries private through a rename when the fold says private", () => {
    // The disclosure bug: the rename republished without it and the fold
    // recomputed !!undefined === false.
    const out = nextChannelEdition(CID, joined(), fold({ private: true }), { ev: 3, hash: H(3) }, { name: "renamed" });
    expect(out.content.private).toBe(true);
  });

  it("RESTORES private when the fold already says false but we hold the key", () => {
    // Monotone: holding the key is un-fakeable proof, and it heals a community
    // whose fold an earlier rename already broke.
    const out = nextChannelEdition(CID, privateLocal(), fold({ private: false }), { ev: 3, hash: H(3) }, { name: "renamed" });
    expect(out.content.private).toBe(true);
  });

  it("leaves the key ABSENT for a public rename, matching what v1 publishes", () => {
    // Not `private: false` — an always-present key would serialize differently
    // from creation's v1 content and break hash comparisons against it.
    const out = nextChannelEdition(CID, created(), fold(), { ev: 1, hash: H(1) }, { name: "renamed" });
    expect(Object.keys(out.content)).toEqual(["channel_id", "name"]);
  });
});

describe("nextChannelEdition — the base", () => {
  it("carries an untouched about and picture from the fold", () => {
    const out = nextChannelEdition(CID, joined(), fold({ about: "the room", picture: "p.png" }), { ev: 2, hash: H(2) }, { name: "renamed" });
    expect(out.content.about).toBe("the room");
    expect(out.content.picture).toBe("p.png");
  });

  it("lets an explicit rename override the folded name", () => {
    const out = nextChannelEdition(CID, joined(), fold({ name: "live" }), { ev: 2, hash: H(2) }, { name: "renamed" });
    expect(out.content.name).toBe("renamed");
  });

  it("falls back to the local record only when there is no fold", () => {
    const out = nextChannelEdition(CID, created({ name: "mine" }), undefined, undefined, {});
    expect(out.content.name).toBe("mine");
  });
});

describe("nextChannelEdition — the chain", () => {
  it("chains onto the fold head when this device has no cursor", () => {
    const out = nextChannelEdition(CID, joined(), fold(), { ev: 7, hash: H(7) }, { name: "r" });
    expect(out.version).toBe(8);
    expect(out.prevHash).toBe(H(7));
  });

  it("prefers the fold head over a behind local cursor", () => {
    const out = nextChannelEdition(CID, created({ edVersion: 3, edEid: H(3) }), fold(), { ev: 7, hash: H(7) }, { name: "r" });
    expect(out.version).toBe(8);
    expect(out.prevHash).toBe(H(7));
  });

  it("uses the local cursor as a floor when the fold is cold", () => {
    const out = nextChannelEdition(CID, created({ edVersion: 5, edEid: H(5) }), undefined, undefined, { name: "r" });
    expect(out.version).toBe(6);
    expect(out.prevHash).toBe(H(5));
  });

  it("prefers the fold's hash on an equal-version tie", () => {
    const out = nextChannelEdition(CID, created({ edVersion: 7, edEid: H(0xaa) }), fold(), { ev: 7, hash: H(0xbb) }, { name: "r" });
    expect(out.prevHash).toBe(H(0xbb));
  });

  it("refuses when no head is provable, instead of reconstructing one", () => {
    // The old fallback hashed the CURRENT name as if it were v1's — wrong for
    // every private channel, whose real v1 also carried private: true.
    expect(() => nextChannelEdition(CID, privateLocal({ edVersion: undefined, edEid: undefined }), undefined, undefined, { name: "r" }))
      .toThrow(/chain head unknown/);
  });

  it("computes eid over the same content object the caller serializes", () => {
    const out = nextChannelEdition(CID, joined(), fold({ about: "x", private: true }), { ev: 2, hash: H(2) }, { name: "r" });
    expect(out.eid).toBe(computeEditionId(CID, out.version, out.prevHash, JSON.stringify(out.content)));
  });
});

describe("nextChannelEdition — delete", () => {
  it("publishes a CHAINED tombstone, never a fresh v1", () => {
    const out = nextChannelEdition(CID, joined(), fold(), { ev: 4, hash: H(4) }, { delete: true });
    expect(out.content.deleted).toBe(true);
    expect(out.version).toBe(5);
    expect(out.prevHash).toBe(H(4));
  });

  it("keeps private and the rest of the base on the tombstone", () => {
    // A peer that ignores `deleted` must not be handed a channel with a blank
    // name and no privacy flag.
    const out = nextChannelEdition(CID, privateLocal(), fold({ about: "x", private: true }), { ev: 4, hash: H(4) }, { delete: true });
    expect(out.content.private).toBe(true);
    expect(out.content.about).toBe("x");
    expect(out.content.name).toBe("general");
  });

  it("refuses a delete on an unprovable head, exactly like a rename", () => {
    expect(() => nextChannelEdition(CID, joined(), undefined, undefined, { delete: true }))
      .toThrow(/chain head unknown/);
  });
});

describe("canPublishChannelEdition", () => {
  it("allows a fold-only channel once the head is known", () => {
    expect(canPublishChannelEdition({ local: undefined, govChannel: fold(), foldHead: { ev: 2, hash: H(2) } })).toBe(true);
  });

  it("allows the creator with a cursor and a cold fold", () => {
    expect(canPublishChannelEdition({ local: created(), govChannel: undefined, foldHead: undefined })).toBe(true);
  });

  it("refuses when the base is known but the head is not", () => {
    expect(canPublishChannelEdition({ local: joined(), govChannel: fold(), foldHead: undefined })).toBe(false);
  });

  it("refuses a link-joined admin with a cold fold — nothing is provable", () => {
    expect(canPublishChannelEdition({ local: joined(), govChannel: undefined, foldHead: undefined })).toBe(false);
  });
});
