const DB_NAME = "relay-outpost-dms";
const DB_VERSION = 2;
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
  peerPubkey: string;
  content: string;
  from: string;
  timestamp: number;
  encryption: "nip04" | "nip44" | "nip17";
  fileMetadata?: CachedFileMetadata;
  /** Private reply: the public note id this DM quotes (from the rumor's `q` tag). */
  quotedNoteId?: string;
}

export interface CachedConversation {
  ownerPubkey: string;
  peerPubkey: string;
  lastMessage: string;
  lastTimestamp: number;
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
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, "readonly");
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const index = store.index("by-owner");
      const req = index.getAll(ownerPubkey);
      req.onsuccess = () => {
        const results = (req.result || []) as CachedConversation[];
        // One-time sweep: a leaked invite bundle cached as the conversation
        // preview gets redacted in place (and persisted redacted).
        for (const c of results) {
          if (isLeakedInviteBundleJson(c.lastMessage)) {
            c.lastMessage = INVITE_REDACTED_PREVIEW;
            void putConversation(ownerPubkey, c);
          }
        }
        results.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getMessages(ownerPubkey: string, peerPubkey: string): Promise<CachedMessage[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const index = store.index("by-peer");
      const req = index.getAll([ownerPubkey, peerPubkey]);
      req.onsuccess = () => {
        const results = (req.result || []) as CachedMessage[];
        // One-time sweep: drop leaked invite bundles (secret key material a
        // previous build cached as DM text) and delete them from IDB.
        const leaked = results.filter((m) => isLeakedInviteBundleJson(m.content));
        for (const m of leaked) void deleteMessage(ownerPubkey, m.id);
        const clean = leaked.length ? results.filter((m) => !isLeakedInviteBundleJson(m.content)) : results;
        clean.sort((a, b) => a.timestamp - b.timestamp);
        resolve(clean);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function putMessages(ownerPubkey: string, peerPubkey: string, messages: CachedMessage[]): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readwrite");
      const store = tx.objectStore(MESSAGES_STORE);
      for (const msg of messages) {
        if (isLeakedInviteBundleJson(msg.content)) continue; // never cache invite bundles as DMs
        store.put({ ...msg, ownerPubkey, peerPubkey });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function putMessage(ownerPubkey: string, peerPubkey: string, msg: CachedMessage): Promise<void> {
  if (isLeakedInviteBundleJson(msg.content)) return; // never cache invite bundles as DMs
  return safeTx("readwrite", MESSAGES_STORE, (store) =>
    store.put({ ...msg, ownerPubkey, peerPubkey })
  ).then(() => {});
}

export async function putConversation(ownerPubkey: string, conv: CachedConversation): Promise<void> {
  const lastMessage = isLeakedInviteBundleJson(conv.lastMessage) ? INVITE_REDACTED_PREVIEW : conv.lastMessage;
  return safeTx("readwrite", CONVERSATIONS_STORE, (store) =>
    store.put({ ...conv, lastMessage, ownerPubkey })
  ).then(() => {});
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
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const index = tx.objectStore(MESSAGES_STORE).index("by-peer-time");
      const range = IDBKeyRange.bound(
        [ownerPubkey, peerPubkey, -Infinity],
        [ownerPubkey, peerPubkey, Infinity]
      );
      const req = index.openCursor(range, "prev");
      req.onsuccess = () => {
        const cursor = req.result;
        resolve(cursor ? (cursor.value as CachedMessage) : null);
      };
      req.onerror = () => reject(req.error);
    });
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

export async function clearAll(ownerPubkey: string): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([MESSAGES_STORE, CONVERSATIONS_STORE, PROCESSED_WRAPS_STORE], "readwrite");

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
