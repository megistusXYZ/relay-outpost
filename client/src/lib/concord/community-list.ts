/**
 * The Community List (CORD-02 §8, kind 33302): how a member's groups follow
 * them across devices. Addressable events, NIP-44-encrypted to self, one per
 * fragment (`d` = fragment index), holding every group they are in and left.
 *
 * It replaces kind 13302, which the spec retired and which we wrote as whole
 * local records (every private field of StoredCommunity), in hex, capped at 50
 * groups, and with no record of leaving — so a group left on one device came
 * back from another. We keep READING 13302 so nothing is lost, and write only
 * this (owner call, 2026-09-11).
 *
 * This module is pure: encoding, merging, fragments, planning. The relay I/O
 * lives in community-list-sync.ts (the sync) and community-list-live.ts (the
 * app's relays and key store).
 */
import type { StoredCommunity } from "./concord-keys";

/** A room inside join material. Unknown fields (another app's) ride along verbatim. */
export type ListChannel = { id: string; key?: string; epoch: number; name: string; [field: string]: unknown };

/**
 * "owner, owner_salt, community_root, root_epoch, control_pk, channels, relays,
 * name, plus control_root when the member holds it. Never the icon or link
 * fields." Every 32-byte value is unpadded base64url. Unknown fields ride along.
 */
export type JoinMaterial = {
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  control_pk?: string;
  control_root?: string;
  channels: ListChannel[];
  relays: string[];
  name: string;
  [field: string]: unknown;
};

const SNAPSHOT_FIELDS = new Set(["owner", "owner_salt", "community_root", "root_epoch", "control_pk", "control_root", "channels", "relays", "name"]);
const CHANNEL_FIELDS = new Set(["id", "key", "epoch", "name"]);

