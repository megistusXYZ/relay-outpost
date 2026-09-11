/**
 * Concord key store: the per-user vault of the symmetric key material for
 * every community they belong to.
 *
 * Two layers:
 *  - IndexedDB (`concord-keys` DB) — the local source of truth, namespaced by
 *    the signed-in user's pubkey (survives logout, like `dm-cache.ts`).
 *  - The Community List (CORD-02 §8, kind 33302) — the member's own groups,
 *    NIP-44 to themselves, on their relays: recovery and multi-device. A second
 *    browser (or a cache-cleared one) takes its keys up from it, and a group
 *    left on one device drops off the others. The rules are in
 *    community-list.ts, the sync in community-list-sync.ts; publishCommunityList
 *    below runs it after every change (the #1 risk is key loss).
 */
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";

// ── Stored shapes ─────────────────────────────────────────────────────────────
export interface StoredChannel {
  id: string;
  /** Private-channel secret (hex). Public channels omit it (key derives from community_root). */
  key?: string;
  epoch: number;
  name: string;
  isPrivate: boolean;
  /** Channel-edition (vsk-2) chain state so rename/delete publish version N+1. */
  edVersion?: number;
  edEid?: string;
  /**
   * Highest channel-edition version the RECONCILER has seen settle for this row.
   *
   * Deliberately separate from `edVersion`: that one is the PUBLISH cursor and is
   * paired with `edEid`, so raising it would name a parent from an edition this
   * device never published. This one only anchors reads — without it a replayed
   * v1 name overwrites v3, because `edVersion` is undefined for every row that
   * arrived by invite, by grant, or by being seated from the fold.
   */
  seenEdVersion?: number;
}

/** Everything a member needs to read/write a community. Keyed in IDB by [ownerPubkey, community_id]. */
export interface StoredCommunity {
  community_id: string;
  /** community owner x-only pubkey (NOT the local user). */
  owner: string;
  owner_salt: string;
  /** the community root secret (hex) — members hold it; public channels derive from it. */
  community_root: string;
  root_epoch: number;
  /**
   * The admin (Control) plane's address at root_epoch (CORD-02 §2/§5), hex.
   * From an invite, the Community List, or a base rekey blob. Absent = a legacy
   * group, whose admin plane is the concord/control address.
   */
  control_pk?: string;
  /** Staff only: the secret control_pk derives from (CORD-02 §2), hex. */
  control_root?: string;
  channels: StoredChannel[];
  relays: string[];
  name: string;
  icon?: string;
  about?: string;
  /** Community policy (mirrors folded metadata): members may create invites. */
  allowMemberInvites?: boolean;
  addedAt: number;
  /**
   * Client-side link (v1): if this community provides the encrypted channels for
   * a relay-backed outpost, the outpost's relay URL. Lets the relay community's
   * Chat tab surface Concord channels alongside its legacy NIP-29 rooms. Not on
   * the wire — a local convenience only.
   */
  relayUrl?: string;
  /**
   * Latest published metadata (vsk-0) edition version + its computed edition id,
   * so an edit can publish version N+1 with a correct `ep` chain link (the owner
   * is the sole metadata editor, so local tracking is authoritative).
   */
  metaVersion?: number;
  metaEid?: string;
  /** Whether the built-in Admin role edition has been published (publish once). */
  adminRolePublished?: boolean;
  /** Per-member grant (vsk-3) chain state so admin toggles publish version N+1. */
  grantVersions?: Record<string, { version: number; eid: string }>;
  /**
   * Banlist (vsk-4) chain state — a FLOOR, not the authority. Unlike metadata,
   * the banlist is multi-writer (any PERM.BAN holder publishes it), so the live
   * fold's head wins whenever it is ahead; see FoldedState.heads.
   *
   * `banSnapshot` is the exact payload last published from this device, and it
   * is load-bearing rather than bookkeeping: banning calls onCommunityChange,
   * which re-runs useConcordGovernance's subscribe effect and clears the fold,
   * so a second ban moments later reads an EMPTY banlist. Publishing that at a
   * higher version would delete the first ban outright. The snapshot is what the
   * next payload is unioned with.
   */
  banVersion?: number;
  banEid?: string;
  banSnapshot?: string[];
  /**
   * Prior base keys this member HELD before each base rotation (CORD-06),
   * oldest → newest. Kept so the control/guestbook/public-channel planes of
   * earlier epochs stay readable after a rekey (CORD-03 §3: clients query
   * "every epoch pubkey they hold") — without this, one removal-rekey makes the
   * whole governance history (roster joins, audit log) undecryptable and the
   * members list collapses to just the owner. Local state (the Community List
   * carries only the earliest root, as its seed),
   * never on the community wire.
   */
  priorRoots?: { root: string; epoch: number; control_pk?: string }[];
  /**
   * Channel ids the reconciler has retracted — the fold positively called them
   * private while this device held no key, so the row was a phantom seated off a
   * rename that dropped the flag. Sticky, so replaying that same broken edition
   * later cannot re-seat what a correction already removed. Local + backup only,
   * never on the community wire.
   */
  retractedChannels?: string[];
}

