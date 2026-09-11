/**
 * The Community List (CORD-02 §8, kind 33302): how a member's groups follow
 * them across devices. We wrote the retired kind 13302: whole local records,
 * hex values, a 50-group cap, and no record of leaving, so a group left on one
 * device came back from another. Spec text quoted per test.
 */
import { describe, it, expect } from "vitest";
import { hexToB64u, b64uToHex, joinMaterialOf } from "./community-list";
import { mergeEntries, mergeLists, type ListEntry, type JoinMaterial } from "./community-list";
import { readFragments, type ListFragment } from "./community-list";
import { serializeEntry, recordFromEntry, entryFromLegacy } from "./community-list";
import { planListWrite } from "./community-list";
import { applyRemote } from "./community-list";
import { listChangesFor, planListChanges } from "./community-list";
import type { StoredCommunity } from "./concord-keys";

const hex = (b: string) => b.repeat(32);

/** A record as this device stores it: join material plus local bookkeeping. */
const record = {
  community_id: hex("0a"), owner: hex("0b"), owner_salt: hex("0c"), community_root: hex("0d"), root_epoch: 3,
  control_pk: hex("0e"), control_root: hex("0f"),
  channels: [
    { id: hex("1a"), key: hex("1b"), epoch: 2, name: "staff", isPrivate: true },
    { id: hex("1c"), epoch: 3, name: "general", isPrivate: false },
  ],
  relays: ["wss://r"], name: "Book Club",
  icon: "https://img.example/icon.png", addedAt: 1719800000000,
  priorRoots: [{ root: hex("2a"), epoch: 1 }], metaVersion: 4, grantVersions: {}, relayUrl: "wss://outpost",
} as unknown as StoredCommunity;

describe("community list encoding", () => {
  it("32-byte values travel as unpadded base64url, 43 characters, and come back exact", () => {
    // "Every 32-byte value … is unpadded base64url (RFC 4648 §5), 43 characters — at any depth."
    const v = hexToB64u(hex("ff"));
    expect(v).toHaveLength(43);
    expect(v).not.toMatch(/[=+/]/);
    expect(b64uToHex(v)).toBe(hex("ff"));
  });

  it("a membership carries only the join material the spec names: no icon, links or local bookkeeping", () => {
    // "owner, owner_salt, community_root, root_epoch, control_pk, channels, relays, name, plus control_root
    //  when the member holds it. Never the icon or link fields."
    const jm = joinMaterialOf(record);
    expect(Object.keys(jm).sort()).toEqual(
      ["channels", "community_root", "control_pk", "control_root", "name", "owner", "owner_salt", "relays", "root_epoch"].sort());
    expect(jm.owner).toBe(hexToB64u(hex("0b")));
    expect(jm.channels).toEqual([
      { id: hexToB64u(hex("1a")), key: hexToB64u(hex("1b")), epoch: 2, name: "staff" },
      { id: hexToB64u(hex("1c")), epoch: 3, name: "general" },
    ]);
    expect("control_root" in joinMaterialOf({ ...record, control_root: undefined })).toBe(false);
  });

  it("fields another app wrote survive our rewrite, including inside a room's entry", () => {
    // "A client MUST round-trip unknown fields verbatim … on every snapshot … and on every channels entry."
    const base = joinMaterialOf(record);
    const prior = { ...base, "vector/pinned": true, channels: [{ ...base.channels[0], "vector/key2": "abc" }, base.channels[1]] };
    const next = joinMaterialOf({ ...record, name: "Books & Tea" }, prior);
    expect(next.name).toBe("Books & Tea");
    expect(next["vector/pinned"]).toBe(true);
    expect((next.channels[0] as Record<string, unknown>)["vector/key2"]).toBe("abc");
  });
});

const cid = hexToB64u(hex("0a"));
const snap = (epoch: number, over: Partial<JoinMaterial> = {}): JoinMaterial => ({ ...joinMaterialOf(record), root_epoch: epoch, ...over });
const entry = (current: JoinMaterial, seed?: JoinMaterial, added_at = 1000): ListEntry =>
  ({ community_id: cid, current, ...(seed ? { seed } : {}), added_at });

