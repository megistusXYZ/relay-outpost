/**
 * The reconciler is a destructive-write surface: it edits the only local copy of
 * a community's record, including rows that carry private channel keys. So the
 * tests are weighted toward what must NOT change — an untouchable sweep, an
 * empty fold, a torn-down fold, and a fold that is merely behind.
 */
import { describe, it, expect } from "vitest";
import { VSK, ADMIN_ROLE_ID, type FoldedState, type ChannelMetadata, type CommunityMetadata } from "./concord-events";
import type { StoredChannel, StoredCommunity } from "./concord-keys";
import { reconcilePatch, reconcile, RECONCILABLE, UNTOUCHABLE } from "./concord-reconcile";

const CID = "c".repeat(64);
const CH1 = "11".repeat(32);
const CH2 = "22".repeat(32);
const H = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

const rec = (over: Partial<StoredCommunity> = {}): StoredCommunity => ({
  community_id: CID, owner: "a".repeat(64), owner_salt: "salt",
  community_root: "root".padEnd(64, "0"), root_epoch: 3,
  channels: [], relays: ["wss://one"], name: "Group", addedAt: 1,
  // Level with the default fold head below, so a test that expects "nothing to
  // say" is not tripped by the reconciler legitimately learning the cursor.
  metaVersion: 5, metaEid: H(5),
  ...over,
});

const ch = (over: Partial<StoredChannel> = {}): StoredChannel =>
  ({ id: CH1, epoch: 3, name: "general", isPrivate: false, ...over });

/** An empty fold — exactly what a torn-down subscription produces. */
const empty = (): FoldedState => ({
  roles: new Map(), channels: new Map(), grants: new Map(),
  banlist: new Set(), banlistSeen: new Set(), dissolved: false, heads: new Map(),
});

const fold = (opts: {
  meta?: Partial<CommunityMetadata>; metaEv?: number;
  channels?: (Partial<ChannelMetadata> & { channel_id: string })[];
  chEv?: Record<string, number>;
  adminRole?: boolean;
} = {}): FoldedState => {
  const f = empty();
  if (opts.meta) {
    f.metadata = { name: "Group", relays: [], ...opts.meta };
    const ev = opts.metaEv ?? 5;
    f.heads.set(`${VSK.METADATA}:${CID}`, { ev, hash: H(ev) });
  }
  for (const c of opts.channels ?? []) {
    f.channels.set(c.channel_id, { name: "chan", ...c });
    const ev = opts.chEv?.[c.channel_id] ?? 2;
    f.heads.set(`${VSK.CHANNEL}:${c.channel_id}`, { ev, hash: H(ev) });
  }
  if (opts.adminRole) f.roles.set(ADMIN_ROLE_ID, { role_id: ADMIN_ROLE_ID, name: "Admin", position: 1, permissions: 0n, scope: { kind: "server" } });
  return f;
};

describe("reconcilePatch — silence is not an answer", () => {
  it("returns null for an entirely empty fold", () => {
    expect(reconcilePatch(rec(), empty())).toBeNull();
  });

  it("returns null for metadata with no admitted head", () => {
    const f = empty();
    f.metadata = { name: "Renamed", relays: [] };   // present, but no head
    expect(reconcilePatch(rec(), f)).toBeNull();
  });

  it("changes nothing when the fold tears down after a good reconcile", () => {
    const before = rec({ channels: [ch()] });
    const after = reconcile(before, fold({ meta: { name: "Renamed" } }))!;
    expect(after.name).toBe("Renamed");
    // Subscription torn down by a rekey: every map cleared. Must be inert.
    expect(reconcilePatch(after, empty())).toBeNull();
  });

  it("is idempotent — the second pass has nothing to say", () => {
    const f = fold({ meta: { name: "Renamed", about: "hi", allowMemberInvites: true } });
    const once = reconcile(rec(), f)!;
    expect(reconcilePatch(once, f)).toBeNull();
  });

  it("never propagates a deletion from a channel simply missing from the fold", () => {
    // Absence is how a torn-down map looks too, so it can never mean "deleted".
    const r = rec({ channels: [ch(), ch({ id: CH2, name: "other" })] });
    const patch = reconcilePatch(r, fold({ meta: { name: "Group" }, channels: [{ channel_id: CH1 }] }));
    expect(patch?.channels ?? r.channels).toHaveLength(2);
  });
});