/** Cap on retained prior base keys (bounds the governance-plane author list). */
export const PRIOR_ROOTS_CAP = 24;

/**
 * Pure adoption of a base rotation (rotator or receiver side): remember the
 * key we currently hold as a prior root, then move to the new (key, epoch).
 * Dedupes by epoch and keeps the newest PRIOR_ROOTS_CAP entries. No-op if the
 * record is already at (or past) the new epoch — adoption is idempotent.
 */
export function adoptBaseRekey(
  c: StoredCommunity,
  newRootHex: string,
  newEpoch: number,
  /** The new epoch's admin address (and, for staff, its secret) from the rekey
   *  blob. Absent = a legacy rotation: the new epoch has no split address. */
  control: { controlPk?: string; controlRoot?: string } = {},
): StoredCommunity {
  if (newEpoch <= c.root_epoch) return c;
  // The epoch we leave keeps its admin address, so its plane stays readable.
  const leaving = { root: c.community_root, epoch: c.root_epoch, ...(c.control_pk ? { control_pk: c.control_pk } : {}) };
  const prior = [...(c.priorRoots ?? []).filter((p) => p.epoch !== c.root_epoch), leaving]
    .sort((a, b) => a.epoch - b.epoch)
    .slice(-PRIOR_ROOTS_CAP);
  return {
    ...c, community_root: newRootHex, root_epoch: newEpoch, priorRoots: prior,
    control_pk: control.controlPk, control_root: control.controlRoot,
  };
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────
const DB_NAME = "concord-keys";
const DB_VERSION = 4;
const COMMUNITIES_STORE = "communities";
const STREAMS_STORE = "processed_streams"; // dedupe ledger for concord-stream.ts
const INVITES_STORE = "invite_signers"; // link_signer secrets for revocation (CORD-05)
const MESSAGES_STORE = "messages"; // decoded chat-message cache (survives remount/reload)
const REACTIONS_STORE = "reactions"; // decoded reaction cache (same reason as messages)

/** A minted invite link's one-use signer — kept so it can be revoked later. */
export interface StoredInviteSigner {
  communityId: string;
  linkSignerPubkey: string;
  linkSignerSecret: string; // hex
  token: string; // hex (16 bytes)
  label?: string;
  createdAt: number;
  revoked?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbFailed = false;

function openDB(): Promise<IDBDatabase> {
  if (dbFailed) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => { dbFailed = true; dbPromise = null; reject(request.error); };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(COMMUNITIES_STORE)) {
          const s = db.createObjectStore(COMMUNITIES_STORE, { keyPath: ["ownerPubkey", "community_id"] });
          s.createIndex("by-owner", "ownerPubkey", { unique: false });
        }
        if (!db.objectStoreNames.contains(STREAMS_STORE)) {
          db.createObjectStore(STREAMS_STORE, { keyPath: ["ownerPubkey", "wrapId"] });
        }
        if (!db.objectStoreNames.contains(INVITES_STORE)) {
          const s = db.createObjectStore(INVITES_STORE, { keyPath: ["ownerPubkey", "linkSignerPubkey"] });
          s.createIndex("by-community", ["ownerPubkey", "communityId"], { unique: false });
        }
        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const s = db.createObjectStore(MESSAGES_STORE, { keyPath: ["ownerPubkey", "id"] });
          s.createIndex("by-channel", ["ownerPubkey", "communityId", "channelId"], { unique: false });
        }
        if (!db.objectStoreNames.contains(REACTIONS_STORE)) {
          const s = db.createObjectStore(REACTIONS_STORE, { keyPath: ["ownerPubkey", "id"] });
          s.createIndex("by-channel", ["ownerPubkey", "communityId", "channelId"], { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onclose = () => { dbPromise = null; }; // iOS force-close reset
        resolve(request.result);
      };
    } catch { dbFailed = true; dbPromise = null; reject(new Error("IndexedDB unavailable")); }
  });
  return dbPromise;
}