describe("merging a group's copies from two devices", () => {
  it("current keeps the newest epoch and seed the oldest; an absent seed reads as current", () => {
    // "seed keeps the lower epoch, current keeps the higher … An absent seed reads as equal to current."
    const merged = mergeEntries(entry(snap(3)), entry(snap(5), snap(1)));
    expect(merged.current.root_epoch).toBe(5);
    expect(merged.seed?.root_epoch).toBe(1);
    const noSeeds = mergeEntries(entry(snap(2)), entry(snap(4)));
    expect(noSeeds.current.root_epoch).toBe(4);
    expect(noSeeds.seed?.root_epoch).toBe(2);
  });

  it("an epoch tie breaks on the lowest canonical bytes, so devices agree whatever order they merge in", () => {
    // "An epoch tie breaks on the lexicographically lowest canonical bytes of the whole snapshot."
    const a = entry(snap(3, { name: "Alpha" }));
    const b = entry(snap(3, { name: "Beta" }));
    expect(mergeEntries(a, b)).toEqual(mergeEntries(b, a));
    expect(mergeEntries(a, b).current.name).toBe("Alpha");
  });
});

describe("leaving a group", () => {
  it("a group left on one device stays gone: a copy added before the leave is dropped", () => {
    // "the newest of added_at and removed_at wins … backfill cannot re-add tombstoned ids."
    const list = mergeLists(
      { entries: [entry(snap(3), undefined, 1000)], tombstones: [] },
      { entries: [], tombstones: [{ community_id: cid, removed_at: 2000 }] });
    expect(list.entries).toEqual([]);
    expect(list.tombstones).toEqual([{ community_id: cid, removed_at: 2000 }]);
  });

  it("re-joining after leaving brings it back, and the leave stays on record", () => {
    const list = mergeLists(
      { entries: [entry(snap(3), undefined, 3000)], tombstones: [] },
      { entries: [], tombstones: [{ community_id: cid, removed_at: 2000 }] });
    expect(list.entries).toHaveLength(1);
    expect(list.tombstones).toHaveLength(1);
  });

  it("keeps exactly one leave per group, at the latest time", () => {
    // "Exactly one tombstone per Community — a second removal replaces it at the later timestamp."
    const list = mergeLists(
      { entries: [], tombstones: [{ community_id: cid, removed_at: 2000 }] },
      { entries: [], tombstones: [{ community_id: cid, removed_at: 5000 }] });
    expect(list.tombstones).toEqual([{ community_id: cid, removed_at: 5000 }]);
  });
});

/**
 * Fragments (CORD-02 §8): "A reader unions fragments; a community_id in
 * multiple fragments merges to one membership." "A client holds the complete
 * List when it holds a fragment at every index below frags." "A missing
 * fragment means unseen": never read as "no groups".
 */
