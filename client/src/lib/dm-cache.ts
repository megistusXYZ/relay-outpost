import { isExpired, newerSubject } from "@/lib/dm-room";
import {
  canSeal, newDeviceKey, sealRow, openRow, isSealedRow,
  MESSAGE_SECRETS, MESSAGE_BOUND, CONVERSATION_SECRETS, CONVERSATION_BOUND,
} from "@/lib/dm-seal";
import { clearCursors } from "@/lib/dm-history";

const DB_NAME = "relay-outpost-dms";
const DB_VERSION = 2;
// The device keys have a database of their own. Adding a store to the one
// above would mean a version upgrade, and an upgrade waits for every other tab
// still running the previous build to close — private messages would hang in
// the updated tab until then.
const KEYS_DB_NAME = "relay-outpost-dm-keys";
const DEVICE_KEYS_STORE = "device_keys";
const MESSAGES_STORE = "messages";
const CONVERSATIONS_STORE = "conversations";
const PROCESSED_WRAPS_STORE = "processed_wraps";

// Outcome of attempting to unwrap a NIP-17 gift wrap. Persisting this lets us
// decrypt each wrap at most once, ever — the core of the "decrypt-once" ledger
// that cuts repeat signer prompts for paranoid (NIP-46) signers.
export type WrapStatus = "decrypted" | "failed" | "foreign";

export interface ProcessedWrap {
  ownerPubkey: string;
  wrapId: string;
  status: WrapStatus;
  ts: number;
}

export interface CachedFileMetadata {
  url: string;
  mimeType?: string;
  size?: number;
  dim?: string;
  blurhash?: string;
  originalHash?: string;
  /** NIP-17 kind-15 encryption (hex) — present ⇒ the blob at `url` is AES-GCM
   *  ciphertext and must be decrypted before display. Absent for legacy/plaintext. */
  encAlgo?: string;
  encKey?: string;
  encNonce?: string;
}

export interface CachedMessage {
  id: string;
  ownerPubkey: string;
  /** The chat this message is filed in (lib/dm-room.ts): the other person's
   *  public key for a one-to-one chat — what it has always been — or a group
   *  key for a chat with several people. The field keeps its old name because
   *  it is the IndexedDB index. */
  peerPubkey: string;
  content: string;
  from: string;
  timestamp: number;
  encryption: "nip04" | "nip44" | "nip17";
  fileMetadata?: CachedFileMetadata;
  /** Private reply: the public note id this DM quotes (from the rumor's `q` tag). */
  quotedNoteId?: string;
  /** A disappearing message: when it stops being shown (unix seconds). It is
   *  not stored once that has passed, and is deleted when next read after. */
  expiresAt?: number;
  /** The chat message this one answers (lib/dm-thread.ts). */
  replyTo?: string;
  /** Set on a REACTION: the message it reacts to. `content` is then the emoji.
   *  Reactions are kept beside the chat's messages and never returned as one
   *  (getMessages leaves them out; getReactions returns them). */
  reactsTo?: string;
}

export interface CachedConversation {
  ownerPubkey: string;
  /** The chat's key — see CachedMessage.peerPubkey. */
  peerPubkey: string;
  lastMessage: string;
  lastTimestamp: number;
  /** The chat's name, when a message has set one (NIP-17 `subject`), and the
   *  time of the message that set it: the newest wins. */
  subject?: string;
  subjectAt?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let dbFailed = false;

function openDB(): Promise<IDBDatabase> {
  if (dbFailed) return Promise.reject(new Error("IndexedDB unavailable"));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        dbFailed = true;
        dbPromise = null;
        reject(request.error);
      };

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
          const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: ["ownerPubkey", "id"] });
          msgStore.createIndex("by-peer", ["ownerPubkey", "peerPubkey"], { unique: false });
          msgStore.createIndex("by-peer-time", ["ownerPubkey", "peerPubkey", "timestamp"], { unique: false });
        }

        if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
          const convStore = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: ["ownerPubkey", "peerPubkey"] });
          convStore.createIndex("by-owner", "ownerPubkey", { unique: false });
        }

        if (!db.objectStoreNames.contains(PROCESSED_WRAPS_STORE)) {
          const wrapStore = db.createObjectStore(PROCESSED_WRAPS_STORE, { keyPath: ["ownerPubkey", "wrapId"] });
          wrapStore.createIndex("by-owner", "ownerPubkey", { unique: false });
        }
      };

      request.onsuccess = () => {
        // iOS force-closes IDB when the tab backgrounds; without this reset a
        // later transaction on the stale handle throws "connection is closing"
        // (live crash report, /messages). Same guard indexeddb-cache carries.
        request.result.onclose = () => { dbPromise = null; };
        resolve(request.result);
      };
    } catch {
      dbFailed = true;
      dbPromise = null;
      reject(new Error("IndexedDB unavailable"));
    }
  });

  return dbPromise;
}