export async function getCommunities(ownerPubkey: string): Promise<StoredCommunity[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(COMMUNITIES_STORE, "readonly");
      const req = tx.objectStore(COMMUNITIES_STORE).index("by-owner").getAll(ownerPubkey);
      req.onsuccess = () => resolve(((req.result || []) as (StoredCommunity & { ownerPubkey: string })[]).map(stripOwner));
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

/** The community (if any) linked to a relay-backed outpost's relay URL. */
export async function getCommunityForRelay(ownerPubkey: string, relayUrl: string): Promise<StoredCommunity | null> {
  const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  const target = norm(relayUrl);
  const all = await getCommunities(ownerPubkey);
  return all.find((c) => c.relayUrl && norm(c.relayUrl) === target) ?? null;
}

export async function getCommunity(ownerPubkey: string, communityId: string): Promise<StoredCommunity | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(COMMUNITIES_STORE, "readonly");
      const req = tx.objectStore(COMMUNITIES_STORE).get([ownerPubkey, communityId]);
      req.onsuccess = () => resolve(req.result ? stripOwner(req.result) : null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function putCommunity(ownerPubkey: string, record: StoredCommunity): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMMUNITIES_STORE, "readwrite");
      tx.objectStore(COMMUNITIES_STORE).put({ ...record, ownerPubkey });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* best-effort */ }
}

/**
 * Read-modify-write a stored community INSIDE one transaction.
 *
 * `putCommunity` is a whole-row `put` of a caller-held object, and every caller's
 * object is a React snapshot refreshed only by a `window` event — which does not
 * cross tabs. So a background writer meaning to change ONE field silently
 * reverts every field another writer has changed since that snapshot was taken,
 * named or not. No field allowlist can reach this; the stomp happens above it.
 * Its highest-value victims are `community_root`, `priorRoots` and a private
 * channel's `key`, none of which have a second copy anywhere.
 *
 * `mutate` MUST be synchronous — an IDB transaction closes at the end of the
 * turn, so an `await` inside it loses the write. It is handed the row as it
 * exists NOW, so a stale snapshot cannot participate at all.
 *
 * Returns false when the row is gone — a `put` there would RESURRECT a community
 * the user just left, keys and all — or when `mutate` declines by returning null.
 */