describe("reading a list stored in fragments", () => {
  const other = hexToB64u(hex("5e"));
  const frag = (frags: number, entries: ListEntry[], extra: Record<string, unknown> = {}): ListFragment =>
    ({ frags, entries, tombstones: [], ...extra });

  it("unions every fragment; a group found in two fragments becomes one membership", () => {
    const read = readFragments([
      { index: 0, createdAt: 10, payload: frag(2, [entry(snap(3))]) },
      { index: 1, createdAt: 10, payload: frag(2, [entry(snap(5)), { ...entry(snap(1)), community_id: other }]) },
    ]);
    expect(read.list.entries).toHaveLength(2);
    expect(read.list.entries.find((e) => e.community_id === cid)?.current.root_epoch).toBe(5);
  });

  it("is complete only with a fragment at every index below frags, and names the ones missing", () => {
    const read = readFragments([
      { index: 0, createdAt: 10, payload: frag(3, [entry(snap(3))]) },
      { index: 2, createdAt: 10, payload: frag(3, []) },
    ]);
    expect(read.frags).toBe(3);
    expect(read.complete).toBe(false);
    expect(read.missing).toEqual([1]);
  });

  it("when fragments disagree on how many there are, the newest wins, and at equal age the larger", () => {
    // "disagreements resolve to the larger value at equal age": too large wastes a fetch, too small loses groups.
    expect(readFragments([
      { index: 0, createdAt: 20, payload: frag(1, []) },
      { index: 1, createdAt: 10, payload: frag(2, []) },
    ]).frags).toBe(1);
    expect(readFragments([
      { index: 0, createdAt: 10, payload: frag(1, []) },
      { index: 1, createdAt: 10, payload: frag(2, []) },
    ]).frags).toBe(2);
  });

  it("reads the newest copy of a fragment when relays hold different ones", () => {
    const read = readFragments([
      { index: 0, createdAt: 10, payload: frag(1, [entry(snap(3))]) },
      { index: 0, createdAt: 30, payload: frag(1, []) },
    ]);
    expect(read.list.entries).toEqual([]);
    expect(read.createdAt.get(0)).toBe(30);
  });

  it("keeps fields another app put on a fragment; where two set the same one, the lowest index wins", () => {
    // "A reader unions them across fragments — where two carry the same key, the lowest index wins."
    const read = readFragments([
      { index: 1, createdAt: 10, payload: frag(2, [], { "vector/sort": "b", "vector/theme": "dusk" }) },
      { index: 0, createdAt: 10, payload: frag(2, [], { "vector/sort": "a" }) },
    ]);
    expect(read.extra).toEqual({ "vector/sort": "a", "vector/theme": "dusk" });
  });
});

/**
 * Byte-identical serialization (CORD-02 §8): snapshots "carry no community_id
 * (inheriting the entry's)", "seed is absent when equal to current — byte
 * equality", and a writer "MUST overwrite seed's cosmetic fields from current
 * on every serialization, ensuring two devices with identical state serialize
 * identical bytes."
 */
describe("writing a membership", () => {
  it("the seed's name, relays and room names always follow current, and a seed equal to current is left out", () => {
    const old = snap(1, { name: "Old name", relays: ["wss://old"] });
    old.channels = old.channels.map((c) => ({ ...c, name: `${c.name}-old` }));
    const out = serializeEntry({ community_id: cid, seed: old, current: snap(3, { name: "New name" }), added_at: 1000 });
    expect(out.seed?.name).toBe("New name");
    expect(out.seed?.relays).toEqual(out.current.relays);
    expect(out.seed?.channels.map((c) => c.name)).toEqual(out.current.channels.map((c) => c.name));
    expect(out.seed?.root_epoch).toBe(1);

    const same = serializeEntry({ community_id: cid, seed: snap(3, { name: "Stale" }), current: snap(3, { name: "Fresh" }), added_at: 1000 });
    expect("seed" in same).toBe(false);
  });

  it("a snapshot never repeats the group id", () => {
    const out = serializeEntry({ community_id: cid, current: { ...snap(3), community_id: cid } as JoinMaterial, added_at: 1000 });
    expect("community_id" in out.current).toBe(false);
  });
});

describe("reading a membership back", () => {
  it("gives the device its keys, and the seed's older root so earlier history stays readable", () => {
    const back = recordFromEntry({ community_id: cid, seed: snap(1, { community_root: hexToB64u(hex("2a")) }), current: snap(3), added_at: 1000 });
    expect(back.community_id).toBe(hex("0a"));
    expect(back.owner).toBe(hex("0b"));
    expect(back.community_root).toBe(hex("0d"));
    expect(back.root_epoch).toBe(3);
    expect(back.control_pk).toBe(hex("0e"));
    expect(back.control_root).toBe(hex("0f"));
    expect(back.channels).toEqual([
      { id: hex("1a"), key: hex("1b"), epoch: 2, name: "staff", isPrivate: true },
      { id: hex("1c"), epoch: 3, name: "general", isPrivate: false },
    ]);
    // With that epoch's admin address, so its admin plane stays readable too.
    expect(back.priorRoots).toEqual([{ root: hex("2a"), epoch: 1, control_pk: hex("0e") }]);
    expect(back.addedAt).toBe(1000);
  });

  it("an entry from the old kind-13302 backup becomes a proper membership", () => {
    const legacy = entryFromLegacy({ community_id: hex("0a"), seed: record, current: record, added_at: 900 });
    expect(legacy.community_id).toBe(cid);
    expect(legacy.current).toEqual(joinMaterialOf(record));
    expect(legacy.added_at).toBe(900);
  });
});

