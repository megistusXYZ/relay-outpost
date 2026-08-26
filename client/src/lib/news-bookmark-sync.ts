/**
 * Cross-device NEWS/RSS BOOKMARK sync.
 *
 * News article bookmarks live in per-device localStorage
 * (`relay_outpost_rss_bookmarks`, written by RSSFeed's useRssBookmarks and read
 * by the Bookmarks page), so a save on the phone never shows on desktop and a
 * cleared browser loses everything. This module syncs that array across the
 * user's own relays, reusing the encrypted NIP-78 (kind-30078) self-blob
 * pattern from `read-state-sync.ts` — a SEPARATE doc with its own d-tag.
 *
 * MERGE SEMANTICS (additive union — NOT last-writer-wins):
 *   - Union by `link`; for a duplicate link the copy with the newer `savedAt`
 *     stamp wins (tie → local). `savedAt` (ms) is stamped by this module the
 *     first time it sees an item; older items fall back to pubDate for order.
 *   - Deletions travel as TOMBSTONES ({link, deletedAt}, capped, part of the
 *     payload). A tombstone suppresses an item unless the item was re-saved
 *     AFTER the delete (savedAt > deletedAt), so delete-on-A removes-on-B but
 *     a deliberate re-bookmark survives.
 *
 * SAFETY (same footgun class as the follow-list wipe):
 *   - Never publish an empty doc: no bookmarks AND no tombstones → no publish.
 *   - An empty/missing/corrupted remote NEVER clears local bookmarks; a wiped
 *     browser (empty local) hydrates fully from remote.
 *   - Mass-disappearance guard: RSSFeed keeps its own React copy of the array
 *     and rewrites the key from that state, so a stale page could clobber
 *     items this module hydrated underneath it. A single passive scan that
 *     sees MANY links vanish at once therefore does NOT mint tombstones (the
 *     items simply re-hydrate from remote); real user deletes happen one at a
 *     time and always tombstone.
 *   - The blob is nip44 SELF-encrypted (reading habits are private).
 *   - Publishes are debounced/coalesced and FLUSHED on visibility→hidden.
 *   - Only runs for a signed-in user with a NIP-44-capable signer.
 *
 * SIZE CAPS (NIP-78 events must not balloon; relays commonly cap ~64–128KB):
 *   - At most 200 bookmarks, newest-first; descriptions trimmed to 300 chars
 *     and extracted article HTML dropped for the wire (it is re-fetched on
 *     open); at most 100 tombstones; and a hard ~40KB serialized budget —
 *     oldest bookmarks are dropped first until the doc fits.
 *
 * WIRING: RSSFeed.tsx is intentionally untouched by this module's PR (a
 * parallel change owns that file), so local changes are picked up three ways:
 * the explicit `notifyNewsBookmarksChanged()` (called from the Bookmarks
 * page's delete path), a cross-tab `storage` listener, and a light poll while
 * the tab is visible. RSSFeed's save path can call
 * `notifyNewsBookmarksChanged()` directly in a tiny follow-up.
 */

import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";

// NOTE: the heavy relay graph (`@/lib/nostr` pulls IndexedDB + SimplePool at
// module load) is imported LAZILY inside the async I/O helpers below, exactly
// like read-state-sync.ts, so the merge/scan/trim logic is unit-testable in a
// node env WITHOUT mocking.

const KIND_APP_DATA = 30078;
export const NEWS_BOOKMARKS_D_TAG = "relay-outpost:news-bookmarks:v1";
const NEWS_BOOKMARKS_VERSION = 1;
const SYNC_DEBOUNCE = 4000;
const FETCH_TIMEOUT = 10000;
const VISIBLE_POLL_MS = 5000;

/** Shared with RSSFeed.tsx (useRssBookmarks) and Bookmarks.tsx — the truth. */
export const NEWS_BOOKMARKS_STORAGE_KEY = "relay_outpost_rss_bookmarks";
/** Module-owned: delete markers that must survive reloads until published. */
const TOMBSTONES_STORAGE_KEY = "relay_outpost_rss_bookmark_tombstones_v1";
/**
 * Module-owned: link → savedAt of the list as of the last scan. Detects local
 * deletes (link gone from the array) AND restores a savedAt stamp that a stale
 * RSSFeed React state rewrote away (RSSFeed rewrites the whole key from its
 * in-memory copy, which may predate our stamping) — without restoration a
 * re-stamp at "now" would beat older remote tombstones and resurrect deletes.
 */