describe("reconcilePatch — the untouchable set", () => {
  it("never emits a key outside the allowlist, even when the fold offers everything", () => {
    const r = rec({ channels: [ch({ key: "k".repeat(64), isPrivate: true })], banVersion: 4, banEid: H(4), banSnapshot: ["x"], grantVersions: { z: { version: 2, eid: H(2) } } });
    const patch = reconcilePatch(r, fold({
      meta: { name: "New", about: "a", picture: "p", allowMemberInvites: true, relays: ["wss://two"] },
      channels: [{ channel_id: CH1, name: "renamed" }, { channel_id: CH2, name: "seated" }],
      adminRole: true,
    }))!;
    for (const k of Object.keys(patch)) expect(RECONCILABLE).toContain(k);
    for (const k of UNTOUCHABLE) expect(patch).not.toHaveProperty(k);
  });

  it("leaves the key material and rekey state byte-identical", () => {
    const r = rec({ priorRoots: [{ root: "old", epoch: 2 }] });
    const out = reconcile(r, fold({ meta: { name: "New", about: "x" } }))!;
    expect(out.community_root).toBe(r.community_root);
    expect(out.root_epoch).toBe(r.root_epoch);
    expect(out.owner_salt).toBe(r.owner_salt);
    expect(out.owner).toBe(r.owner);
    expect(out.priorRoots).toBe(r.priorRoots);
  });

  it("never touches the banlist cursor, even with a banlist head in the fold", () => {
    const f = fold({ meta: { name: "New" } });
    f.heads.set(`${VSK.BANLIST}:${"ba".repeat(32)}`, { ev: 9, hash: H(9) });
    const patch = reconcilePatch(rec({ banVersion: 2, banEid: H(2), banSnapshot: ["p"] }), f)!;
    expect(patch).not.toHaveProperty("banVersion");
    expect(patch).not.toHaveProperty("banEid");
    expect(patch).not.toHaveProperty("banSnapshot");
  });
});

describe("reconcilePatch — metadata, anchored", () => {
  it("takes a newer folded name", () => {
    expect(reconcilePatch(rec({ name: "old" }), fold({ meta: { name: "new" } }))?.name).toBe("new");
  });

  it("never blanks a real name on the fold's empty-string coercion", () => {
    expect(reconcilePatch(rec({ name: "real" }), fold({ meta: { name: "" } }))?.name).toBeUndefined();
  });

  it("clears about on a positive empty string", () => {
    const patch = reconcilePatch(rec({ about: "old" }), fold({ meta: { name: "Group", about: "" } }));
    expect(patch).toHaveProperty("about");
    expect(patch?.about).toBeUndefined();
  });

  it("leaves about alone when the edition carries no about key at all", () => {
    expect(reconcilePatch(rec({ about: "keep" }), fold({ meta: { name: "Group" } }))).toBeNull();
  });

  it("ignores an object-shaped picture from another client", () => {
    const f = fold({ meta: { name: "Group" } });
    (f.metadata as unknown as { picture: unknown }).picture = { url: "x" };
    expect(reconcilePatch(rec({ icon: "keep" }), f)).toBeNull();
  });

  it("closes invites when the live policy closed them", () => {
    expect(reconcilePatch(rec({ allowMemberInvites: true }), fold({ meta: { name: "Group", allowMemberInvites: false } }))?.allowMemberInvites).toBe(false);
  });

  it("REFUSES a stale replayed edition below our cursor", () => {
    // A cold subscribe walks old editions in arrival order; persisting one would
    // re-open a policy the owner closed later.
    const r = rec({ metaVersion: 7, allowMemberInvites: false });
    expect(reconcilePatch(r, fold({ meta: { name: "Group", allowMemberInvites: true }, metaEv: 2 }))).toBeNull();
  });

  it("never reverts our own un-echoed publish", () => {
    const r = rec({ metaVersion: 5, metaEid: H(5) });
    expect(reconcilePatch(r, fold({ meta: { name: "Group" }, metaEv: 4 }))).toBeNull();
  });

  it("moves the cursor and its hash together, never one alone", () => {
    const patch = reconcilePatch(rec({ metaVersion: 4, name: "old" }), fold({ meta: { name: "new" }, metaEv: 6 }))!;
    expect(patch.metaVersion).toBe(6);
    expect(patch.metaEid).toBe(H(6));
  });

  it("unions relays, existing first, and never replaces them", () => {
    const patch = reconcilePatch(rec({ relays: ["wss://mine"] }), fold({ meta: { name: "Group", relays: ["wss://theirs"] } }))!;
    expect(patch.relays).toEqual(["wss://mine", "wss://theirs"]);
  });

  it("ignores a junk relay entry", () => {
    const f = fold({ meta: { name: "Group", relays: ["not-a-url"] } });
    expect(reconcilePatch(rec(), f)).toBeNull();
  });
});