/**
 * Writing (CORD-02 §8): "Adding, updating, or tombstoning one membership
 * rewrites only its fragment." "Every write is read-modify-write: a client
 * MUST union its own state into the newest copy it holds of each fragment it
 * rewrites, and MUST NOT publish a fragment built from local state alone."
 * "MUST publish it with a created_at strictly greater than that fragment's
 * previous value."
 */
describe("planning a write to the list", () => {
  const someone = hexToB64u(hex("5e"));
  const member = (id: string, epoch = 3, added = 1000): ListEntry => ({ ...entry(snap(epoch), undefined, added), community_id: id });
  const fragment = (frags: number, entries: ListEntry[]): ListFragment => ({ frags, entries, tombstones: [] });
  const readOf = (fragments: ListFragment[], createdAt = 100) =>
    readFragments(fragments.map((payload, index) => ({ index, createdAt, payload })));

  it("updating a group rewrites only the fragment that holds it, on top of the newest copy", () => {
    const read = readOf([fragment(2, [member(someone)]), fragment(2, [member(cid, 3)])]);
    const plan = planListWrite({ read }, { upsert: member(cid, 5) }, { nowSec: 50 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes.map((w) => w.index)).toEqual([1]);
    expect(plan.writes[0].payload.entries.find((e) => e.community_id === cid)?.current.root_epoch).toBe(5);
    // Past the copy it read (100), even though this device's clock says 50.
    expect(plan.writes[0].createdAt).toBe(101);
  });

  it("a new group goes into the last fragment, keeping what is already there", () => {
    const read = readOf([fragment(2, [member(cid)]), fragment(2, [member(someone)])]);
    const newcomer = hexToB64u(hex("6f"));
    const plan = planListWrite({ read }, { upsert: member(newcomer) }, { nowSec: 500 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes.map((w) => w.index)).toEqual([1]);
    expect(plan.writes[0].payload.entries.map((e) => e.community_id).sort()).toEqual([someone, newcomer].sort());
    expect(plan.writes[0].payload.frags).toBe(2);
  });

  it("leaving writes a leave marker into that group's fragment, and its entry drops out there", () => {
    const read = readOf([fragment(1, [member(cid), member(someone)])]);
    const plan = planListWrite({ read }, { tombstone: { community_id: cid, removed_at: 2000 } }, { nowSec: 500 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes[0].payload.entries.map((e) => e.community_id)).toEqual([someone]);
    expect(plan.writes[0].payload.tombstones).toEqual([{ community_id: cid, removed_at: 2000 }]);
  });

  it("never writes from nothing: without the list, or proof that none exists, it refuses", () => {
    expect(planListWrite({ read: null }, { upsert: member(cid) }, { nowSec: 500 })).toEqual({ ok: false, reason: "not-loaded" });
  });

  it("with proof that no list exists yet, the first write starts fragment 0 of 1", () => {
    const plan = planListWrite({ read: null, confirmedEmpty: true }, { upsert: member(cid) }, { nowSec: 500 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].index).toBe(0);
    expect(plan.writes[0].createdAt).toBe(500);
    expect(plan.writes[0].payload.frags).toBe(1);
    expect(plan.writes[0].payload.entries.map((e) => e.community_id)).toEqual([cid]);
  });
});

/**
 * The guards (CORD-02 §8): the size ceiling "MUST start a new fragment rather
 * than exceed it"; a repack "MUST NOT proceed without the complete List, or it
 * silently drops every membership living in the fragments it never read"; "a
 * write that strictly shrinks a fragment is exempt from the ceiling"; and
 * fragment-level unknowns are serialized onto fragment 0.
 */
describe("the write guards", () => {
  const member = (id: string, epoch = 3, added = 1000): ListEntry => ({ ...entry(snap(epoch), undefined, added), community_id: id });
  const fragment = (frags: number, entries: ListEntry[], extra: Record<string, unknown> = {}): ListFragment => ({ frags, entries, tombstones: [], ...extra });
  const at = (index: number, payload: ListFragment, createdAt = 100) => ({ index, createdAt, payload });
  const id = (b: string) => hexToB64u(hex(b));
  // Just over a two-group fragment: adding a third overflows it.
  const budgetFor2 = new TextEncoder().encode(JSON.stringify(fragment(3, [member(cid), member(id("5e"))]))).length + 16;

  it("never builds a fragment it has not read: a new group when the last fragment is missing is refused", () => {
    const read = readFragments([at(0, fragment(2, [member(cid)]))]);
    expect(planListWrite({ read }, { upsert: member(id("6f")) }, { nowSec: 500 })).toEqual({ ok: false, reason: "incomplete" });
  });

  it("a full fragment splits: the new group starts the next fragment and raises the count", () => {
    const read = readFragments([at(0, fragment(1, [member(cid), member(id("5e"))]))]);
    const plan = planListWrite({ read }, { upsert: member(id("6f")) }, { nowSec: 500, maxBytes: budgetFor2 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes.map((w) => w.index)).toEqual([1]);
    expect(plan.writes[0].payload.frags).toBe(2);
    expect(plan.writes[0].payload.entries.map((e) => e.community_id)).toEqual([id("6f")]);
  });

  it("a split needs the whole list: with a fragment missing it refuses rather than guess the count", () => {
    const read = readFragments([at(0, fragment(3, [member(cid)])), at(2, fragment(3, [member(id("5e")), member(id("7a"))]))]);
    expect(planListWrite({ read }, { upsert: member(id("6f")) }, { nowSec: 500, maxBytes: budgetFor2 })).toEqual({ ok: false, reason: "incomplete" });
  });

  it("leaving is never blocked by the size limit", () => {
    const read = readFragments([at(0, fragment(1, [member(cid), member(id("5e"))]))]);
    const plan = planListWrite({ read }, { tombstone: { community_id: cid, removed_at: 2000 } }, { nowSec: 500, maxBytes: 100 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes.map((w) => w.index)).toEqual([0]);
    expect(plan.writes[0].payload.entries.map((e) => e.community_id)).toEqual([id("5e")]);
  });

  it("fields another app put on the list stay on fragment 0", () => {
    const read = readFragments([at(0, fragment(2, [member(cid)], { "vector/sort": "a" })), at(1, fragment(2, [], { "vector/theme": "dusk" }))]);
    const plan = planListWrite({ read }, { upsert: member(cid, 4) }, { nowSec: 500 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes[0].index).toBe(0);
    expect(plan.writes[0].payload).toMatchObject({ "vector/sort": "a", "vector/theme": "dusk" });
  });
});

/**
 * Taking up the List on this device (owner calls, 2026-09-11): a group joined
 * on another device appears here, and a group left anywhere is dropped here
 * too, keys and all. Only a later re-join outweighs a leave. A newer key
 * version from another device is adopted, the old one kept for history.
 */
describe("taking up the list from your other devices", () => {
  const listed = (over: Partial<ListEntry> = {}): ListEntry => ({ community_id: cid, current: snap(3), added_at: 1000, ...over });

  it("a group from your other device appears here", () => {
    const out = applyRemote([], { entries: [listed()], tombstones: [] });
    expect(out.add.map((r) => r.community_id)).toEqual([hex("0a")]);
    expect(out.remove).toEqual([]);
  });

  it("a group you left on another device leaves this one too", () => {
    const out = applyRemote([{ ...record, addedAt: 1000 }], { entries: [], tombstones: [{ community_id: cid, removed_at: 2000 }] });
    expect(out.remove).toEqual([hex("0a")]);
  });

  it("a group you re-joined here after leaving elsewhere stays", () => {
    const out = applyRemote([{ ...record, addedAt: 3000 }], { entries: [], tombstones: [{ community_id: cid, removed_at: 2000 }] });
    expect(out.remove).toEqual([]);
  });

  it("a group re-joined on another device after a leave is not dropped here first", () => {
    // Left at 2000 and re-joined elsewhere at 3000: the membership is live.
    // Dropping this device's copy (from 1000) would delete its keys and local
    // state only to take the group up again on the next sync.
    const out = applyRemote([{ ...record, addedAt: 1000 }], { entries: [listed({ added_at: 3000 })], tombstones: [{ community_id: cid, removed_at: 2000 }] });
    expect(out.remove).toEqual([]);
    expect(out.add).toEqual([]);
  });

  it("a newer key version from another device is taken up, and the old one stays readable", () => {
    const local = { ...record, root_epoch: 2 } as StoredCommunity;
    const out = applyRemote([local], { entries: [listed({ current: snap(3, { community_root: hexToB64u(hex("3c")) }) })], tombstones: [] });
    expect(out.advance).toHaveLength(1);
    expect(out.advance[0].root_epoch).toBe(3);
    expect(out.advance[0].community_root).toBe(hex("3c"));
    expect(out.advance[0].priorRoots?.some((p) => p.epoch === 2 && p.root === hex("0d"))).toBe(true);
    // What only this device keeps (its edit cursors) is not lost in the update.
    expect(out.advance[0].metaVersion).toBe(4);
  });
});

/**
 * Catching the List up with this device: which memberships to write. Only
 * real differences produce a write, so a sync that finds everything in step
 * publishes nothing.
 */
describe("what this device writes to the list", () => {
  const listedCopy = (r: StoredCommunity, extra: Partial<JoinMaterial> = {}): ListEntry =>
    ({ community_id: hexToB64u(r.community_id), current: { ...joinMaterialOf(r), ...extra }, added_at: r.addedAt });

  it("a group only this device knows is added to the list", () => {
    const changes = listChangesFor([record], { entries: [], tombstones: [] }, {});
    expect(changes).toHaveLength(1);
    expect("upsert" in changes[0] && changes[0].upsert.community_id).toBe(cid);
    expect("upsert" in changes[0] && changes[0].upsert.added_at).toBe(record.addedAt);
  });

  it("a group already listed the same way needs no write", () => {
    expect(listChangesFor([record], { entries: [listedCopy(record)], tombstones: [] }, {})).toEqual([]);
  });

  it("a group you left here is written as a leave, unless the list already has that leave", () => {
    const changes = listChangesFor([], { entries: [], tombstones: [] }, { [hex("0a")]: 5000 });
    expect(changes).toEqual([{ tombstone: { community_id: cid, removed_at: 5000 } }]);
    expect(listChangesFor([], { entries: [], tombstones: [{ community_id: cid, removed_at: 6000 }] }, { [hex("0a")]: 5000 })).toEqual([]);
  });

  // Names are cosmetic here: at one epoch the spec settles a disagreement by the
  // lowest canonical bytes, and a group's real name comes from its fold. What
  // must reach the list is a newer key version, with other apps' fields kept.
  it("a newer key version here updates the listed copy and keeps what other apps wrote", () => {
    const listed = listedCopy(record, { "vector/pinned": true });
    const rotated = { ...record, root_epoch: 4, community_root: hex("3c") } as StoredCommunity;
    const changes = listChangesFor([rotated], { entries: [listed], tombstones: [] }, {});
    expect(changes).toHaveLength(1);
    const up = "upsert" in changes[0] ? changes[0].upsert : null;
    expect(up?.current.root_epoch).toBe(4);
    expect(up?.current["vector/pinned"]).toBe(true);
  });

  // It may add its older epoch as the seed (backfill, which the spec wants);
  // it must never move the list's current copy backwards.
  it("a device still on an older key version never rolls the list's current copy back", () => {
    const newer = listedCopy({ ...record, root_epoch: 5 } as StoredCommunity);
    const changes = listChangesFor([{ ...record, root_epoch: 3 } as StoredCommunity], { entries: [newer], tombstones: [] }, {});
    const written = changes.flatMap((c) => ("upsert" in c ? [c.upsert] : []));
    const after = mergeLists({ entries: [newer], tombstones: [] }, { entries: written, tombstones: [] });
    expect(after.entries[0].current.root_epoch).toBe(5);
  });
});

/**
 * One sync can owe the List several changes (a join from this device, a leave
 * from another). They go out as one write per fragment: two writes to the same
 * address within a second would race, and the second would need a created_at
 * past the first anyway.
 */
describe("writing several changes at once", () => {
  const member = (id: string, epoch = 3, added = 1000): ListEntry => ({ ...entry(snap(epoch), undefined, added), community_id: id });
  const fragment = (frags: number, entries: ListEntry[]): ListFragment => ({ frags, entries, tombstones: [] });
  const at = (index: number, payload: ListFragment, createdAt = 100) => ({ index, createdAt, payload });
  const id = (b: string) => hexToB64u(hex(b));

  it("changes that land in the same fragment go out as one write carrying all of them", () => {
    const read = readFragments([at(0, fragment(1, [member(cid), member(id("5e"))]))]);
    const plan = planListChanges({ read }, [
      { upsert: member(id("6f")) },
      { tombstone: { community_id: cid, removed_at: 2000 } },
    ], { nowSec: 500 });
    expect(plan.refused).toEqual([]);
    expect(plan.writes.map((w) => w.index)).toEqual([0]);
    expect(plan.writes[0].createdAt).toBe(500);
    expect(plan.writes[0].payload.entries.map((e) => e.community_id).sort()).toEqual([id("5e"), id("6f")].sort());
    expect(plan.writes[0].payload.tombstones).toEqual([{ community_id: cid, removed_at: 2000 }]);
  });

  it("changes in different fragments go out once each, each past the copy it replaces", () => {
    const read = readFragments([at(0, fragment(2, [member(cid)]), 100), at(1, fragment(2, [member(id("5e"))]), 700)]);
    const plan = planListChanges({ read }, [
      { upsert: member(cid, 5) },
      { upsert: member(id("6f")) },
      { tombstone: { community_id: id("5e"), removed_at: 2000 } },
    ], { nowSec: 500 });
    expect(plan.refused).toEqual([]);
    expect(plan.writes.map((w) => [w.index, w.createdAt])).toEqual([[0, 500], [1, 701]]);
  });

  it("a join that cannot be written yet does not hold back a leave that can", () => {
    // Fragment 1 was never read: a new group (which goes last) must wait.
    const read = readFragments([at(0, fragment(2, [member(cid)]))]);
    const join = { upsert: member(id("6f")) };
    const plan = planListChanges({ read }, [join, { tombstone: { community_id: cid, removed_at: 2000 } }], { nowSec: 500 });
    expect(plan.refused).toEqual([{ change: join, reason: "incomplete" }]);
    expect(plan.writes.map((w) => w.index)).toEqual([0]);
    expect(plan.writes[0].payload.entries).toEqual([]);
  });

  it("with nothing loaded, nothing is written and every change waits", () => {
    const changes = [{ upsert: member(cid) }, { tombstone: { community_id: id("5e"), removed_at: 2000 } }];
    const plan = planListChanges({ read: null }, changes, { nowSec: 500 });
    expect(plan.writes).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual(["not-loaded", "not-loaded"]);
  });

  it("with proof no list exists, several joins start one fragment together", () => {
    const plan = planListChanges({ read: null, confirmedEmpty: true }, [{ upsert: member(cid) }, { upsert: member(id("5e")) }], { nowSec: 500 });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ index: 0, createdAt: 500, payload: { frags: 1 } });
    expect(plan.writes[0].payload.entries).toHaveLength(2);
  });
});
