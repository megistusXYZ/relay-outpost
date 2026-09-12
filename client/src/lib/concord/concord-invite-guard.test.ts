/**
 * An invite hands over keys, so accepting one must never move keys you already
 * hold (CORD-05 §1, the held-base rule), and a new join is kept only once the
 * owner's own record opens under the keys it delivered (the genesis anchor).
 * Found in planning: opening an old link to a group you're in rewrote your
 * stored record wholesale — keys rolled back, private rooms and the admin key
 * dropped.
 */
import { describe, it, expect } from "vitest";
import { checkHeldBundle, anchorsGenesis, absorbHeldInvites } from "./concord-invite-guard";
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

/**
 * A private room's key is "handed over in its invite" (CORD-03 §2, CORD-05 §6).
 * Armada's "Add members" sends it that way, to someone already in the group.
 * Found with Armada: the invite landed in pending, and the pending list
 * dropped it because the group was held, so the room never appeared.
 */
describe("room keys handed over in an invite to a group you're in", () => {
  const room = { id: NEWROOM, key: NEWSECRET, epoch: 0, name: "Test Room" };
  const onlyOwner = (pk: string) => pk === OWNER;

  it("an invite from someone who may hand out rooms gives me the private room I'm missing", () => {
    const out = absorbHeldInvites(held, [{ from: OWNER, bundle: bundle({ channels: [room] }) }], onlyOwner);
    expect(out.added).toBe(1);
    expect(out.consumed).toBe(true);
    expect(out.record.channels.find((c) => c.id === NEWROOM)).toEqual({ id: NEWROOM, key: NEWSECRET, epoch: 0, name: "Test Room", isPrivate: true });
  });

  it("never from someone who can't hand out rooms, but kept: their role may not have reached us yet", () => {
    const out = absorbHeldInvites(held, [{ from: ADMIN, bundle: bundle({ channels: [room] }) }], onlyOwner);
    expect(out).toEqual({ record: held, added: 0, consumed: false });
  });

  it("the right to hand out rooms is asked per room", () => {
    const secretOnly = (pk: string, roomId: string) => pk === ADMIN && roomId === NEWROOM;
    const other = { id: hex("d"), key: hex("f"), epoch: 1, name: "Other" };
    const out = absorbHeldInvites(held, [{ from: ADMIN, bundle: bundle({ channels: [room, other] }) }], secretOnly);
    expect(out.record.channels.map((c) => c.name)).toEqual(["general", "secret", "Test Room"]);
  });

  it("never moves a key I hold, even from the owner", () => {
    const out = absorbHeldInvites(held, [{ from: OWNER, bundle: bundle({ community_root: OLD_ROOT, channels: [room] }) }], onlyOwner);
    expect(out).toEqual({ record: held, added: 0, consumed: true });
  });

  it("takes rooms from every waiting invite for this group, and none for another", () => {
    const other = { id: hex("d"), key: hex("f"), epoch: 1, name: "Other" };
    const out = absorbHeldInvites(held, [
      { from: OWNER, bundle: bundle({ channels: [room] }) },
      { from: OWNER, bundle: bundle({ channels: [room, other] }) },
      { from: OWNER, bundle: bundle({ community_id: hex("b"), channels: [{ id: hex("b"), key: hex("b"), epoch: 1, name: "Elsewhere" }] }) },
    ], onlyOwner);
    expect(out.record.channels.map((c) => c.name)).toEqual(["general", "secret", "Test Room", "Other"]);
    expect(out.added).toBe(2);
  });

  it("a key for a room I hold as public moves it to that key: the group made it private", () => {
    // Armada makes a public room private on a new stream, at channel epoch 1
    // (a room's own counter, not the group's), and hands the key out by invite.
    const privatised = { id: GENERAL, key: NEWSECRET, epoch: 1, name: "general" };
    const out = absorbHeldInvites(held, [{ from: OWNER, bundle: bundle({ channels: [privatised] }) }], onlyOwner);
    expect(out.record.channels.find((c) => c.id === GENERAL)).toEqual({ id: GENERAL, key: NEWSECRET, epoch: 1, name: "general", isPrivate: true });
    expect(out.added).toBe(1);
    expect(out.consumed).toBe(true);
  });

  it("a private room I hold moves only to a newer key, never back to an older one", () => {
    // SECRET is held at epoch 1. The room was made public and private again,
    // so its counter climbed (CORD-03 §2: monotonic, never resetting).
    const newer = absorbHeldInvites(held, [{ from: OWNER, bundle: bundle({ channels: [{ id: SECRET, key: NEWSECRET, epoch: 3, name: "secret" }] }) }], onlyOwner);
    expect(newer.record.channels.find((c) => c.id === SECRET)).toMatchObject({ key: NEWSECRET, epoch: 3, isPrivate: true });
    for (const epoch of [0, 1]) {
      const stale = absorbHeldInvites(held, [{ from: OWNER, bundle: bundle({ channels: [{ id: SECRET, key: NEWSECRET, epoch, name: "secret" }] }) }], onlyOwner);
      expect(stale.record.channels.find((c) => c.id === SECRET)?.key).toBe(hex("e"));
    }
  });

  it("with nothing waiting for this group, there's nothing to clear", () => {
    expect(absorbHeldInvites(held, [], onlyOwner)).toEqual({ record: held, added: 0, consumed: false });
  });
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