describe("reconcilePatch — channels", () => {
  it("preserves a private channel's key, epoch and publish cursor across a rename", () => {
    const priv = ch({ key: "k".repeat(64), isPrivate: true, epoch: 9, edVersion: 3, edEid: H(3) });
    const patch = reconcilePatch(rec({ channels: [priv] }),
      fold({ channels: [{ channel_id: CH1, name: "renamed", private: true }], chEv: { [CH1]: 4 } }))!;
    const row = patch.channels![0];
    expect(row.key).toBe(priv.key);
    expect(row.epoch).toBe(9);
    expect(row.edVersion).toBe(3);
    expect(row.edEid).toBe(H(3));
    expect(row.name).toBe("renamed");
  });

  it("NEVER writes isPrivate false, even when the fold says so", () => {
    // The disclosure path: a false over a key-bearing row sends reads AND writes
    // to the public plane.
    const priv = ch({ key: "k".repeat(64), isPrivate: true });
    const patch = reconcilePatch(rec({ channels: [priv] }),
      fold({ channels: [{ channel_id: CH1, name: "general", private: false }] }));
    expect(patch?.channels?.[0].isPrivate ?? true).toBe(true);
  });

  it("heals isPrivate from a held key with no fold claim at all", () => {
    const broken = ch({ key: "k".repeat(64), isPrivate: false });
    const patch = reconcilePatch(rec({ channels: [broken] }), fold({ meta: { name: "Group" } }))!;
    expect(patch.channels![0].isPrivate).toBe(true);
  });

  it("seats a folded public channel the record lacks, keyless and at root_epoch", () => {
    const patch = reconcilePatch(rec({ root_epoch: 7 }), fold({ channels: [{ channel_id: CH2, name: "new" }] }))!;
    const seated = patch.channels!.find((c) => c.id === CH2)!;
    expect(seated).toMatchObject({ id: CH2, name: "new", isPrivate: false, epoch: 7 });
    expect(seated.key).toBeUndefined();
  });

  it("refuses to seat a folded PRIVATE channel", () => {
    // Seating could only ever hand a non-holder that room's id and name, which
    // then rides into invite bundles.
    expect(reconcilePatch(rec(), fold({ channels: [{ channel_id: CH2, name: "secret", private: true }] }))).toBeNull();
  });

  it("refuses to seat a channel with no admitted head", () => {
    const f = empty();
    f.channels.set(CH2, { channel_id: CH2, name: "ghost" });
    expect(reconcilePatch(rec(), f)).toBeNull();
  });

  it("retracts a keyless phantom the fold positively calls private", () => {
    const phantom = ch({ id: CH2, name: "leaked", isPrivate: false });
    const patch = reconcilePatch(rec({ channels: [phantom] }),
      fold({ channels: [{ channel_id: CH2, name: "leaked", private: true }] }))!;
    expect(patch.channels).toHaveLength(0);
    expect(patch.retractedChannels).toEqual([CH2]);
  });

  it("never retracts a row we hold the key for", () => {
    const mine = ch({ id: CH2, key: "k".repeat(64), isPrivate: true });
    const patch = reconcilePatch(rec({ channels: [mine] }),
      fold({ channels: [{ channel_id: CH2, name: "mine", private: true }] }));
    expect((patch?.channels ?? [mine])).toHaveLength(1);
  });

  it("does not re-seat a channel it already retracted", () => {
    const r = rec({ retractedChannels: [CH2] });
    expect(reconcilePatch(r, fold({ channels: [{ channel_id: CH2, name: "back", private: false }] }))).toBeNull();
  });

  it("ignores a replayed older channel edition once a newer one has settled", () => {
    const seeded = ch({ name: "v3name", seenEdVersion: 3 });
    expect(reconcilePatch(rec({ channels: [seeded] }),
      fold({ channels: [{ channel_id: CH1, name: "v1name" }], chEv: { [CH1]: 1 } }))).toBeNull();
  });
});

describe("reconcilePatch — the admin-role latch", () => {
  it("latches false to true on a positive folded claim", () => {
    expect(reconcilePatch(rec(), fold({ adminRole: true }))?.adminRolePublished).toBe(true);
  });

  it("never unlatches on an empty roles map", () => {
    expect(reconcilePatch(rec({ adminRolePublished: true }), fold({ meta: { name: "Group" } }))).toBeNull();
  });
});