const SHADOW_STORAGE_KEY = "relay_outpost_rss_bookmark_shadow_v1";

/** link → savedAt (ms) as of the previous scan. */
export type BookmarkShadow = Record<string, number>;

export const MAX_BOOKMARKS = 200;
export const MAX_TOMBSTONES = 100;
/** Wire-format description cap (localStorage keeps RSSFeed's own 500). */
const PUBLISH_DESCRIPTION_CAP = 300;
/** Serialized-doc budget (pre-encryption); nip44+base64 adds ~1/3 on top. */
export const MAX_PAYLOAD_BYTES = 40_000;
/**
 * A passive scan that sees more links vanish at once than this does NOT mint
 * tombstones — that signature is a stale RSSFeed state clobbering the key (or
 * a partial storage wipe), not a user deleting bookmarks one by one.
 */
export const MASS_DELETE_GUARD = 10;

/** Local bookmark changed (Bookmarks delete path / future RSSFeed save path). */
export const NEWS_BOOKMARKS_CHANGED_EVENT = "news-bookmarks-changed";
/** Hydration rewrote localStorage — open UIs should re-read the key. */
export const NEWS_BOOKMARKS_UPDATED_EVENT = "news-bookmarks-updated";

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://purplepag.es",
];

/**
 * Structurally matches RSSFeed.tsx's RSSItem (not imported — a lib must not
 * pull in a page module). Unknown extra fields round-trip untouched.
 */
export interface NewsBookmark {
  link: string;
  title?: string;
  description?: string;
  fullContent?: string;
  pubDate?: string;
  author?: string;
  categories?: string[];
  thumbnail?: string;
  comments?: string;
  audioUrl?: string;
  /** Stamped (ms epoch) by this module on first sight; drives merge order. */
  savedAt?: number;
  [extra: string]: unknown;
}

export interface BookmarkTombstone {
  link: string;
  /** ms epoch of the local delete. */
  deletedAt: number;
}

export interface NewsBookmarkDoc {
  version: number;
  lastModified: number;
  bookmarks: NewsBookmark[];
  tombstones: BookmarkTombstone[];
}

// ---------------------------------------------------------------------------
// PURE merge / scan / trim (fully unit-tested; no relay I/O, no DOM beyond
// localStorage which the tests stub)
// ---------------------------------------------------------------------------

function isValidBookmark(item: unknown): item is NewsBookmark {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof (item as { link?: unknown }).link === "string" &&
    (item as { link: string }).link.length > 0
  );
}

function isValidTombstone(item: unknown): item is BookmarkTombstone {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof (item as { link?: unknown }).link === "string" &&
    (item as { link: string }).link.length > 0 &&
    typeof (item as { deletedAt?: unknown }).deletedAt === "number"
  );
}