// ── Encoding ─────────────────────────────────────────────────────────────────
/** "Unpadded base64url (RFC 4648 §5), 43 characters": one spelling per value. */
export function hexToB64u(hex: string): string {
  let bin = "";
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uToHex(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

const unknownOf = (o: Record<string, unknown> | undefined, known: Set<string>): Record<string, unknown> =>
  o ? Object.fromEntries(Object.entries(o).filter(([k]) => !known.has(k))) : {};

// ── Join material ────────────────────────────────────────────────────────────
/**
 * A record's join material, as the List carries it. `prior` is the snapshot we
 * last read for this group: whatever another app wrote into it survives, on the
 * snapshot and on every room, and a room we hold no record of (a private room
 * another app knows) is carried along untouched. Dropping it would destroy that
 * key on every device the member owns the moment we republish.
 */
export function joinMaterialOf(record: StoredCommunity, prior?: JoinMaterial): JoinMaterial {
  const priorRooms = new Map((prior?.channels ?? []).map((c) => [c.id, c]));
  const ours = record.channels.map((ch): ListChannel => {
    const id = hexToB64u(ch.id);
    return {
      id,
      ...(ch.key ? { key: hexToB64u(ch.key) } : {}),
      epoch: ch.epoch,
      name: ch.name,
      ...unknownOf(priorRooms.get(id), CHANNEL_FIELDS),
    };
  });
  const oursIds = new Set(ours.map((c) => c.id));
  const theirsOnly = (prior?.channels ?? []).filter((c) => !oursIds.has(c.id));
  return {
    owner: hexToB64u(record.owner),
    owner_salt: hexToB64u(record.owner_salt),
    community_root: hexToB64u(record.community_root),
    root_epoch: record.root_epoch,
    ...(record.control_pk ? { control_pk: hexToB64u(record.control_pk) } : {}),
    ...(record.control_root ? { control_root: hexToB64u(record.control_root) } : {}),
    channels: [...ours, ...theirsOnly],
    relays: record.relays,
    name: record.name,
    ...unknownOf(prior, SNAPSHOT_FIELDS),
  };
}

// ── Memberships and merging ──────────────────────────────────────────────────
/** One membership. `seed` = earliest epoch (backfill), `current` = latest. */
export type ListEntry = { community_id: string; seed?: JoinMaterial; current: JoinMaterial; added_at: number; [field: string]: unknown };
/** A leave. Permanent; only a later `added_at` (a re-join) outweighs it. */
export type ListTombstone = { community_id: string; removed_at: number; [field: string]: unknown };
export type CommunityList = { entries: ListEntry[]; tombstones: ListTombstone[] };

const ENTRY_FIELDS = new Set(["community_id", "seed", "current", "added_at"]);

/**
 * Canonical bytes for the tie-break: JSON with object keys sorted at every
 * level. Unknown fields are part of it ("part of the canonical bytes the
 * tie-break compares"), so a total order holds and devices never flap.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const lowerOf = <T>(x: T, y: T): T => (canonical(x) <= canonical(y) ? x : y);

function pickCurrent(x: JoinMaterial, y: JoinMaterial): JoinMaterial {
  if (x.root_epoch !== y.root_epoch) return x.root_epoch > y.root_epoch ? x : y;
  return lowerOf(x, y);
}
function pickSeed(x: JoinMaterial, y: JoinMaterial): JoinMaterial {
  if (x.root_epoch !== y.root_epoch) return x.root_epoch < y.root_epoch ? x : y;
  return lowerOf(x, y);
}

/** Unknown fields from both sides; where they disagree, the lower canonical value, so the merge commutes. */
function mergeUnknown(a: Record<string, unknown>, b: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (known.has(k)) continue;
    if (!(k in b)) out[k] = a[k];
    else if (!(k in a)) out[k] = b[k];
    else out[k] = lowerOf(a[k], b[k]);
  }
  return out;
}

/**
 * Two copies of one membership. "seed keeps the lower epoch, current keeps the
 * higher. An epoch tie breaks on the lexicographically lowest canonical bytes
 * of the whole snapshot … An absent seed reads as equal to current." The seed
 * is left out when it equals current, as the spec requires.
 */
export function mergeEntries(a: ListEntry, b: ListEntry): ListEntry {
  const current = pickCurrent(a.current, b.current);
  const seed = pickSeed(a.seed ?? a.current, b.seed ?? b.current);
  return {
    ...mergeUnknown(a, b, ENTRY_FIELDS),
    community_id: a.community_id,
    ...(canonical(seed) !== canonical(current) ? { seed } : {}),
    current,
    added_at: Math.max(a.added_at, b.added_at),
  };
}

/**
 * Two lists. "Exactly one tombstone per Community — a second removal replaces
 * it at the later timestamp — and it is permanent", and "a client MUST omit an
 * entry whose added_at ≤ removed_at": a leave keeps a group gone until a later
 * re-join brings it back.
 */
export function mergeLists(a: CommunityList, b: CommunityList): CommunityList {
  const tombs = new Map<string, ListTombstone>();
  for (const t of [...a.tombstones, ...b.tombstones]) {
    const prev = tombs.get(t.community_id);
    if (!prev || t.removed_at > prev.removed_at || (t.removed_at === prev.removed_at && canonical(t) < canonical(prev))) {
      tombs.set(t.community_id, t);
    }
  }
  const entries = new Map<string, ListEntry>();
  for (const e of [...a.entries, ...b.entries]) {
    const prev = entries.get(e.community_id);
    entries.set(e.community_id, prev ? mergeEntries(prev, e) : e);
  }
  const live = [...entries.values()].filter((e) => {
    const t = tombs.get(e.community_id);
    return !t || e.added_at > t.removed_at;
  });
  return { entries: live, tombstones: [...tombs.values()] };
}

// ── Fragments ────────────────────────────────────────────────────────────────
/** One fragment's decrypted payload. `frags` is declared in every fragment. */
export type ListFragment = { frags: number; entries: ListEntry[]; tombstones: ListTombstone[]; [field: string]: unknown };
/** A fragment as read from a relay: its `d` index and the event's created_at. */
export type ReadFragment = { index: number; createdAt: number; payload: ListFragment };

const FRAGMENT_FIELDS = new Set(["frags", "entries", "tombstones"]);

/**
 * Read a List from the fragments in hand (CORD-02 §8).
 *
 * - The newest copy of each index is the one that counts ("MUST NOT republish
 *   from a copy older than the newest it has seen for that index").
 * - `frags`: the newest fragment's claim, the larger at equal age ("too large
 *   wastes a fetch, too small pushes live memberships out of range").
 * - Fragments are unioned; one group in two fragments is one membership.
 * - Complete only with a fragment at every index below `frags`. "A missing
 *   fragment means unseen": the caller must not act as if it were empty.
 * - Fragment-level unknown fields are unioned, the lowest index winning.
 */
export function readFragments(fragments: ReadFragment[]): {
  list: CommunityList;
  frags: number;
  complete: boolean;
  missing: number[];
  /** Newest created_at per index: a rewrite must go strictly past it. */
  createdAt: Map<number, number>;
  /** The newest copy of each index, for read-modify-write. */
  byIndex: Map<number, ReadFragment>;
  /** Fragment-level unknown fields, which a writer puts on fragment 0. */
  extra: Record<string, unknown>;
} {
  const byIndex = new Map<number, ReadFragment>();
  for (const f of fragments) {
    if (!Number.isInteger(f.index) || f.index < 0 || !f.payload || typeof f.payload !== "object") continue;
    const prev = byIndex.get(f.index);
    if (!prev || f.createdAt > prev.createdAt) byIndex.set(f.index, f);
  }

  let frags = 0;
  let fragsAt = -Infinity;
  for (const f of byIndex.values()) {
    const n = Number(f.payload.frags);
    if (!Number.isInteger(n) || n < 1) continue;
    if (f.createdAt > fragsAt || (f.createdAt === fragsAt && n > frags)) { frags = n; fragsAt = f.createdAt; }
  }

  let list: CommunityList = { entries: [], tombstones: [] };
  for (const f of byIndex.values()) {
    list = mergeLists(list, {
      entries: Array.isArray(f.payload.entries) ? f.payload.entries : [],
      tombstones: Array.isArray(f.payload.tombstones) ? f.payload.tombstones : [],
    });
  }

  const missing: number[] = [];
  for (let i = 0; i < frags; i++) if (!byIndex.has(i)) missing.push(i);

  const extra: Record<string, unknown> = {};
  for (const f of [...byIndex.values()].sort((a, b) => a.index - b.index)) {
    for (const [k, v] of Object.entries(f.payload)) if (!FRAGMENT_FIELDS.has(k) && !(k in extra)) extra[k] = v;
  }

  return {
    list, frags, complete: frags > 0 && missing.length === 0, missing,
    createdAt: new Map([...byIndex].map(([i, f]) => [i, f.createdAt])),
    byIndex, extra,
  };
}

// ── Serialization and conversion ─────────────────────────────────────────────
function withoutId(snapshot: JoinMaterial): JoinMaterial {
  const { community_id: _id, ...rest } = snapshot as JoinMaterial & { community_id?: unknown };
  return rest as JoinMaterial;
}

/**
 * A membership exactly as the List carries it (CORD-02 §8): snapshots "carry
 * no community_id", the writer "MUST overwrite seed's cosmetic fields from
 * current on every serialization" (name, relays, room names), and "seed is
 * absent when equal to current — byte equality". Two devices holding the same
 * state then write the same bytes.
 */
export function serializeEntry(entry: ListEntry): ListEntry {
  const current = withoutId(entry.current);
  const { seed: rawSeed, current: _c, ...rest } = entry;
  if (!rawSeed) return { ...rest, current };
  const names = new Map(current.channels.map((c) => [c.id, c.name]));
  const seed: JoinMaterial = {
    ...withoutId(rawSeed),
    name: current.name,
    relays: current.relays,
    channels: rawSeed.channels.map((c) => (names.has(c.id) ? { ...c, name: names.get(c.id)! } : c)),
  };
  return canonical(seed) === canonical(current) ? { ...rest, current } : { ...rest, seed, current };
}

/**
 * The record a device keeps for a membership: the current epoch's keys, and
 * the seed's older root (with its admin address) as a prior root, so history
 * from before a rotation stays readable on a new device.
 */
export function recordFromEntry(entry: ListEntry): StoredCommunity {
  const c = entry.current;
  const seed = entry.seed;
  return {
    community_id: b64uToHex(entry.community_id),
    owner: b64uToHex(c.owner),
    owner_salt: b64uToHex(c.owner_salt),
    community_root: b64uToHex(c.community_root),
    root_epoch: c.root_epoch,
    ...(c.control_pk ? { control_pk: b64uToHex(c.control_pk) } : {}),
    ...(c.control_root ? { control_root: b64uToHex(c.control_root) } : {}),
    channels: c.channels.map((ch) => ({
      id: b64uToHex(ch.id),
      ...(ch.key ? { key: b64uToHex(ch.key) } : {}),
      epoch: ch.epoch,
      name: ch.name,
      isPrivate: !!ch.key,
    })),
    relays: c.relays,
    name: c.name,
    addedAt: entry.added_at,
    ...(seed && seed.root_epoch < c.root_epoch
      ? { priorRoots: [{ root: b64uToHex(seed.community_root), epoch: seed.root_epoch, ...(seed.control_pk ? { control_pk: b64uToHex(seed.control_pk) } : {}) }] }
      : {}),
  };
}

/** An entry from the retired kind-13302 backup (whole records, hex) as a membership. */
export function entryFromLegacy(legacy: { community_id: string; seed?: StoredCommunity; current: StoredCommunity; added_at: number }): ListEntry {
  const current = joinMaterialOf(legacy.current);
  const seed = legacy.seed && legacy.seed.root_epoch < legacy.current.root_epoch ? joinMaterialOf(legacy.seed) : undefined;
  return { community_id: hexToB64u(legacy.community_id), ...(seed ? { seed } : {}), current, added_at: legacy.added_at };
}

// ── Planning a write ─────────────────────────────────────────────────────────
/** One membership change: a join or update, or a leave. */
export type ListChange = { upsert: ListEntry } | { tombstone: ListTombstone };
/** A fragment to publish: its index, the created_at it must carry, its payload. */
export type PlannedWrite = { index: number; createdAt: number; payload: ListFragment };
export type WritePlan =
  | { ok: true; writes: PlannedWrite[] }
  /** not-loaded: no List in hand and no proof none exists. incomplete: the fragment to rewrite was never read. */
  | { ok: false; reason: "not-loaded" | "incomplete" };

function holds(f: ListFragment, id: string): boolean {
  return (Array.isArray(f.entries) && f.entries.some((e) => e.community_id === id))
    || (Array.isArray(f.tombstones) && f.tombstones.some((t) => t.community_id === id));
}

/** A fragment rewritten: the newest copy we read, with the change unioned in. */
function rewrite(prior: ListFragment, change: ListChange, frags: number, listExtra: Record<string, unknown>): ListFragment {
  const merged = mergeLists(
    { entries: Array.isArray(prior.entries) ? prior.entries : [], tombstones: Array.isArray(prior.tombstones) ? prior.tombstones : [] },
    "upsert" in change ? { entries: [change.upsert], tombstones: [] } : { entries: [], tombstones: [change.tombstone] },
  );
  const fragmentExtra = Object.fromEntries(Object.entries(prior).filter(([k]) => !FRAGMENT_FIELDS.has(k)));
  return { ...listExtra, ...fragmentExtra, frags, entries: merged.entries.map(serializeEntry), tombstones: merged.tombstones };
}

/**
 * Plan the publish for one membership change (CORD-02 §8).
 *
 * - Never from nothing: with no List read, the only licence to write is proof
 *   that none exists (`confirmedEmpty`, from a relay that answered), and then
 *   the first write starts fragment 0 of 1. "MUST NOT publish a fragment built
 *   from local state alone" — the replaceable-event wipe rule, in the spec.
 * - Scoped: only the fragment holding the group is rewritten ("Adding,
 *   updating, or tombstoning one membership rewrites only its fragment"); a
 *   group it has never held goes into the last fragment.
 * - Read-modify-write: the change is unioned into the newest copy of that
 *   fragment, and a fragment never read is refused rather than rebuilt.
 * - created_at goes strictly past the copy it replaces, whatever the clock says.
 * - The List's own unknown fields stay on fragment 0.
 */
export function planListWrite(
  base: { read: ReturnType<typeof readFragments> | null; confirmedEmpty?: boolean },
  change: ListChange,
  /** `maxBytes`: plaintext budget per fragment, well inside the 64 KiB event ceiling. */
  opts: { nowSec: number; maxBytes?: number },
): WritePlan {
  const id = "upsert" in change ? change.upsert.community_id : change.tombstone.community_id;
  const read = base.read;
  if (!read || read.byIndex.size === 0) {
    if (!base.confirmedEmpty) return { ok: false, reason: "not-loaded" };
    return { ok: true, writes: [{ index: 0, createdAt: opts.nowSec, payload: rewrite({ frags: 1, entries: [], tombstones: [] }, change, 1, {}) }] };
  }

  const sorted = [...read.byIndex].sort((a, b) => a[0] - b[0]);
  const holder = sorted.find(([, f]) => holds(f.payload, id))?.[0];
  const target = holder ?? Math.max(read.frags, 1) - 1;
  const copy = read.byIndex.get(target);
  if (!copy) return { ok: false, reason: "incomplete" };

  const frags = Math.max(read.frags, target + 1);
  const payload = rewrite(copy.payload, change, frags, target === 0 ? read.extra : {});

  // The ceiling (CORD-02 §8): "MUST start a new fragment rather than exceed
  // it." Only a NEW membership grows a fragment past it; a leave "strictly
  // shrinks a fragment" and is exempt, and so is an update in place. Starting
  // a fragment changes `frags`, a repack, which "MUST NOT proceed without the
  // complete List".
  const grows = "upsert" in change && holder === undefined;
  if (grows && byteLength(payload) > (opts.maxBytes ?? MAX_FRAGMENT_BYTES)) {
    if (!read.complete) return { ok: false, reason: "incomplete" };
    const next = read.frags;
    const prior = read.byIndex.get(next); // a fragment beyond the count we still hold, if any
    return {
      ok: true,
      writes: [{
        index: next,
        createdAt: Math.max(opts.nowSec, (prior?.createdAt ?? 0) + 1),
        payload: rewrite(prior?.payload ?? { frags: next + 1, entries: [], tombstones: [] }, change, next + 1, {}),
      }],
    };
  }

  return { ok: true, writes: [{ index: target, createdAt: Math.max(opts.nowSec, copy.createdAt + 1), payload }] };
}

export type ChangesPlan = {
  writes: PlannedWrite[];
  /** Changes that could not be written this time; the next sync owes them again. */
  refused: { change: ListChange; reason: "not-loaded" | "incomplete" }[];
};

/**
 * Plan every change a sync owes the List, as one write per fragment. Each
 * change is planned by planListWrite on top of the fragments the changes before
 * it produced, so every guard still applies to every change. A refused change
 * (a join that needs a fragment we never read) doesn't hold back the rest: a
 * leave in a fragment we have still goes out.
 */
export function planListChanges(
  base: { read: ReturnType<typeof readFragments> | null; confirmedEmpty?: boolean },
  changes: ListChange[],
  opts: { nowSec: number; maxBytes?: number },
): ChangesPlan {
  const copies = new Map<number, ReadFragment>(base.read ? base.read.byIndex : []);
  const written = new Map<number, ListFragment>();
  const refused: ChangesPlan["refused"] = [];
  let read = base.read;
  for (const change of changes) {
    const plan = planListWrite({ read, confirmedEmpty: base.confirmedEmpty }, change, opts);
    if (!plan.ok) { refused.push({ change, reason: plan.reason }); continue; }
    for (const w of plan.writes) {
      written.set(w.index, w.payload);
      copies.set(w.index, { index: w.index, createdAt: w.createdAt, payload: w.payload });
    }
    read = readFragments([...copies.values()]);
  }
  // Each write's created_at is set once, past the copy it replaces as READ,
  // not past the intermediate plans above.
  const writes = [...written].sort((a, b) => a[0] - b[0]).map(([index, payload]) => {
    const prior = base.read?.byIndex.get(index);
    return { index, createdAt: prior ? Math.max(opts.nowSec, prior.createdAt + 1) : opts.nowSec, payload };
  });
  return { writes, refused };
}

/**
 * Plaintext budget per fragment. The event ceiling is 65,536 bytes after
 * NIP-44 (base64 of a padded plaintext) and signing, and the reference
 * implementation aims at 56 KiB; 40 KB of plaintext stays clear of both.
 */
export const MAX_FRAGMENT_BYTES = 40_000;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

// ── Taking up the List on this device ────────────────────────────────────────
const PRIOR_ROOTS_CAP = 24;

/**
 * What this device does with the List from the member's other devices (owner
 * calls, 2026-09-11):
 * - add: a group joined elsewhere appears here;
 * - remove: a group left anywhere is dropped here too, keys and all, unless
 *   it was re-joined after that leave, here or on another device;
 * - advance: a newer key version from another device is taken up, and the
 *   version this device leaves joins its prior roots, so history stays
 *   readable. What only this device keeps (edit cursors and the like) stays.
 * The List is the member's own, encrypted to themselves, so it is trusted.
 */
export function applyRemote(
  local: StoredCommunity[],
  remote: CommunityList,
): { add: StoredCommunity[]; remove: string[]; advance: StoredCommunity[] } {
  const byId = new Map(local.map((r) => [r.community_id, r]));
  const remove: string[] = [];
  const rejoinedAt = new Map(remote.entries.map((e) => [e.community_id, e.added_at]));
  for (const t of remote.tombstones) {
    const id = b64uToHex(t.community_id);
    const mine = byId.get(id);
    // A later re-join, here or on another device, outweighs the leave.
    const rejoined = (rejoinedAt.get(t.community_id) ?? -Infinity) > t.removed_at;
    if (mine && !rejoined && (mine.addedAt ?? 0) <= t.removed_at) remove.push(id);
  }
  const removed = new Set(remove);
  const add: StoredCommunity[] = [];
  const advance: StoredCommunity[] = [];
  for (const e of remote.entries) {
    const id = b64uToHex(e.community_id);
    if (removed.has(id)) continue;
    const theirs = recordFromEntry(e);
    const mine = byId.get(id);
    if (!mine) add.push(theirs);
    else if (theirs.root_epoch > mine.root_epoch) advance.push(advanceRecord(mine, theirs));
  }
  return { add, remove, advance };
}

export function advanceRecord(mine: StoredCommunity, theirs: StoredCommunity): StoredCommunity {
  const leaving = { root: mine.community_root, epoch: mine.root_epoch, ...(mine.control_pk ? { control_pk: mine.control_pk } : {}) };
  const priorRoots = [leaving, ...(mine.priorRoots ?? []), ...(theirs.priorRoots ?? [])]
    .filter((p, i, all) => p.epoch < theirs.root_epoch && all.findIndex((q) => q.epoch === p.epoch) === i)
    .sort((a, b) => a.epoch - b.epoch)
    .slice(-PRIOR_ROOTS_CAP);
  const theirRooms = new Map(theirs.channels.map((c) => [c.id, c]));
  // Only rooms this device already holds: seating rooms here is the
  // reconciler's and the grant path's job, not the backup's.
  const channels = mine.channels.map((c) => {
    const t = theirRooms.get(c.id);
    return t && t.epoch > c.epoch ? { ...c, ...(t.key ? { key: t.key } : {}), epoch: t.epoch } : c;
  });
  return {
    ...mine,
    community_root: theirs.community_root,
    root_epoch: theirs.root_epoch,
    control_pk: theirs.control_pk,
    // Their secret if they hold it; ours only while it is still this epoch's.
    control_root: theirs.control_root ?? (theirs.control_pk && theirs.control_pk === mine.control_pk ? mine.control_root : undefined),
    priorRoots,
    channels,
  };
}

// ── Catching the List up with this device ────────────────────────────────────
/**
 * The writes that bring the List in step with this device. Run AFTER
 * applyRemote, so the local set already reflects the List.
 *
 * - A membership is written only when merging this device's copy into the
 *   listed one would change it (a group only this device knows, a newer key
 *   version, a backfill seed), so a sync that finds everything in step
 *   publishes nothing. What other apps wrote on the listed copy rides along.
 * - `left` (hex id → when it was left, ms) becomes a leave, unless the List
 *   already records that leave or a later one.
 */
export function listChangesFor(local: StoredCommunity[], remote: CommunityList, left: Record<string, number>): ListChange[] {
  const listedById = new Map(remote.entries.map((e) => [e.community_id, e]));
  const leaveById = new Map(remote.tombstones.map((t) => [t.community_id, t]));
  const changes: ListChange[] = [];
  for (const r of local) {
    const id = hexToB64u(r.community_id);
    const listed = listedById.get(id);
    const mine: ListEntry = { community_id: id, current: joinMaterialOf(r, listed?.current), added_at: r.addedAt ?? 0 };
    const leave = leaveById.get(id);
    if (leave && leave.removed_at >= mine.added_at) continue; // left since; applyRemote drops it
    if (!listed || canonical(serializeEntry(mergeEntries(listed, mine))) !== canonical(serializeEntry(listed))) {
      changes.push({ upsert: mine });
    }
  }
  for (const [hexId, removedAt] of Object.entries(left)) {
    const id = hexToB64u(hexId);
    const listedLeave = leaveById.get(id);
    if (!listedLeave || listedLeave.removed_at < removedAt) changes.push({ tombstone: { community_id: id, removed_at: removedAt } });
  }
  return changes;
}
