/**
 * Cross-device READ/SEEN state sync.
 *
 * Notification "last seen" and per-DM-thread "last read" markers live in
 * per-device localStorage, so a thread you read on your phone stays bold on
 * desktop. This module syncs exactly TWO monotonic timestamps across a user's
 * own relays, reusing the encrypted NIP-78 (kind-30078) self-blob pattern from
 * `nip78-settings.ts` — but as a SEPARATE doc with its own d-tag, because
 * read-state must merge MONOTONICALLY (you can never un-read something) rather
 * than last-writer-wins.
 *
 * Synced surfaces (and ONLY these — the per-id read/seen arrays are NOT synced,
 * they grow unbounded and the two timestamps solve ~all of "don't re-notify"):
 *   - notifLastSeen: `nostr_notif_lastseen_<pkSlug>` (pkSlug = pubkey.slice(0,16))
 *   - dmRead:        map of `ro_dm_read_<counterpartyPk>` → last-read UNIX ts
 *
 * MERGE SEMANTICS (this is the whole point — NOT last-writer-wins):
 *   - notifLastSeen: MAX(local, remote).
 *   - dmRead:        per-key MAX; union of keys; a key is NEVER deleted.
 *   - Hydrate-as-floor: applying remote may only ever RAISE a local ts.
 *
 * SAFETY (same footgun class as the follow-list wipe):
 *   - Never publish an empty/partial doc that could clobber: if there are no
 *     local markers at all, don't publish.
 *   - Receive-side never regresses — guaranteed by MAX and enforced by tests.
 *   - The blob is nip44 self-encrypted (it reveals what you've read and when).
 *   - Publishes are debounced/coalesced, and a pending publish is FLUSHED on
 *     visibilitychange→hidden so a read just before closing the tab isn't lost.
 *   - Only runs for a signed-in user with a NIP-44-capable signer.
 *
 * LIVE CONVERGENCE: besides the login-time fetch, an open session keeps a
 * subscription on its own read-state doc, so two simultaneously-open devices
 * converge without a reload. After any hydration that raised a marker, the UI
 * is told via DM_READ_EVENT (unread-DM counts) + READSTATE_HYDRATED_EVENT
 * (React-state mirrors like the notification badge's lastSeen).
 */

import type { ISigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";
import { DM_READ_PREFIX, DM_READ_EVENT, READSTATE_HYDRATED_EVENT } from "@/lib/dm-read";

// NOTE: the heavy relay graph (`@/lib/nostr` pulls IndexedDB + SimplePool at
// module load) is imported LAZILY inside the async I/O helpers below. Keeping
// the top-level imports pure (type-only + the dependency-free dm-read) lets the
// merge/collect/apply logic be unit-tested in a node env WITHOUT mocking — the
// repo's vi.mock hoisting is currently broken (see follow-list.test.ts).

const KIND_APP_DATA = 30078;
export const READSTATE_D_TAG = "relay-outpost-readstate";
const READSTATE_VERSION = 1;
const SYNC_DEBOUNCE = 4000;
const FETCH_TIMEOUT = 10000;

const NOTIF_LASTSEEN_PREFIX = "nostr_notif_lastseen_";

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://purplepag.es",
];

export interface ReadState {
  version: number;
  lastModified: number;
  /** Notifications "last seen" UNIX timestamp (drives the unread badge). */
  notifLastSeen: number;
  /** counterparty pubkey (hex) → last-read UNIX timestamp. */
  dmRead: Record<string, number>;
}

function pubkeySlug(pubkey: string): string {
  return pubkey.slice(0, 16);
}

function notifLastSeenKey(pubkey: string): string {
  return `${NOTIF_LASTSEEN_PREFIX}${pubkeySlug(pubkey)}`;
}

// ---------------------------------------------------------------------------
// PURE merge / collect / apply (fully unit-tested; no relay I/O)
// ---------------------------------------------------------------------------

/**
 * Merge two read-state docs MONOTONICALLY. The result never contains a value
 * lower than either input for any field/key, and never drops a dmRead key.
 * A null/absent remote leaves local untouched. Idempotent.
 */
