/**
 * Keeping the Community List (CORD-02 §8, kind 33302) and this device in step:
 * read the List, take up what your other devices changed, then write only what
 * this device owes it. community-list.ts holds the rules; this is the I/O
 * around them. The relays, the key store and the device's own memory are passed
 * in, so two devices can be run against one relay in a test.
 *
 * - Nothing is written unless a relay ANSWERED, and never from this device's
 *   groups alone unless a relay answered with no List at all and this device
 *   has never seen one. An empty replaceable event is a delete; so is a List
 *   rebuilt from a partial view (RELAY_REACHABILITY.md).
 * - The retired kind 13302 is read, never written: its groups move into 33302.
 * - A group left here stays gone, even before that leave reaches the List.
 */
import type { Event, Filter } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import type { StoredCommunity } from "./concord-keys";
import { KIND_COMMUNITY_LIST, KIND_LEGACY_COMMUNITY_LIST } from "./concord-events";
import {
  readFragments, mergeLists, applyRemote, listChangesFor, planListChanges, entryFromLegacy, hexToB64u,
  type CommunityList, type ListEntry, type ListTombstone, type ReadFragment,
} from "./community-list";

/** CORD-02 §8: a signed fragment event may not exceed this. */
export const MAX_LIST_EVENT_BYTES = 65_536;

export type ListRelays = {
  /**
   * `answered`: at least one relay really answered. It must have CONNECTED:
   * nostr-tools fires an EOSE for a relay that failed to connect, and that is
   * not an answer. `allAnswered`: every relay the List lives on did, the only
   * licence to conclude that no List exists.
   */
  fetch(filter: Filter): Promise<{ events: Event[]; answered: boolean; allAnswered: boolean }>;
  publish(event: Event): Promise<unknown>;
};
export type ListStore = {
  all(): Promise<StoredCommunity[]>;
  add(record: StoredCommunity): Promise<void>;
  remove(communityId: string): Promise<void>;
  /** A newer key version from another device, applied to the row as it is now. */
  advance(record: StoredCommunity): Promise<void>;
};
export type ListMemory = {
  /** Groups left on this device: hex id → when, in ms. */
  left(): Record<string, number>;
  /** Whether this device has ever read or written a List for this account. */
  seen(): boolean;
  markSeen(): void;
};
export type ListSyncResult =
  | { status: "unreachable" | "no-encryption" }
  | { status: "synced"; changedHere: boolean; written: number; waiting: number };

type Me = { signer: ISigner; pubkey: string };

const EMPTY: CommunityList = { entries: [], tombstones: [] };
const HEX32 = /^[0-9a-f]{64}$/;
const isB64u = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

// ── Reading what another app may have written ────────────────────────────────
/** Join material is kept only when it can become keys; anything else is dropped. */
function isSnapshot(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  return isB64u(o.owner) && isB64u(o.owner_salt) && isB64u(o.community_root) && isCount(o.root_epoch)
    && (o.control_pk === undefined || isB64u(o.control_pk))
    && (o.control_root === undefined || isB64u(o.control_root))
    && typeof o.name === "string"
    && Array.isArray(o.relays) && o.relays.every((r) => typeof r === "string")
    && Array.isArray(o.channels) && o.channels.every((c) => !!c && typeof c === "object"
      && isB64u(c.id) && isCount(c.epoch) && typeof c.name === "string" && (c.key === undefined || isB64u(c.key)));
}

function cleanEntry(e: unknown): ListEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as ListEntry;
  if (!isB64u(o.community_id) || !isSnapshot(o.current) || !Number.isFinite(o.added_at)) return null;
  if (o.seed !== undefined && !isSnapshot(o.seed)) {
    const { seed: _unusable, ...rest } = o;
    return rest as ListEntry;
  }
  return o;
}

const isTombstone = (t: unknown): t is ListTombstone =>
  !!t && typeof t === "object" && isB64u((t as ListTombstone).community_id) && Number.isFinite((t as ListTombstone).removed_at);

/** A fragment we can't open or parse is left out, so it reads as unseen, never as empty. */
async function openFragment(me: Me, e: Event): Promise<ReadFragment | null> {
  const d = e.tags.find((t) => t[0] === "d")?.[1];
  if (d === undefined || !/^(0|[1-9][0-9]{0,3})$/.test(d)) return null;
  try {
    const p = JSON.parse(await me.signer.nip44!.decrypt(me.pubkey, e.content));
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const entries = (Array.isArray(p.entries) ? p.entries : []).map(cleanEntry).filter((x: ListEntry | null): x is ListEntry => x !== null);
    const tombstones = (Array.isArray(p.tombstones) ? p.tombstones : []).filter(isTombstone);
    return { index: Number(d), createdAt: e.created_at, payload: { ...p, entries, tombstones } };
  } catch { return null; }
}

