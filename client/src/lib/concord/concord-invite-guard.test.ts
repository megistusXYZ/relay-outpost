/**
 * An invite hands over keys, so accepting one must never move keys you already
 * hold (CORD-05 §1, the held-base rule), and a new join is kept only once the
 * owner's own record opens under the keys it delivered (the genesis anchor).
 * Found in planning: opening an old link to a group you're in rewrote your
 * stored record wholesale — keys rolled back, private rooms and the admin key
 * dropped.
 */
import { describe, it, expect } from "vitest";
import { checkHeldBundle, anchorsGenesis } from "./concord-invite-guard";
import { VSK, type ControlEdition } from "./concord-events";
import type { InviteBundle } from "./concord-invites";
import type { StoredCommunity } from "./concord-keys";

const hex = (c: string) => c.repeat(64);
const CID = hex("c"), OWNER = hex("0"), ADMIN = hex("a"), SALT = hex("5");
const ROOT = hex("1"), OLD_ROOT = hex("9"), CPK = hex("2"), CROOT = hex("3");
const GENERAL = hex("4"), SECRET = hex("6"), NEWROOM = hex("7"), NEWSECRET = hex("8");

const held: StoredCommunity = {
  community_id: CID, owner: OWNER, owner_salt: SALT, community_root: ROOT, root_epoch: 2,
  control_pk: CPK, control_root: CROOT,
  channels: [
    { id: GENERAL, epoch: 2, name: "general", isPrivate: false },
    { id: SECRET, key: hex("e"), epoch: 1, name: "secret", isPrivate: true },
  ],
  relays: ["wss://r.example"], name: "Book Club", addedAt: 1,
};
const bundle = (over: Partial<InviteBundle> = {}): InviteBundle => ({
  community_id: CID, owner: OWNER, owner_salt: SALT, community_root: ROOT, root_epoch: 2, control_pk: CPK,
  channels: [{ id: GENERAL, epoch: 2, name: "general" }], relays: ["wss://r.example"], name: "Book Club", ...over,
});

describe("an invite for a group you're already in (CORD-05 §1)", () => {
  it("a group you're not in is a new join", () => {
    expect(checkHeldBundle(null, bundle())).toEqual({ kind: "new" });
  });

  it("the same keys: nothing changes", () => {
    expect(checkHeldBundle(held, bundle())).toEqual({ kind: "held", record: held, added: 0 });
  });

  it("adds a room you were missing, and nothing else", () => {
    const out = checkHeldBundle(held, bundle({ channels: [
      { id: GENERAL, epoch: 2, name: "general" },
      { id: NEWROOM, epoch: 2, name: "photos" },
      { id: NEWSECRET, key: hex("f"), epoch: 1, name: "staff" },
    ] }));
    expect(out.kind).toBe("held");
    if (out.kind !== "held") return;
    expect(out.added).toBe(2);
    expect(out.record.channels.map((c) => c.id)).toEqual([GENERAL, SECRET, NEWROOM, NEWSECRET]);
    expect(out.record.channels.find((c) => c.id === NEWSECRET)).toMatchObject({ key: hex("f"), isPrivate: true });
    expect(out.record.community_root).toBe(ROOT);
    expect(out.record.control_root).toBe(CROOT);
    expect(out.record.channels.find((c) => c.id === SECRET)?.key).toBe(hex("e"));
  });

  it("never replaces a room you hold with the invite's copy", () => {
    const out = checkHeldBundle(held, bundle({ channels: [{ id: SECRET, key: hex("d"), epoch: 9, name: "renamed" }] }));
    expect(out).toEqual({ kind: "held", record: held, added: 0 });
  });

  it("an older link, from before a key change, is refused", () => {
    expect(checkHeldBundle(held, bundle({ community_root: OLD_ROOT, root_epoch: 1 }))).toEqual({ kind: "refused" });
  });

  it("a different key at the same version is refused", () => {
    expect(checkHeldBundle(held, bundle({ community_root: OLD_ROOT }))).toEqual({ kind: "refused" });
  });

  it("a different admin address, or none, is refused", () => {
    expect(checkHeldBundle(held, bundle({ control_pk: hex("b") }))).toEqual({ kind: "refused" });
    expect(checkHeldBundle(held, bundle({ control_pk: undefined }))).toEqual({ kind: "refused" });
  });
});

describe("the genesis anchor: a new join is kept only once the owner's record opens (CORD-05 §1)", () => {
  const ed = (over: Partial<ControlEdition>): ControlEdition =>
    ({ vsk: VSK.METADATA, eid: CID, ev: 1, content: "{}", rumorId: hex("r"), pubkey: OWNER, ...over });

  it("the owner's first record for the group, readable with the invite's keys, anchors it", () => {
    expect(anchorsGenesis([ed({})], bundle())).toBe(true);
  });

  it("an empty admin plane anchors nothing: the join waits", () => {
    expect(anchorsGenesis([], bundle())).toBe(false);
  });

  it("a record about another group doesn't count", () => {
    expect(anchorsGenesis([ed({ eid: hex("d") })], bundle())).toBe(false);
  });

  it("after a key change: the group's record plus any record the owner signed", () => {
    expect(anchorsGenesis([ed({ pubkey: ADMIN, ev: 4 }), ed({ vsk: VSK.ROLE, eid: hex("e"), pubkey: OWNER })], bundle())).toBe(true);
    expect(anchorsGenesis([ed({ pubkey: ADMIN, ev: 4 })], bundle())).toBe(false);
  });
});