export function mergeReadState(local: ReadState, remote: ReadState | null | undefined): ReadState {
  const dmRead: Record<string, number> = {};

  // Start from every local key (kept even if remote lacks it).
  for (const [pk, ts] of Object.entries(local.dmRead || {})) {
    dmRead[pk] = ts | 0 || Number(ts) || 0;
  }
  // Fold in remote, raising (or introducing) each key — never lowering.
  if (remote && remote.dmRead) {
    for (const [pk, rawTs] of Object.entries(remote.dmRead)) {
      const ts = Number(rawTs) || 0;
      const cur = dmRead[pk] || 0;
      if (ts > cur) dmRead[pk] = ts;
    }
  }

  const notifLastSeen = Math.max(local.notifLastSeen || 0, remote?.notifLastSeen || 0);

  return {
    version: READSTATE_VERSION,
    lastModified: Math.max(local.lastModified || 0, remote?.lastModified || 0),
    notifLastSeen,
    dmRead,
  };
}

/** Read the current on-device read-state into a plain doc. */
export function collectLocalState(pubkey: string): ReadState {
  const dmRead: Record<string, number> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DM_READ_PREFIX)) continue;
      const pk = key.slice(DM_READ_PREFIX.length);
      if (!pk) continue;
      const ts = parseInt(localStorage.getItem(key) || "0", 10) || 0;
      if (ts > 0) dmRead[pk] = ts;
    }
  } catch { /* private mode / no storage */ }

  let notifLastSeen = 0;
  try {
    notifLastSeen = parseInt(localStorage.getItem(notifLastSeenKey(pubkey)) || "0", 10) || 0;
  } catch { /* ignore */ }

  return {
    version: READSTATE_VERSION,
    lastModified: Date.now(),
    notifLastSeen,
    dmRead,
  };
}

/** True if there is anything worth publishing (guards the never-clobber rule). */
export function hasAnyReadMarkers(pubkey: string): boolean {
  const state = collectLocalState(pubkey);
  if (state.notifLastSeen > 0) return true;
  return Object.keys(state.dmRead).length > 0;
}

/**
 * Apply a remote doc onto local storage as a FLOOR — only ever raising a
 * timestamp, never lowering, never deleting. Returns true if anything changed.
 * Writes are done directly (bypassing the local-change event) so hydration does
 * not spuriously re-trigger a publish; the caller schedules one publish itself.
 */
export function applyRemoteToLocal(remote: ReadState | null | undefined, pubkey: string): boolean {
  if (!remote) return false;
  let changed = false;

  // notifLastSeen — raise only.
  try {
    const key = notifLastSeenKey(pubkey);
    const cur = parseInt(localStorage.getItem(key) || "0", 10) || 0;
    const next = remote.notifLastSeen || 0;
    if (next > cur) {
      localStorage.setItem(key, String(next));
      changed = true;
    }
  } catch { /* ignore */ }

  // dmRead — per-key raise only, never delete a key.
  if (remote.dmRead) {
    for (const [pk, rawTs] of Object.entries(remote.dmRead)) {
      if (!pk) continue;
      const ts = Number(rawTs) || 0;
      if (ts <= 0) continue;
      try {
        const key = DM_READ_PREFIX + pk;
        const cur = parseInt(localStorage.getItem(key) || "0", 10) || 0;
        if (ts > cur) {
          localStorage.setItem(key, String(ts));
          changed = true;
        }
      } catch { /* ignore */ }
    }
  }

  return changed;
}

/** Validate a decrypted blob is a well-formed ReadState doc. */
export function isReadStateDoc(parsed: unknown): parsed is ReadState {
  if (parsed === null || typeof parsed !== "object") return false;
  const p = parsed as Partial<ReadState>;
  return (
    typeof p.version === "number" &&
    typeof p.lastModified === "number" &&
    typeof p.notifLastSeen === "number" &&
    typeof p.dmRead === "object" &&
    p.dmRead !== null
  );
}

// ---------------------------------------------------------------------------
// Relay I/O (mirrors nip78-settings.ts)
// ---------------------------------------------------------------------------