/** The retired backup: whole records in hex, and it never recorded a leave. */
async function openLegacy(me: Me, events: Event[]): Promise<CommunityList> {
  const newest = events.filter((e) => e.kind === KIND_LEGACY_COMMUNITY_LIST).sort((a, b) => b.created_at - a.created_at)[0];
  if (!newest) return EMPTY;
  try {
    const p = JSON.parse(await me.signer.nip44!.decrypt(me.pubkey, newest.content));
    const entries = (Array.isArray(p?.entries) ? p.entries : []).flatMap((x: unknown) => {
      const o = x as { community_id?: unknown; current?: unknown };
      if (!o || typeof o.community_id !== "string" || !HEX32.test(o.community_id) || !o.current) return [];
      try {
        const entry = cleanEntry(entryFromLegacy(o as Parameters<typeof entryFromLegacy>[0]));
        return entry ? [entry] : [];
      } catch { return []; }
    });
    return { entries, tombstones: [] };
  } catch { return EMPTY; }
}

// ── The sync ─────────────────────────────────────────────────────────────────
export async function syncList(me: Me, relays: ListRelays, store: ListStore, memory: ListMemory, nowMs = Date.now()): Promise<ListSyncResult> {
  if (!me.signer.nip44) return { status: "no-encryption" };
  const { events, answered, allAnswered } = await relays.fetch({ kinds: [KIND_COMMUNITY_LIST, KIND_LEGACY_COMMUNITY_LIST], authors: [me.pubkey] });
  if (!answered) return { status: "unreachable" };

  const mine = events.filter((e) => e.pubkey === me.pubkey);
  const fragmentEvents = mine.filter((e) => e.kind === KIND_COMMUNITY_LIST);
  const fragments = (await Promise.all(fragmentEvents.map((e) => openFragment(me, e)))).filter((f): f is ReadFragment => f !== null);
  const read = fragments.length > 0 ? readFragments(fragments) : null;
  // "No List exists" takes an answer from EVERY relay the List lives on, and no
  // memory of one here. One relay answering empty while the one holding your
  // List is down is not that answer; nor is a List this device has seen coming
  // back missing. Writing then would start the List over and mask the real one.
  const confirmedEmpty = allAnswered && fragmentEvents.length === 0 && !memory.seen();
  if (fragmentEvents.length > 0) memory.markSeen();

  const left = Object.fromEntries(Object.entries(memory.left()).filter(([id, at]) => HEX32.test(id) && Number.isFinite(at)));
  const leftHere = Object.entries(left).map(([id, at]) => ({ community_id: hexToB64u(id), removed_at: at }));
  const listed = read?.list ?? EMPTY;

  // Take up the List, and the old backup, with this device's own leaves on top:
  // a leave that hasn't reached the List yet must not be undone by it.
  const legacy = await openLegacy(me, mine);
  const { add, remove, advance } = applyRemote(await store.all(), mergeLists(mergeLists(listed, legacy), { entries: [], tombstones: leftHere }));
  for (const r of add) await store.add(r);
  for (const id of remove) await store.remove(id);
  for (const r of advance) await store.advance(r);

  // Then write what the List still lacks from here, including old-backup groups.
  const changes = listChangesFor(await store.all(), listed, left);
  const plan = planListChanges({ read, confirmedEmpty }, changes, { nowSec: Math.floor(nowMs / 1000) });
  let written = 0;
  let waiting = plan.refused.length;
  for (const w of plan.writes) {
    try {
      const content = await me.signer.nip44.encrypt(me.pubkey, JSON.stringify(w.payload));
      const signed = await me.signer.signEvent({ kind: KIND_COMMUNITY_LIST, created_at: w.createdAt, tags: [["d", String(w.index)]], content }) as Event;
      if (new TextEncoder().encode(JSON.stringify(signed)).length > MAX_LIST_EVENT_BYTES) { waiting++; continue; }
      await relays.publish(signed);
      written++;
    } catch { waiting++; }
  }
  if (written > 0) memory.markSeen();
  return { status: "synced", changedHere: add.length + remove.length + advance.length > 0, written, waiting };
}