export async function updateCommunity(
  ownerPubkey: string,
  communityId: string,
  mutate: (row: StoredCommunity) => Partial<StoredCommunity> | null,
): Promise<boolean> {
  try {
    const db = await openDB();
    return await new Promise<boolean>((resolve) => {
      let wrote = false;
      const tx = db.transaction(COMMUNITIES_STORE, "readwrite");
      const store = tx.objectStore(COMMUNITIES_STORE);
      const req = store.get([ownerPubkey, communityId]);
      req.onsuccess = () => {
        const row = req.result as (StoredCommunity & { ownerPubkey: string }) | undefined;
        if (!row) return;                        // deleted under us — never recreate
        let patch: Partial<StoredCommunity> | null = null;
        try { patch = mutate(stripOwner(row)); } catch { return; }
        if (!patch || Object.keys(patch).length === 0) return;
        store.put({ ...row, ...patch });         // `row`, never the caller's snapshot
        wrote = true;
      };
      req.onerror = () => resolve(false);
      tx.oncomplete = () => resolve(wrote);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch { return false; }
}

export async function deleteCommunity(ownerPubkey: string, communityId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(COMMUNITIES_STORE, "readwrite");
      tx.objectStore(COMMUNITIES_STORE).delete([ownerPubkey, communityId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

/** Clear a user's Concord keys (wired to "clear local data"). */
export async function wipeConcordKeys(ownerPubkey: string): Promise<void> {
  const list = await getCommunities(ownerPubkey);
  await Promise.all(list.map((c) => deleteCommunity(ownerPubkey, c.community_id)));
}

// Stream-dedupe ledger (used by concord-stream.ts).
export async function isStreamProcessed(ownerPubkey: string, wrapId: string): Promise<boolean> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STREAMS_STORE, "readonly");
      const req = tx.objectStore(STREAMS_STORE).get([ownerPubkey, wrapId]);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch { return false; }
}
export async function markStreamProcessed(ownerPubkey: string, wrapId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STREAMS_STORE, "readwrite");
      tx.objectStore(STREAMS_STORE).put({ ownerPubkey, wrapId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

function stripOwner(rec: StoredCommunity & { ownerPubkey?: string }): StoredCommunity {
  const { ownerPubkey: _o, ...rest } = rec;
  return rest;
}

// ── Decoded chat-message cache ────────────────────────────────────────────────
// Concord messages live only in the Chat tab's memory + are gated by the
// processed-streams ledger, so a tab switch (unmount) loses them and the ledger
// blocks re-fetch. This cache is the durable display source: decoded messages
// persist across remount/reload; the live subscription only appends new ones.
export interface CachedMessage {
  id: string; pubkey: string; content: string; t: number; media?: import("./concord-media").ConcordMedia[];
  /** The message this one answers: the quoted one, or a threaded reply's parent. */
  replyTo?: { id: string; pubkey: string };
  /** A threaded reply's root (concord-replies), and its id for grouping. */
  root?: { id: string; pubkey: string; kind: number };
  rootId?: string;
  /** 9 for a message, 1111 for a threaded reply: reactions, edits and deletes name it. */
  kind?: number;
  edited?: boolean; deleted?: boolean; mentions?: string[];
}

/**
 * A cached row as a message: every field it was stored with except the storage
 * keys. The reader used to copy an allowlist that left out the thread, so after
 * a reload every thread reply came back in the room.
 */
export function messageFromCacheRow(row: CachedMessage & { ownerPubkey?: string; communityId?: string; channelId?: string }): CachedMessage {
  const { ownerPubkey: _owner, communityId: _community, channelId: _channel, ...msg } = row;
  return msg;
}
const MESSAGE_CACHE_CAP = 1000;

export async function cacheMessage(ownerPubkey: string, communityId: string, channelId: string, msg: CachedMessage): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MESSAGES_STORE, "readwrite");
      tx.objectStore(MESSAGES_STORE).put({ ownerPubkey, communityId, channelId, ...msg });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

export async function getCachedMessages(ownerPubkey: string, communityId: string, channelId: string): Promise<CachedMessage[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const req = tx.objectStore(MESSAGES_STORE).index("by-channel").getAll([ownerPubkey, communityId, channelId]);
      req.onsuccess = () => {
        const rows = (req.result || []) as (CachedMessage & { ownerPubkey: string })[];
        const msgs = rows.map(messageFromCacheRow).sort((a, b) => a.t - b.t);
        resolve(msgs.slice(-MESSAGE_CACHE_CAP));
      };
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

// ── Reaction cache (mirrors messages; deletes remove by id) ──────────────────
export interface CachedReaction { id: string; pubkey: string; targetId: string; emoji: string; emojiUrl?: string; t: number }

export async function cacheReaction(ownerPubkey: string, communityId: string, channelId: string, r: CachedReaction): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(REACTIONS_STORE, "readwrite");
      tx.objectStore(REACTIONS_STORE).put({ ownerPubkey, communityId, channelId, ...r });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

export async function removeCachedReaction(ownerPubkey: string, id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(REACTIONS_STORE, "readwrite");
      tx.objectStore(REACTIONS_STORE).delete([ownerPubkey, id]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

export async function getCachedReactions(ownerPubkey: string, communityId: string, channelId: string): Promise<CachedReaction[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(REACTIONS_STORE, "readonly");
      const req = tx.objectStore(REACTIONS_STORE).index("by-channel").getAll([ownerPubkey, communityId, channelId]);
      req.onsuccess = () => {
        const rows = (req.result || []) as (CachedReaction & { ownerPubkey: string })[];
        resolve(rows.map(({ id, pubkey, targetId, emoji, emojiUrl, t }) => ({ id, pubkey, targetId, emoji, emojiUrl, t })));
      };
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

// Invite-signer store (CORD-05 revocation bookkeeping).
export async function putInviteSigner(ownerPubkey: string, rec: StoredInviteSigner): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(INVITES_STORE, "readwrite");
      tx.objectStore(INVITES_STORE).put({ ...rec, ownerPubkey });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}
export async function getInviteSigners(ownerPubkey: string, communityId: string): Promise<StoredInviteSigner[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(INVITES_STORE, "readonly");
      const req = tx.objectStore(INVITES_STORE).index("by-community").getAll([ownerPubkey, communityId]);
      req.onsuccess = () => resolve((req.result || []).map((r: any) => { const { ownerPubkey: _o, ...rest } = r; return rest as StoredInviteSigner; }));
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

// ── The Community List (kind 33302) ──────────────────────────────────────────
type CommunityListSync = (signer: ISigner, ownerPubkey: string) => Promise<unknown>;
let communityListSync: CommunityListSync | null = null;

/**
 * The app registers the relay-backed sync at startup (main.tsx,
 * community-list-live.ts). Until then, and in tests, publishing the List does
 * nothing: this module never builds a List from its own records, which is how
 * the retired kind-13302 backup could erase groups held only elsewhere.
 */
export function registerCommunityListSync(sync: CommunityListSync): void {
  communityListSync = sync;
}

/**
 * Bring your Community List in step with this device, so a join, a key change
 * or a leave here reaches your other devices. It reads before it writes, and
 * writes only what the List lacks (community-list-sync.ts). `_publish` served
 * the retired backup, whose relays varied by caller; the List now goes to the
 * relays it is read from.
 */
export async function publishCommunityList(
  signer: ISigner,
  ownerPubkey: string,
  _publish?: (event: Event) => Promise<unknown>,
): Promise<void> {
  await communityListSync?.(signer, ownerPubkey);
}