async function getUserWriteRelays(): Promise<string[]> {
  const { filterBlockedRelays } = await import("@/lib/nostr");
  try {
    const { getActiveDefaultRelays, getOutpostRelays } = await import("@/lib/outpost-relays");
    const active = getActiveDefaultRelays();
    const outpost = getOutpostRelays().map(r => r.url);
    const combined = [...new Set([...active, ...outpost])];
    const filtered = filterBlockedRelays(combined);
    if (filtered.length > 0) return filtered.slice(0, 6);
  } catch { /* fall through */ }
  return filterBlockedRelays(FALLBACK_RELAYS);
}

async function fetchReadStateFromRelay(pubkey: string, signer: ISigner): Promise<ReadState | null> {
  const { pool } = await import("@/lib/nostr");
  const relays = await getUserWriteRelays();
  return new Promise((resolve) => {
    let bestEvent: NostrEvent | null = null;
    let eoseCount = 0;
    let resolved = false;
    const closers: Array<{ close(): void }> = [];

    const timer = setTimeout(() => {
      for (const c of closers) { try { c.close(); } catch {} }
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
        resolve(isReadStateDoc(parsed) ? parsed : null);
      } catch (err) {
        console.error("[readstate] Failed to decrypt read-state:", err);
        resolve(null);
      }
    };

    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [READSTATE_D_TAG], limit: 1 } as never,
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

async function publishReadStateToRelay(state: ReadState, pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    if (!signer.nip44) {
      console.warn("[readstate] Signer does not support NIP-44 encryption");
      return false;
    }
    const payload = JSON.stringify(state);
    const encrypted = await signer.nip44.encrypt(pubkey, payload);

    const eventTemplate: UnsignedAppEvent = {
      kind: KIND_APP_DATA,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["d", READSTATE_D_TAG]],
      content: encrypted,
    };

    const { signWithTimeout } = await import("@/lib/signer-timeout");
    const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);
    if (!signed) return false;

    const { publishEvent } = await import("@/lib/nostr");
    await publishEvent(signed, await getUserWriteRelays(), undefined, true);
    console.log("[readstate] Read-state published to relays");
    return true;
  } catch (err) {
    console.error("[readstate] Failed to publish read-state:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle (mirrors nip78-settings.ts; wired from NostrAuthContext)
// ---------------------------------------------------------------------------

let currentSigner: ISigner | null = null;
let currentPubkey: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight = false;
let initialLoadDone = false;
let liveSub: { close(): void } | null = null;
let lastAppliedCreatedAt = 0;
let visibilityHandler: (() => void) | null = null;

/** Tell the UI that hydration raised at least one local marker. */
function notifyHydrated(): void {
  try { window.dispatchEvent(new CustomEvent(DM_READ_EVENT)); } catch {}
  try { window.dispatchEvent(new CustomEvent(READSTATE_HYDRATED_EVENT)); } catch {}
}

/**
 * Flush a pending debounced publish immediately. Called on
 * visibilitychange→hidden so a thread read moments before backgrounding or
 * closing the tab still propagates (the debounce timer would otherwise die
 * with the page). No-op when nothing is pending.
 */
export function flushReadStateSync(): void {
  if (!syncTimer) return;
  clearTimeout(syncTimer);
  syncTimer = null;
  if (!currentSigner || !currentPubkey) return;
  void doPublish(currentPubkey, currentSigner);
}

function ensureVisibilityHook(): void {
  if (visibilityHandler) return;
  visibilityHandler = () => {
    try {
      if (document.visibilityState === "hidden") flushReadStateSync();
    } catch { /* ignore */ }
  };
  try { document.addEventListener("visibilitychange", visibilityHandler); } catch { visibilityHandler = null; }
}

export function initReadStateSync(pubkey: string, signer: ISigner): void {
  currentSigner = signer;
  currentPubkey = pubkey;
  ensureVisibilityHook();
}

export function teardownReadStateSync(): void {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  if (liveSub) { try { liveSub.close(); } catch {} liveSub = null; }
  if (visibilityHandler) {
    try { document.removeEventListener("visibilitychange", visibilityHandler); } catch {}
    visibilityHandler = null;
  }
  currentSigner = null;
  currentPubkey = null;
  syncInFlight = false;
  initialLoadDone = false;
  lastAppliedCreatedAt = 0;
}

/**
 * Publish the current (already-merged) local read-state. Never clobbers: bails
 * out if there are no local markers at all.
 */
async function doPublish(pubkey: string, signer: ISigner): Promise<void> {
  if (syncInFlight || currentPubkey !== pubkey) return;
  if (!hasAnyReadMarkers(pubkey)) return; // never publish an empty doc
  syncInFlight = true;
  try {
    const state = collectLocalState(pubkey);
    await publishReadStateToRelay(state, pubkey, signer);
  } catch (err) {
    console.error("[readstate] publish failed:", err);
  } finally {
    syncInFlight = false;
  }
}

/**
 * On load: fetch the remote doc and MERGE (max) into local. Applying can only
 * raise a local value. If local was raised, or purely-local markers exist that
 * the remote lacks, schedule one publish so the merged view propagates.
 * Also starts the LIVE subscription so remote reads keep converging while
 * this session stays open.
 */
export async function loadReadStateFromRelay(pubkey: string, signer: ISigner): Promise<boolean> {
  try {
    currentSigner = signer;
    currentPubkey = pubkey;
    ensureVisibilityHook();

    const remote = await fetchReadStateFromRelay(pubkey, signer);
    initialLoadDone = true;

    let applied = false;
    if (remote) applied = applyRemoteToLocal(remote, pubkey);
    if (applied) notifyHydrated();

    startLiveSubscription(pubkey, signer).catch(() => {});

    // Publish if there is anything locally the relay may not have. This covers
    // both "no remote doc yet" and "local had newer/extra markers".
    if (hasAnyReadMarkers(pubkey)) {
      scheduleReadStateSync();
    }
    return applied;
  } catch (err) {
    console.error("[readstate] Failed to load read-state:", err);
    initialLoadDone = true;
    return false;
  }
}

/**
 * Keep listening for read-state docs published by OTHER devices while this
 * session is open, hydrating each one as a floor. Our own publishes echo back
 * here too — applying them is a no-op (floor semantics), and hydration never
 * re-triggers a publish, so there is no feedback loop.
 */
async function startLiveSubscription(pubkey: string, signer: ISigner): Promise<void> {
  if (liveSub || currentPubkey !== pubkey) return;
  const { pool } = await import("@/lib/nostr");
  const relays = await getUserWriteRelays();
  if (liveSub || currentPubkey !== pubkey) return; // re-check after awaits

  const since = Math.floor(Date.now() / 1000) - 60;
  liveSub = pool.subscribeMany(
    relays,
    { kinds: [KIND_APP_DATA], authors: [pubkey], "#d": [READSTATE_D_TAG], since } as never,
    {
      onevent(event: NostrEvent) {
        void handleLiveReadStateEvent(event, pubkey, signer);
      },
    },
  );
}

async function handleLiveReadStateEvent(event: NostrEvent, pubkey: string, signer: ISigner): Promise<void> {
  if (currentPubkey !== pubkey) return;
  if (event.created_at <= lastAppliedCreatedAt) return; // dedupe multi-relay echoes
  lastAppliedCreatedAt = event.created_at;
  try {
    if (!signer.nip44) return;
    const decrypted = await signer.nip44.decrypt(pubkey, event.content);
    const parsed: unknown = JSON.parse(decrypted);
    if (!isReadStateDoc(parsed)) return;
    if (currentPubkey !== pubkey) return;
    if (applyRemoteToLocal(parsed, pubkey)) notifyHydrated();
  } catch { /* undecryptable/junk event — ignore */ }
}

/** Debounced publish, triggered by local read changes. */
export function scheduleReadStateSync(): void {
  if (!currentSigner || !currentPubkey || !initialLoadDone) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (!currentSigner || !currentPubkey) return;
    await doPublish(currentPubkey, currentSigner);
  }, SYNC_DEBOUNCE);
}