function safeTx(mode: IDBTransactionMode, storeName: string, fn: (store: IDBObjectStore) => IDBRequest): Promise<any> {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      let result: any;
      req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }).catch(() => undefined);
}

// ---- Sealing (lib/dm-seal.ts) -------------------------------------------------
//
// Every message and chat row is sealed with a key that belongs to this device
// and this account. The key is kept beside the rows as a CryptoKey the browser
// will use but never hand over. Rows written before sealing existed are read as
// they are and sealed the first time the store is opened after the update.

const deviceKeys = new Map<string, Promise<CryptoKey | null>>();

function openKeysDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEYS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_KEYS_STORE)) {
        request.result.createObjectStore(DEVICE_KEYS_STORE, { keyPath: "ownerPubkey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** This account's key on this device, made on first use. Null where the
 *  browser cannot seal (an insecure origin): rows are then kept as before. */
function deviceKey(ownerPubkey: string): Promise<CryptoKey | null> {
  const known = deviceKeys.get(ownerPubkey);
  if (known) return known;
  const made = (async () => {
    if (!canSeal()) return null;
    try {
      const fresh = await newDeviceKey();
      const db = await openKeysDB();
      // One transaction decides: a second tab that got here first wins, and
      // both end up holding the same key.
      return await new Promise<CryptoKey | null>((resolve, reject) => {
        const tx = db.transaction(DEVICE_KEYS_STORE, "readwrite");
        const store = tx.objectStore(DEVICE_KEYS_STORE);
        let key: CryptoKey = fresh;
        let created = false;
        const get = store.get(ownerPubkey);
        get.onsuccess = () => {
          const row = get.result as { key?: CryptoKey } | undefined;
          if (row?.key) key = row.key;
          else { created = true; store.put({ ownerPubkey, key: fresh }); }
        };
        tx.oncomplete = () => {
          db.close();
          // A key had to be made, yet sealed rows are already here: they were
          // sealed with a key this device no longer has. Start over BEFORE
          // anyone reads the store, so nothing is built on rows that cannot open.
          if (!created) { resolve(key); return; }
          void hasSealedRows(ownerPubkey)
            .then((lost) => (lost ? startOver(ownerPubkey) : undefined))
            .catch(() => {})
            .then(() => resolve(key));
        };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("Transaction aborted")); };
      });
    } catch {
      return null;
    }
  })();
  deviceKeys.set(ownerPubkey, made);
  // A failure is not remembered: the next call tries again.
  void made.then((k) => { if (!k && deviceKeys.get(ownerPubkey) === made) deviceKeys.delete(ownerPubkey); });
  return made;
}

async function forgetDeviceKey(ownerPubkey: string): Promise<void> {
  deviceKeys.delete(ownerPubkey);
  try {
    const db = await openKeysDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DEVICE_KEYS_STORE, "readwrite");
      tx.objectStore(DEVICE_KEYS_STORE).delete(ownerPubkey);
      tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    });
  } catch {}
}

async function sealMessage(key: CryptoKey | null, row: CachedMessage): Promise<unknown> {
  return key ? sealRow(key, row, MESSAGE_SECRETS, MESSAGE_BOUND) : row;
}

async function sealConversation(key: CryptoKey | null, row: CachedConversation): Promise<unknown> {
  return key ? sealRow(key, row, CONVERSATION_SECRETS, CONVERSATION_BOUND) : row;
}

/** Rows as they were written, and how many would not open. */
async function openRows<T extends object>(key: CryptoKey | null, stored: unknown[], boundTo: readonly string[]): Promise<{ rows: T[]; unreadable: number; legacy: T[] }> {
  const rows: T[] = [];
  const legacy: T[] = [];
  let unreadable = 0;
  const opened = await Promise.all(stored.map(async (row) => {
    if (!isSealedRow(row)) return { row: row as T, legacy: true, locked: false };
    // No key to hand right now (its database would not open): the row is left
    // alone. Only a key that is present and does not fit means the row is lost.
    if (!key) return { row: null, legacy: false, locked: true };
    return { row: await openRow<T>(key, row, boundTo), legacy: false, locked: false };
  }));
  for (const o of opened) {
    if (o.locked) continue;
    if (!o.row) { unreadable++; continue; }
    rows.push(o.row);
    if (o.legacy) legacy.push(o.row);
  }
  return { rows, unreadable, legacy };
}