/** Sort key: savedAt stamp, else pubDate, else 0 — newest first everywhere. */
export function bookmarkOrderKey(b: NewsBookmark): number {
  if (typeof b.savedAt === "number" && b.savedAt > 0) return b.savedAt;
  if (b.pubDate) {
    const t = new Date(b.pubDate).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

/** Validate a decrypted blob is a well-formed doc (corrupted remote → null). */
export function isNewsBookmarkDoc(parsed: unknown): parsed is NewsBookmarkDoc {
  if (parsed === null || typeof parsed !== "object") return false;
  const p = parsed as Partial<NewsBookmarkDoc>;
  return (
    typeof p.version === "number" &&
    typeof p.lastModified === "number" &&
    Array.isArray(p.bookmarks) &&
    Array.isArray(p.tombstones)
  );
}

/**
 * Union both tombstone lists by link (newest deletedAt wins), newest-first,
 * capped at MAX_TOMBSTONES.
 */
export function mergeTombstones(
  local: BookmarkTombstone[],
  remote: BookmarkTombstone[] | null | undefined,
): BookmarkTombstone[] {
  const byLink = new Map<string, number>();
  for (const t of [...(local || []), ...(remote || [])]) {
    if (!isValidTombstone(t)) continue;
    const cur = byLink.get(t.link);
    if (cur === undefined || t.deletedAt > cur) byLink.set(t.link, t.deletedAt);
  }
  return [...byLink.entries()]
    .map(([link, deletedAt]) => ({ link, deletedAt }))
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_TOMBSTONES);
}

/**
 * The additive union: remote ∪ local by link (newer savedAt wins, tie →
 * local), minus items covered by a tombstone newer than their save. A
 * null/empty remote can never remove anything (never-empty guard); a wiped
 * local ([]) comes back as exactly the remote list. Newest-first, capped.
 */
export function mergeNewsBookmarks(
  local: NewsBookmark[],
  remote: NewsBookmark[] | null | undefined,
  tombstones: BookmarkTombstone[],
): NewsBookmark[] {
  const byLink = new Map<string, NewsBookmark>();
  for (const item of remote || []) {
    if (!isValidBookmark(item)) continue;
    byLink.set(item.link, item);
  }
  for (const item of local || []) {
    if (!isValidBookmark(item)) continue;
    const prev = byLink.get(item.link);
    if (!prev || (item.savedAt ?? 0) >= (prev.savedAt ?? 0)) {
      byLink.set(item.link, item);
    }
  }

  const deadAt = new Map<string, number>();
  for (const t of tombstones || []) {
    if (isValidTombstone(t)) deadAt.set(t.link, t.deletedAt);
  }

  return [...byLink.values()]
    .filter((b) => {
      const dead = deadAt.get(b.link);
      return dead === undefined || (b.savedAt ?? 0) > dead;
    })
    .sort((a, b) => bookmarkOrderKey(b) - bookmarkOrderKey(a))
    .slice(0, MAX_BOOKMARKS);
}

export interface LocalScanResult {
  /** Current list with savedAt stamped/restored on any item that lacked it. */
  bookmarks: NewsBookmark[];
  /** Updated tombstone list (new deletes added, re-saved links dropped). */
  tombstones: BookmarkTombstone[];
  /** link → savedAt now present (the next shadow). */
  shadow: BookmarkShadow;
  /** True when anything above differs from what was passed in. */
  changed: boolean;
}

/**
 * Diff the current local array against the last-scan shadow:
 *   - unstamped item whose link is in the shadow → RESTORE the shadow's stamp
 *     (RSSFeed rewrote the key from a pre-stamp React copy — the item is not
 *     actually a fresh save, and must not out-rank older tombstones);
 *   - unstamped item NOT in the shadow → genuinely new save → stamp `now`
 *     (array is newest-first, so earlier positions get the later stamp);
 *   - links in shadow but no longer present → new tombstones (unless the
 *     mass-delete guard trips — see MASS_DELETE_GUARD);
 *   - links present with a save newer than their tombstone → tombstone dropped
 *     (a deliberate re-bookmark beats an old delete).
 *
 * Migration note: items saved before this module existed (or while signed
 * out) carry no stamp and no shadow entry, so they stamp at `now` — biased
 * toward KEEPING bookmarks (they may resurrect over an older cross-device
 * delete once, rather than a deliberate save being silently dropped).
 */
export function scanLocalChanges(
  current: NewsBookmark[],
  shadow: BookmarkShadow,
  tombstones: BookmarkTombstone[],
  now: number,
): LocalScanResult {
  let changed = false;

  const stamped: NewsBookmark[] = current.filter(isValidBookmark).map((item, i) => {
    if (typeof item.savedAt === "number" && item.savedAt > 0) return item;
    changed = true;
    const prior = shadow[item.link];
    return { ...item, savedAt: typeof prior === "number" && prior > 0 ? prior : now - i };
  });

  const currentLinks = new Set(stamped.map((b) => b.link));
  const disappeared = Object.keys(shadow).filter((link) => !currentLinks.has(link));

  let nextTombstones = (tombstones || []).filter(isValidTombstone);

  if (disappeared.length > 0 && disappeared.length <= MASS_DELETE_GUARD) {
    changed = true;
    nextTombstones = mergeTombstones(
      nextTombstones,
      disappeared.map((link) => ({ link, deletedAt: now })),
    );
  }
  // (disappeared.length > MASS_DELETE_GUARD → clobber signature: no tombstones;
  // the items simply re-hydrate from remote on the next merge.)

  const beforeDrop = nextTombstones.length;
  nextTombstones = nextTombstones.filter((t) => {
    const live = stamped.find((b) => b.link === t.link);
    return !(live && (live.savedAt ?? 0) > t.deletedAt);
  });
  if (nextTombstones.length !== beforeDrop) changed = true;

  const nextShadow: BookmarkShadow = {};
  for (const b of stamped) nextShadow[b.link] = b.savedAt ?? 0;
  if (disappeared.length > 0) changed = true;
  else {
    for (const [link, ts] of Object.entries(nextShadow)) {
      if (shadow[link] !== ts) { changed = true; break; }
    }
  }

  return {
    bookmarks: stamped,
    tombstones: nextTombstones.slice(0, MAX_TOMBSTONES),
    shadow: nextShadow,
    changed,
  };
}

/**
 * Wire-format trim: newest-first, ≤MAX_BOOKMARKS items, descriptions clipped,
 * extracted article HTML dropped, then oldest items dropped until the
 * serialized array fits MAX_PAYLOAD_BYTES.
 */
export function trimForPublish(bookmarks: NewsBookmark[]): NewsBookmark[] {
  let slim = bookmarks
    .filter(isValidBookmark)
    .map((b) => ({
      ...b,
      fullContent: "",
      description:
        typeof b.description === "string" ? b.description.slice(0, PUBLISH_DESCRIPTION_CAP) : b.description,
    }))
    .sort((a, b) => bookmarkOrderKey(b) - bookmarkOrderKey(a))
    .slice(0, MAX_BOOKMARKS);

  while (slim.length > 0 && JSON.stringify(slim).length > MAX_PAYLOAD_BYTES) {
    slim = slim.slice(0, slim.length - 1); // drop the oldest
  }
  return slim;
}

// --- localStorage accessors (stubbed in tests) ------------------------------

export function readLocalBookmarks(): NewsBookmark[] {
  try {
    const raw = localStorage.getItem(NEWS_BOOKMARKS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidBookmark) : [];
  } catch {
    return [];
  }
}

export function readLocalTombstones(): BookmarkTombstone[] {
  try {
    const raw = localStorage.getItem(TOMBSTONES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidTombstone) : [];
  } catch {
    return [];
  }
}

function readShadow(): BookmarkShadow {
  try {
    const raw = localStorage.getItem(SHADOW_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: BookmarkShadow = {};
    for (const [link, ts] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof ts === "number" && ts > 0) out[link] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLocalState(bookmarks: NewsBookmark[], tombstones: BookmarkTombstone[], shadow: BookmarkShadow): void {
  try { localStorage.setItem(NEWS_BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks)); } catch { /* quota/private */ }
  try { localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(tombstones)); } catch { /* ignore */ }
  try { localStorage.setItem(SHADOW_STORAGE_KEY, JSON.stringify(shadow)); } catch { /* ignore */ }
}

/** True if there is anything worth publishing (guards the never-clobber rule). */
export function hasAnyNewsBookmarkData(): boolean {
  return readLocalBookmarks().length > 0 || readLocalTombstones().length > 0;
}

/** Called by UIs (Bookmarks delete path; RSSFeed save path as a follow-up). */
export function notifyNewsBookmarksChanged(): void {
  try { window.dispatchEvent(new CustomEvent(NEWS_BOOKMARKS_CHANGED_EVENT)); } catch { /* SSR/test */ }
}

// ---------------------------------------------------------------------------
// Debounce (extracted so "coalesces" is directly testable)
// ---------------------------------------------------------------------------

export interface CoalescedScheduler {
  schedule(): void;
  /** Run now if pending (visibility→hidden), else no-op. */
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function createCoalescedScheduler(fn: () => void, delayMs: number): CoalescedScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fn(); }, delayMs);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
    },
    pending() { return timer !== null; },
  };
}

