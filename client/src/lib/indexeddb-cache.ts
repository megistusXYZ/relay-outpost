const DB_NAME = "relay-outpost-cache";
const DB_VERSION = 3;
const STORE_PROFILES = "profiles";
const STORE_FEED_CACHE = "feed_cache";
const STORE_NOTIFICATIONS = "notifications";
const DEVICE_MEMORY = typeof navigator !== "undefined" && "deviceMemory" in navigator
  ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  : 8;
const MAX_PROFILES = DEVICE_MEMORY <= 4 ? 500 : 2000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FEED_CACHE_MAX = 50;
const FEED_CACHE_TTL = 30 * 60 * 1000;
const NOTIF_CACHE_MAX = 200;
const NOTIF_CACHE_TTL = 60 * 24 * 60 * 60 * 1000;

let dbInstance: IDBDatabase | null = null;
let dbFailed = false;

function openDB(): Promise<IDBDatabase | null> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbFailed) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PROFILES)) {
          const store = db.createObjectStore(STORE_PROFILES, { keyPath: "pubkey" });
          store.createIndex("cachedAt", "cachedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_FEED_CACHE)) {
          db.createObjectStore(STORE_FEED_CACHE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_NOTIFICATIONS)) {
          db.createObjectStore(STORE_NOTIFICATIONS, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        dbInstance = request.result;
        dbInstance.onclose = () => { dbInstance = null; };
        resolve(dbInstance);
      };

      request.onerror = () => {
        dbFailed = true;
        resolve(null);
      };

      request.onblocked = () => {
        dbFailed = true;
        resolve(null);
      };
    } catch {
      dbFailed = true;
      resolve(null);
    }
  });
}

export async function putProfile(pubkey: string, event: any): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;
    const tx = db.transaction(STORE_PROFILES, "readwrite");
    tx.objectStore(STORE_PROFILES).put({
      pubkey,
      event,
      cachedAt: Date.now(),
    });
  } catch {}
}

export async function putProfilesBatch(profiles: Array<{ pubkey: string; event: any }>): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;
    const tx = db.transaction(STORE_PROFILES, "readwrite");
    const store = tx.objectStore(STORE_PROFILES);
    const now = Date.now();
    for (const { pubkey, event } of profiles) {
      store.put({ pubkey, event, cachedAt: now });
    }
  } catch {}
}

export async function getProfile(pubkey: string): Promise<any | null> {
  try {
    const db = await openDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const request = tx.objectStore(STORE_PROFILES).get(pubkey);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) { resolve(null); return; }
        if (Date.now() - result.cachedAt > MAX_AGE_MS) { resolve(null); return; }
        resolve(result.event);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getProfilesBatch(pubkeys: string[]): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  try {
    const db = await openDB();
    if (!db) return results;
    const now = Date.now();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const store = tx.objectStore(STORE_PROFILES);
      let pending = pubkeys.length;
      if (pending === 0) { resolve(results); return; }
      for (const pk of pubkeys) {
        const request = store.get(pk);
        request.onsuccess = () => {
          const result = request.result;
          if (result && now - result.cachedAt <= MAX_AGE_MS) {
            results.set(pk, result.event);
          }
          pending--;
          if (pending === 0) resolve(results);
        };
        request.onerror = () => {
          pending--;
          if (pending === 0) resolve(results);
        };
      }
    });
  } catch {
    return results;
  }
}

export async function getAllProfiles(): Promise<Map<string, any>> {
  const results = new Map<string, any>();
  try {
    const db = await openDB();
    if (!db) return results;
    const now = Date.now();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const request = tx.objectStore(STORE_PROFILES).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const val = cursor.value;
          if (val && val.event && now - val.cachedAt <= MAX_AGE_MS) {
            results.set(val.pubkey, val.event);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => resolve(results);
    });
  } catch {
    return results;
  }
}

export async function pruneOldProfiles(): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;
    const now = Date.now();
    const tx = db.transaction(STORE_PROFILES, "readwrite");
    const store = tx.objectStore(STORE_PROFILES);
    const request = store.openCursor();
    const allKeys: { key: string; cachedAt: number }[] = [];

    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const val = cursor.value;
          if (now - val.cachedAt > MAX_AGE_MS) {
            cursor.delete();
          } else {
            allKeys.push({ key: val.pubkey, cachedAt: val.cachedAt });
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });

    if (allKeys.length > MAX_PROFILES) {
      allKeys.sort((a, b) => a.cachedAt - b.cachedAt);
      const toRemove = allKeys.slice(0, allKeys.length - MAX_PROFILES);
      const deleteTx = db.transaction(STORE_PROFILES, "readwrite");
      const deleteStore = deleteTx.objectStore(STORE_PROFILES);
      for (const item of toRemove) {
        deleteStore.delete(item.key);
      }
    }
  } catch {}
}

export async function getProfileCount(): Promise<number> {
  try {
    const db = await openDB();
    if (!db) return 0;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_PROFILES, "readonly");
      const request = tx.objectStore(STORE_PROFILES).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function cacheFeedEvents(feedKey: string, events: any[]): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;
    const trimmed = events.slice(0, FEED_CACHE_MAX);
    const tx = db.transaction(STORE_FEED_CACHE, "readwrite");
    tx.objectStore(STORE_FEED_CACHE).put({
      key: feedKey,
      events: trimmed,
      cachedAt: Date.now(),
    });
  } catch {}
}

export async function getCachedFeedEvents(feedKey: string): Promise<any[] | null> {
  try {
    const db = await openDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_FEED_CACHE, "readonly");
      const request = tx.objectStore(STORE_FEED_CACHE).get(feedKey);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) { resolve(null); return; }
        if (Date.now() - result.cachedAt > FEED_CACHE_TTL) { resolve(null); return; }
        resolve(result.events);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// Persist a user's notification history so it survives reloads and relay gaps
// (most relays don't retain reactions/reposts/zaps for long). Keyed per-account;
// capped by count and pruned by a long TTL so abandoned accounts don't linger.
export async function cacheNotifications(accountKey: string, items: any[]): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;
    const trimmed = items.slice(0, NOTIF_CACHE_MAX);
    const tx = db.transaction(STORE_NOTIFICATIONS, "readwrite");
    tx.objectStore(STORE_NOTIFICATIONS).put({
      key: accountKey,
      items: trimmed,
      cachedAt: Date.now(),
    });
  } catch {}
}

export async function getCachedNotifications(accountKey: string): Promise<any[] | null> {
  try {
    const db = await openDB();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NOTIFICATIONS, "readonly");
      const request = tx.objectStore(STORE_NOTIFICATIONS).get(accountKey);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) { resolve(null); return; }
        if (Date.now() - result.cachedAt > NOTIF_CACHE_TTL) { resolve(null); return; }
        resolve(result.items);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