async function hasSealedRows(ownerPubkey: string): Promise<boolean> {
  const db = await openDB();
  const chats = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
    const req = tx.objectStore(CONVERSATIONS_STORE).index("by-owner").getAll(ownerPubkey);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return chats.some(isSealedRow);
}

const resetListeners = new Set<(ownerPubkey: string) => void>();

/** Told when an account's store has been emptied to start over, so anything
 *  remembered from it in memory (which messages were already opened) goes too. */
export function onStoreReset(fn: (ownerPubkey: string) => void): void {
  resetListeners.add(fn);
}

/**
 * Rows this device can no longer open (its key is gone while the rows stayed).
 * They cannot be shown, and the record of which messages were already opened
 * would stop them ever being fetched again — so the account's store starts
 * over and the messages are read from the relays afresh.
 */
async function startOver(ownerPubkey: string): Promise<void> {
  await clearAll(ownerPubkey, { keepKey: true });
  clearCursors(ownerPubkey);
  resetListeners.forEach((fn) => { try { fn(ownerPubkey); } catch {} });
}

const sweptLegacy = new Set<string>();

/** Seal everything this account stored before sealing existed. Once a session. */
async function sealLegacyRows(ownerPubkey: string): Promise<void> {
  if (sweptLegacy.has(ownerPubkey)) return;
  sweptLegacy.add(ownerPubkey);
  try {
    const key = await deviceKey(ownerPubkey);
    if (!key) return;
    const db = await openDB();
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const req = tx.objectStore(MESSAGES_STORE).index("by-peer").getAll(IDBKeyRange.bound([ownerPubkey, ""], [ownerPubkey, "\uffff"]));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const legacy = all.filter((r) => !isSealedRow(r)) as CachedMessage[];
    for (let i = 0; i < legacy.length; i += 200) {
      const sealed = await Promise.all(legacy.slice(i, i + 200).map((m) => sealMessage(key, m)));
      await new Promise<void>((resolve) => {
        const tx = db.transaction(MESSAGES_STORE, "readwrite");
        const store = tx.objectStore(MESSAGES_STORE);
        for (const row of sealed) store.put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }
  } catch {
    sweptLegacy.delete(ownerPubkey);
  }
}

/**
 * Heuristic for a leaked Concord direct-invite bundle (kind-3313 rumor JSON)
 * that an older build cached as DM text. `community_root` is SECRET key
 * material — such content must never render as a message. Matched on every
 * cache load (messages + conversation previews) and purged from IDB.
 */
export function isLeakedInviteBundleJson(content: string | undefined | null): boolean {
  if (!content) return false;
  const t = content.trimStart();
  if (t.charCodeAt(0) !== 123 /* '{' */) return false;
  if (!t.includes('"community_root"') || !t.includes('"community_id"')) return false;
  try {
    const o = JSON.parse(t);
    return !!o && typeof o === "object" && typeof o.community_root === "string" && typeof o.community_id === "string";
  } catch {
    return false;
  }
}

/** Redacted preview text for a conversation whose cached lastMessage was a
 *  leaked invite bundle. */
const INVITE_REDACTED_PREVIEW = "Community invite";

export async function getConversationList(ownerPubkey: string): Promise<CachedConversation[]> {
  try {
    const db = await openDB();
    const key = await deviceKey(ownerPubkey);
    const stored = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const req = tx.objectStore(CONVERSATIONS_STORE).index("by-owner").getAll(ownerPubkey);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const { rows: results, unreadable, legacy } = await openRows<CachedConversation>(key, stored, CONVERSATION_BOUND);
    if (unreadable > 0) { await startOver(ownerPubkey); return []; }
    for (const c of results) {
      // One-time sweep: a leaked invite bundle cached as the conversation
      // preview gets redacted in place (and persisted redacted).
      if (isLeakedInviteBundleJson(c.lastMessage)) {
        c.lastMessage = INVITE_REDACTED_PREVIEW;
        void putConversation(ownerPubkey, c);
      } else if (key && legacy.includes(c)) {
        void putConversation(ownerPubkey, c); // stored before sealing: seal it now
      }
    }
    void sealLegacyRows(ownerPubkey);
    results.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    return results;
  } catch {
    return [];
  }
}

export async function getMessages(ownerPubkey: string, peerPubkey: string): Promise<CachedMessage[]> {
  return (await readChat(ownerPubkey, peerPubkey)).filter((m) => !m.reactsTo);
}

/**
 * Where a reaction waits when the message it reacts to is not stored here yet
 * (messages arrive in no particular order). A reaction's own tags cannot be
 * trusted to say which chat it belongs to — some apps tag only the message's
 * author — so it is held until its message turns up, then filed with it.
 */
export const HELD_REACTIONS = "reactions:held";

/** The reactions stored for a chat (lib/dm-thread.ts tallies them). */
export async function getReactions(ownerPubkey: string, peerPubkey: string): Promise<Array<CachedMessage & { reactsTo: string }>> {
  const isReaction = (m: CachedMessage): m is CachedMessage & { reactsTo: string } => !!m.reactsTo;
  const chat = await readChat(ownerPubkey, peerPubkey);
  const mine = chat.filter(isReaction);
  // Held reactions whose message is in this chat now belong to it.
  const here = new Set(chat.filter((m) => !m.reactsTo).map((m) => m.id));
  const adopted = (await readChat(ownerPubkey, HELD_REACTIONS)).filter(isReaction).filter((r) => here.has(r.reactsTo));
  if (adopted.length) void putMessages(ownerPubkey, peerPubkey, adopted);
  return [...mine, ...adopted.map((r) => ({ ...r, peerPubkey }))];
}

/** The chat a stored message is filed in, or null when it is not stored here. */
export async function roomOfMessage(ownerPubkey: string, messageId: string): Promise<string | null> {
  const row = await safeTx("readonly", MESSAGES_STORE, (store) => store.get([ownerPubkey, messageId]));
  return (row as { peerPubkey?: string } | undefined)?.peerPubkey ?? null;
}

async function readChat(ownerPubkey: string, peerPubkey: string): Promise<CachedMessage[]> {
  try {
    const db = await openDB();
    const key = await deviceKey(ownerPubkey);
    const stored = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const req = tx.objectStore(MESSAGES_STORE).index("by-peer").getAll([ownerPubkey, peerPubkey]);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const { rows: results, unreadable, legacy } = await openRows<CachedMessage>(key, stored, MESSAGE_BOUND);
    if (unreadable > 0) { await startOver(ownerPubkey); return []; }
    // One-time sweep: drop leaked invite bundles (secret key material a
    // previous build cached as DM text) and delete them from IDB.
    // Same sweep for disappearing messages whose time has passed: gone from
    // the screen and from this device.
    const nowSec = Math.floor(Date.now() / 1000);
    const gone = (m: CachedMessage) => isLeakedInviteBundleJson(m.content) || isExpired(m.expiresAt, nowSec);
    const leaked = results.filter(gone);
    for (const m of leaked) void deleteMessage(ownerPubkey, m.id);
    const clean = leaked.length ? results.filter((m) => !gone(m)) : results;
    const unsealed = key ? legacy.filter((m) => !gone(m)) : [];
    if (unsealed.length) void putMessages(ownerPubkey, peerPubkey, unsealed);
    clean.sort((a, b) => a.timestamp - b.timestamp);
    return clean;
  } catch {
    return [];
  }
}

export async function putMessages(ownerPubkey: string, peerPubkey: string, messages: CachedMessage[]): Promise<void> {
  try {
    const db = await openDB();
    const key = await deviceKey(ownerPubkey);
    const nowSec = Math.floor(Date.now() / 1000);
    const rows = await Promise.all(messages
      .filter((msg) => !isLeakedInviteBundleJson(msg.content)) // never cache invite bundles as DMs
      .filter((msg) => !isExpired(msg.expiresAt, nowSec)) // a disappearing message already gone
      .map((msg) => sealMessage(key, { ...msg, ownerPubkey, peerPubkey })));
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readwrite");
      const store = tx.objectStore(MESSAGES_STORE);
      for (const row of rows) store.put(row);
      tx.oncomplete = () => { ownMessageStored(ownerPubkey, peerPubkey, messages); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

/** Fired when a message the reader wrote lands in a chat's store. */
export const OWN_MESSAGE_STORED = "dm-own-message-stored";

function ownMessageStored(ownerPubkey: string, peerPubkey: string, messages: CachedMessage[]): void {
  if (!messages.some((m) => m.from === ownerPubkey)) return;
  try { window.dispatchEvent(new CustomEvent(OWN_MESSAGE_STORED, { detail: { peer: peerPubkey } })); } catch {}
}

export async function putMessage(ownerPubkey: string, peerPubkey: string, msg: CachedMessage): Promise<void> {
  if (isLeakedInviteBundleJson(msg.content)) return; // never cache invite bundles as DMs
  if (isExpired(msg.expiresAt, Math.floor(Date.now() / 1000))) return; // already gone
  const row = await sealMessage(await deviceKey(ownerPubkey), { ...msg, ownerPubkey, peerPubkey });
  return safeTx("readwrite", MESSAGES_STORE, (store) => store.put(row)).then(() => ownMessageStored(ownerPubkey, peerPubkey, [msg]));
}

/**
 * Record a chat's newest message. The chat's NAME is kept across writes: most
 * callers know only the latest message, and a plain put would wipe a name an
 * earlier message set. A write that carries a name replaces it only when its
 * message is the newer one (lib/dm-room.ts newerSubject).
 */
export function putConversation(ownerPubkey: string, conv: CachedConversation, opts: { keepNewer?: boolean } = {}): Promise<void> {
  // One write at a time: a write reads the stored chat (to keep its name and
  // its newer preview), and sealing happens between that read and the write.
  const run = conversationWrites.then(() => writeConversation(ownerPubkey, conv, opts)).catch(() => {});
  conversationWrites = run;
  return run;
}

let conversationWrites: Promise<void> = Promise.resolve();

async function writeConversation(ownerPubkey: string, conv: CachedConversation, opts: { keepNewer?: boolean }): Promise<void> {
  const lastMessage = isLeakedInviteBundleJson(conv.lastMessage) ? INVITE_REDACTED_PREVIEW : conv.lastMessage;
  try {
    const db = await openDB();
    const key = await deviceKey(ownerPubkey);
    const stored = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const get = tx.objectStore(CONVERSATIONS_STORE).get([ownerPubkey, conv.peerPubkey]);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    const existing = (stored && key ? await openRow<CachedConversation>(key, stored, CONVERSATION_BOUND)
      : stored && !isSealedRow(stored) ? stored as CachedConversation : null) ?? undefined;
    const name = newerSubject(existing, { subject: conv.subject, at: conv.subjectAt ?? conv.lastTimestamp });
    // History paging hands over OLDER messages: they may create a chat or
    // name it, but must not replace a newer preview already stored.
    const older = opts.keepNewer && existing && existing.lastTimestamp >= conv.lastTimestamp;
    const next: CachedConversation = older
      ? { ...existing, ownerPubkey }
      : { ...conv, lastMessage, ownerPubkey };
    if (name.subject) { next.subject = name.subject; next.subjectAt = name.subjectAt; }
    else { delete next.subject; delete next.subjectAt; }
    const row = await sealConversation(key, next);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readwrite");
      tx.objectStore(CONVERSATIONS_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  } catch {}
}

/**
 * The single most recent cached message of one conversation (reverse cursor on
 * the by-peer-time index — O(1), never materializes the thread). Feeds the
 * Stories menu's "Up next" reply nudge, which needs the LAST message's
 * direction (`from`) without loading whole threads. Null when nothing is
 * cached or IndexedDB is unavailable.
 */
export async function getLatestMessage(ownerPubkey: string, peerPubkey: string): Promise<CachedMessage | null> {
  try {
    const db = await openDB();
    const key = await deviceKey(ownerPubkey);
    // The newest few rows: a reaction is stored beside the messages and is
    // not one, so the newest MESSAGE may sit a row or two back.
    const newest = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const index = tx.objectStore(MESSAGES_STORE).index("by-peer-time");
      const range = IDBKeyRange.bound(
        [ownerPubkey, peerPubkey, -Infinity],
        [ownerPubkey, peerPubkey, Infinity]
      );
      const rows: unknown[] = [];
      const req = index.openCursor(range, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || rows.length >= 30) { resolve(rows); return; }
        rows.push(cursor.value);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    for (const stored of newest) {
      const row = !isSealedRow(stored) ? stored as CachedMessage : key ? await openRow<CachedMessage>(key, stored, MESSAGE_BOUND) : null;
      if (row && !row.reactsTo) return row;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getLatestTimestamp(ownerPubkey: string, peerPubkey: string): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index("by-peer-time");
      const range = IDBKeyRange.bound(
        [ownerPubkey, peerPubkey, -Infinity],
        [ownerPubkey, peerPubkey, Infinity]
      );
      const req = index.openCursor(range, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          resolve((cursor.value as CachedMessage).timestamp);
        } else {
          resolve(0);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

export async function getLatestConversationTimestamp(ownerPubkey: string): Promise<number> {
  try {
    const convs = await getConversationList(ownerPubkey);
    if (convs.length === 0) return 0;
    return Math.max(...convs.map(c => c.lastTimestamp));
  } catch {
    return 0;
  }
}

export async function deleteMessage(ownerPubkey: string, msgId: string): Promise<void> {
  return safeTx("readwrite", MESSAGES_STORE, (store) =>
    store.delete([ownerPubkey, msgId])
  ).then(() => {});
}

export async function deleteConversation(ownerPubkey: string, peerPubkey: string): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([MESSAGES_STORE, CONVERSATIONS_STORE], "readwrite");

      const msgStore = tx.objectStore(MESSAGES_STORE);
      const msgIndex = msgStore.index("by-peer");
      const msgReq = msgIndex.openCursor([ownerPubkey, peerPubkey]);
      msgReq.onsuccess = () => {
        const cursor = msgReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const convStore = tx.objectStore(CONVERSATIONS_STORE);
      convStore.delete([ownerPubkey, peerPubkey]);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function clearAll(ownerPubkey: string, opts: { keepKey?: boolean } = {}): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([MESSAGES_STORE, CONVERSATIONS_STORE, PROCESSED_WRAPS_STORE], "readwrite");

      // Signing out removes the key with the rows it sealed.
      if (!opts.keepKey) void forgetDeviceKey(ownerPubkey);

      const msgStore = tx.objectStore(MESSAGES_STORE);
      const msgIndex = msgStore.index("by-peer");
      const msgCursor = msgIndex.openCursor(IDBKeyRange.bound(
        [ownerPubkey, ""],
        [ownerPubkey, "\uffff"]
      ));
      msgCursor.onsuccess = () => {
        const cursor = msgCursor.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const convStore = tx.objectStore(CONVERSATIONS_STORE);
      const convIndex = convStore.index("by-owner");
      const convCursor = convIndex.openCursor(ownerPubkey);
      convCursor.onsuccess = () => {
        const cursor = convCursor.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const wrapStore = tx.objectStore(PROCESSED_WRAPS_STORE);
      const wrapIndex = wrapStore.index("by-owner");
      const wrapCursor = wrapIndex.openCursor(ownerPubkey);
      wrapCursor.onsuccess = () => {
        const cursor = wrapCursor.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ---- Decrypt-once ledger (processed_wraps) ----------------------------------

/** Set of gift-wrap event ids this owner has already attempted to decrypt
 *  (regardless of outcome), so they are never sent to the signer twice. */
export async function getProcessedWrapIds(ownerPubkey: string): Promise<Set<string>> {
  try {
    // First, so a store that has to start over does so before this list of
    // "already opened" messages is read from it.
    await deviceKey(ownerPubkey);
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(PROCESSED_WRAPS_STORE, "readonly");
      const store = tx.objectStore(PROCESSED_WRAPS_STORE);
      const index = store.index("by-owner");
      const req = index.getAll(ownerPubkey);
      req.onsuccess = () => {
        const rows = (req.result || []) as ProcessedWrap[];
        resolve(new Set(rows.map((r) => r.wrapId)));
      };
      req.onerror = () => resolve(new Set());
    });
  } catch {
    return new Set();
  }
}

/** Record that a wrap has been processed (decrypted/failed/foreign). */
export async function markProcessed(
  ownerPubkey: string,
  wrapId: string,
  status: WrapStatus,
): Promise<void> {
  return safeTx("readwrite", PROCESSED_WRAPS_STORE, (store) =>
    store.put({ ownerPubkey, wrapId, status, ts: Date.now() } as ProcessedWrap)
  ).then(() => {});
}

/** Batch variant \u2014 records many wrap outcomes in one transaction. */
export async function markProcessedBatch(
  ownerPubkey: string,
  entries: Array<{ wrapId: string; status: WrapStatus }>,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(PROCESSED_WRAPS_STORE, "readwrite");
      const store = tx.objectStore(PROCESSED_WRAPS_STORE);
      const ts = Date.now();
      for (const e of entries) {
        store.put({ ownerPubkey, wrapId: e.wrapId, status: e.status, ts } as ProcessedWrap);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}