// ---------------------------------------------------------------------------
// Relay I/O (mirrors read-state-sync.ts / nip78-settings.ts)
// ---------------------------------------------------------------------------

async function getUserWriteRelays(): Promise<string[]> {
  const { filterBlockedRelays } = await import("@/lib/nostr");
  try {
    const { getActiveDefaultRelays, getOutpostRelays } = await import("@/lib/outpost-relays");
    const active = getActiveDefaultRelays();
    const outpost = getOutpostRelays().map((r) => r.url);
    const combined = [...new Set([...active, ...outpost])];
    const filtered = filterBlockedRelays(combined);
    if (filtered.length > 0) return filtered.slice(0, 6);
  } catch { /* fall through */ }
  return filterBlockedRelays(FALLBACK_RELAYS);
}

async function fetchDocFromRelay(pubkey: string, signer: ISigner): Promise<NewsBookmarkDoc | null> {
  const { pool } = await import("@/lib/nostr");
  const relays = await getUserWriteRelays();
  return new Promise((resolve) => {
    let bestEvent: NostrEvent | null = null;
    let eoseCount = 0;
    let resolved = false;
    const closers: Array<{ close(): void }> = [];

    const timer = setTimeout(() => {
      for (const c of closers) { try { c.close(); } catch { /* ignore */ } }
      finalize();
    }, FETCH_TIMEOUT);

    const finalize = async () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if (!bestEvent) { resolve(null); return; }
      try {
        if (!signer.nip44) { resolve(null); return; }
        const decrypted = await signer.nip44.decrypt(pubkey, bestEvent.content);
        const parsed: unknown = JSON.parse(decrypted);
        resolve(isNewsBookmarkDoc(parsed) ? parsed : null);
      } catch (err) {
        console.error("[news-bookmarks] Failed to decrypt bookmark doc:", err);
        resolve(null);
      }
    };

    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [NEWS_BOOKMARKS_D_TAG], limit: 1 } as never,
      {
        onevent(event: NostrEvent) {
          if (!bestEvent || event.created_at > bestEvent.created_at) bestEvent = event;
        },
        oneose() {
          eoseCount++;
          if (eoseCount >= relays.length) { sub.close(); finalize(); }
        },
      },
    );
    closers.push(sub);
  });
}

interface UnsignedAppEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

async function publishDocToRelay(doc: NewsBookmarkDoc, pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    if (!signer.nip44) {
      console.warn("[news-bookmarks] Signer does not support NIP-44 encryption");
      return false;
    }
    const payload = JSON.stringify(doc);
    const encrypted = await signer.nip44.encrypt(pubkey, payload);

    const eventTemplate: UnsignedAppEvent = {
      kind: KIND_APP_DATA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", NEWS_BOOKMARKS_D_TAG]],
      content: encrypted,
    };

    const { signWithTimeout } = await import("@/lib/signer-timeout");
    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    if (!signed) return false;

    const { publishEvent } = await import("@/lib/nostr");
    await publishEvent(signed, await getUserWriteRelays(), undefined, true);
    console.log("[news-bookmarks] Bookmark doc published to relays");
    return true;
  } catch (err) {
    console.error("[news-bookmarks] Failed to publish bookmark doc:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle (mirrors read-state-sync.ts; wired from NostrAuthContext)
// ---------------------------------------------------------------------------

let currentSigner: ISigner | null = null;
let currentPubkey: string | null = null;
let scheduler: CoalescedScheduler | null = null;
let syncInFlight = false;
let initialLoadDone = false;
let liveSub: { close(): void } | null = null;
let lastAppliedCreatedAt = 0;
let lastSeenRaw: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function notifyUpdated(): void {
  try { window.dispatchEvent(new CustomEvent(NEWS_BOOKMARKS_UPDATED_EVENT)); } catch { /* ignore */ }
}

/**
 * Stamp/diff the current local array (tombstoning fresh deletes), persist any
 * change, and schedule a publish when something is new. Cheap; safe to call
 * often — a no-op scan changes nothing.
 */
function runLocalScan(): void {
  if (!currentPubkey) return;
  try {
    const result = scanLocalChanges(readLocalBookmarks(), readShadow(), readLocalTombstones(), Date.now());
    lastSeenRaw = safeRawBookmarks();
    if (!result.changed) return;
    writeLocalState(result.bookmarks, result.tombstones, result.shadow);
    lastSeenRaw = safeRawBookmarks();
    scheduleNewsBookmarkSync();
  } catch (err) {
    console.error("[news-bookmarks] local scan failed:", err);
  }
}

function safeRawBookmarks(): string | null {
  try { return localStorage.getItem(NEWS_BOOKMARKS_STORAGE_KEY); } catch { return null; }
}

/** Debounced publish, triggered by local bookmark changes. */
export function scheduleNewsBookmarkSync(): void {
  if (!currentSigner || !currentPubkey || !initialLoadDone) return;
  if (!scheduler) {
    scheduler = createCoalescedScheduler(() => {
      if (!currentSigner || !currentPubkey) return;
      void doPublish(currentPubkey, currentSigner);
    }, SYNC_DEBOUNCE);
  }
  scheduler.schedule();
}

/** Flush a pending debounced publish (visibility→hidden). */
export function flushNewsBookmarkSync(): void {
  scheduler?.flush();
}

/** Publish the current merged local state. Never publishes an empty doc. */
async function doPublish(pubkey: string, signer: ISigner): Promise<void> {
  if (syncInFlight || currentPubkey !== pubkey) return;
  if (!hasAnyNewsBookmarkData()) return; // never publish an empty doc
  syncInFlight = true;
  try {
    const doc: NewsBookmarkDoc = {
      version: NEWS_BOOKMARKS_VERSION,
      lastModified: Date.now(),
      bookmarks: trimForPublish(readLocalBookmarks()),
      tombstones: readLocalTombstones().slice(0, MAX_TOMBSTONES),
    };
    await publishDocToRelay(doc, pubkey, signer);
  } catch (err) {
    console.error("[news-bookmarks] publish failed:", err);
  } finally {
    syncInFlight = false;
  }
}

/** Merge a remote doc into local storage; returns true if local changed. */
function applyRemoteDoc(remote: NewsBookmarkDoc): boolean {
  const localBefore = readLocalBookmarks();
  const tombstones = mergeTombstones(readLocalTombstones(), remote.tombstones);
  // Stamp/diff local items first so a save made moments ago on THIS device
  // isn't treated as older than a remote tombstone.
  const scanned = scanLocalChanges(localBefore, readShadow(), tombstones, Date.now());
  const merged = mergeNewsBookmarks(scanned.bookmarks, remote.bookmarks, scanned.tombstones);

  const nextShadow: BookmarkShadow = {};
  for (const b of merged) nextShadow[b.link] = b.savedAt ?? 0;

  const changed = JSON.stringify(merged) !== JSON.stringify(localBefore);
  writeLocalState(merged, scanned.tombstones, nextShadow);
  lastSeenRaw = safeRawBookmarks();
  return changed;
}

/**
 * On login: fetch the remote doc and MERGE (union + tombstones) into local,
 * then tell open UIs to re-read. If local holds anything the relay may lack
 * (covers "no remote doc yet" and offline saves), schedule one publish.
 * Also starts the live subscription so open devices converge.
 */
export async function loadNewsBookmarksFromRelay(pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    currentSigner = signer;
    currentPubkey = pubkey;

    const remote = await fetchDocFromRelay(pubkey, signer);
    initialLoadDone = true;
    if (currentPubkey !== pubkey) return false; // logged out / switched mid-fetch

    let applied = false;
    if (remote) {
      applied = applyRemoteDoc(remote);
    } else {
      runLocalScan(); // still stamp + shadow the local list
    }
    if (applied) notifyUpdated();

    startLiveSubscription(pubkey, signer).catch(() => { /* ignore */ });

    if (hasAnyNewsBookmarkData()) scheduleNewsBookmarkSync();
    return applied;
  } catch (err) {
    console.error("[news-bookmarks] Failed to load bookmark doc:", err);
    initialLoadDone = true;
    return false;
  }
}

/** Live convergence while the session stays open (echoes are no-ops). */
async function startLiveSubscription(pubkey: string, signer: ISigner): Promise<void> {
  if (liveSub || currentPubkey !== pubkey) return;
  const { pool } = await import("@/lib/nostr");
  const relays = await getUserWriteRelays();
  if (liveSub || currentPubkey !== pubkey) return; // re-check after awaits

  const since = Math.floor(Date.now() / 1000) - 60;
  liveSub = pool.subscribeMany(
    relays,
    { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [NEWS_BOOKMARKS_D_TAG], since } as never,
    {
      onevent(event: NostrEvent) {
        void handleLiveDocEvent(event, pubkey, signer);
      },
    },
  );
}

async function handleLiveDocEvent(event: NostrEvent, pubkey: string, signer: ISigner): Promise<void> {
  if (currentPubkey !== pubkey) return;
  if (event.created_at <= lastAppliedCreatedAt) return; // dedupe multi-relay echoes
  lastAppliedCreatedAt = event.created_at;
  try {
    if (!signer.nip44) return;
    const decrypted = await signer.nip44.decrypt(pubkey, event.content);
    const parsed: unknown = JSON.parse(decrypted);
    if (!isNewsBookmarkDoc(parsed)) return;
    if (currentPubkey !== pubkey) return;
    if (applyRemoteDoc(parsed)) notifyUpdated();
  } catch { /* undecryptable/junk event — ignore */ }
}

// --- start/stop -------------------------------------------------------------

let changedHandler: (() => void) | null = null;
let storageHandler: ((e: StorageEvent) => void) | null = null;
let visibilityHandler: (() => void) | null = null;

/**
 * Wire everything up for a signed-in session; returns a teardown. Mirrors how
 * read-state sync is started from NostrAuthContext: a short delay before the
 * initial fetch keeps login snappy.
 */
export function startNewsBookmarkSync(pubkey: string, signer: ISigner): () => void {
  teardownNewsBookmarkSync(); // defensive: never double-wire listeners/timers
  currentSigner = signer;
  currentPubkey = pubkey;
  lastSeenRaw = safeRawBookmarks();

  changedHandler = () => runLocalScan();
  try { window.addEventListener(NEWS_BOOKMARKS_CHANGED_EVENT, changedHandler); } catch { changedHandler = null; }

  // Cross-tab writes (another tab's RSSFeed/Bookmarks touching the key).
  storageHandler = (e: StorageEvent) => {
    if (e.key === NEWS_BOOKMARKS_STORAGE_KEY) runLocalScan();
  };
  try { window.addEventListener("storage", storageHandler); } catch { storageHandler = null; }

  // Same-tab RSSFeed saves (untouched by this PR) fire no event and no
  // storage event — a light poll while visible picks them up within seconds.
  pollTimer = setInterval(() => {
    try {
      if (document.visibilityState !== "visible") return;
      if (safeRawBookmarks() !== lastSeenRaw) runLocalScan();
    } catch { /* ignore */ }
  }, VISIBLE_POLL_MS);

  visibilityHandler = () => {
    try {
      if (document.visibilityState === "hidden") {
        flushNewsBookmarkSync();
      } else if (safeRawBookmarks() !== lastSeenRaw) {
        runLocalScan();
      }
    } catch { /* ignore */ }
  };
  try { document.addEventListener("visibilitychange", visibilityHandler); } catch { visibilityHandler = null; }

  const delayTimer = setTimeout(() => {
    loadNewsBookmarksFromRelay(pubkey, signer).catch(() => { /* ignore */ });
  }, 3000);

  return () => {
    clearTimeout(delayTimer);
    teardownNewsBookmarkSync();
  };
}

export function teardownNewsBookmarkSync(): void {
  scheduler?.cancel();
  scheduler = null;
  if (liveSub) { try { liveSub.close(); } catch { /* ignore */ } liveSub = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (changedHandler) {
    try { window.removeEventListener(NEWS_BOOKMARKS_CHANGED_EVENT, changedHandler); } catch { /* ignore */ }
    changedHandler = null;
  }
  if (storageHandler) {
    try { window.removeEventListener("storage", storageHandler); } catch { /* ignore */ }
    storageHandler = null;
  }
  if (visibilityHandler) {
    try { document.removeEventListener("visibilitychange", visibilityHandler); } catch { /* ignore */ }
    visibilityHandler = null;
  }
  currentSigner = null;
  currentPubkey = null;
  syncInFlight = false;
  initialLoadDone = false;
  lastAppliedCreatedAt = 0;
  lastSeenRaw = null;
}
