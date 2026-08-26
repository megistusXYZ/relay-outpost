/**
 * First-seen ledger — per-pubkey earliest evidence of an account existing.
 *
 * The For You feed's new-account combo gate (see spam-filter.ts) needs an
 * account-age signal, but Nostr has no canonical "created at" for a pubkey.
 * The cheapest honest proxy is the oldest evidence this client has ever
 * observed for the key: min(kind-0 profile created_at, oldest feed event
 * created_at). Both arrive through existing chokepoints (the profile cache
 * write in nostr.ts and the feed flush in Home), so recording costs no new
 * network — just a Map min-update.
 *
 * Semantics:
 *  - getFirstSeen(pk) → unix seconds of the earliest evidence, or null when
 *    the ledger has never seen the key. Callers must treat null as UNKNOWN
 *    and fail open (an account we can't date is not "new").
 *  - Timestamps are attacker-authored (created_at is self-reported), so this
 *    is a defense-in-depth signal, never a sole verdict. Future-dated
 *    timestamps are clamped to "now" so a spammer can't look brand-new
 *    forever, and nonsense values are ignored.
 *  - Persisted to localStorage (guarded: node/vitest and iOS-private-mode
 *    quota states make storage access THROW) with an LRU cap so the ledger
 *    can't grow unbounded.
 */

const STORAGE_KEY = "relay-outpost-first-seen";
const MAX_ENTRIES = 2000;
const PERSIST_DEBOUNCE_MS = 2000;

function loadLedger(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const map = new Map<string, number>();
        for (const [pk, ts] of Object.entries(parsed)) {
          if (typeof pk === "string" && typeof ts === "number" && Number.isFinite(ts) && ts > 0) {
            map.set(pk, ts);
          }
        }
        return map;
      }
    }
  } catch {}
  return new Map();
}

// Map iteration order doubles as the LRU order: a touched key is delete+set
// to the back, so pruning from the front evicts the least-recently-touched.
let firstSeenLedger: Map<string, number> = loadLedger();

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj: Record<string, number> = {};
      firstSeenLedger.forEach((ts, pk) => { obj[pk] = ts; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }, PERSIST_DEBOUNCE_MS);
}

function pruneLedger() {
  if (firstSeenLedger.size <= MAX_ENTRIES) return;
  const excess = firstSeenLedger.size - MAX_ENTRIES;
  const keys = firstSeenLedger.keys();
  for (let i = 0; i < excess; i++) {
    const { value, done } = keys.next();
    if (done) break;
    firstSeenLedger.delete(value);
  }
}

/**
 * Record one piece of evidence that `pubkey` existed at `createdAtSeconds`.
 * Keeps the MINIMUM ever observed. Cheap enough to call from hot paths.
 */
export function recordFirstSeen(
  pubkey: string,
  createdAtSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): void {
  if (!pubkey || typeof pubkey !== "string") return;
  if (typeof createdAtSeconds !== "number" || !Number.isFinite(createdAtSeconds) || createdAtSeconds <= 0) return;
  // Future-dated events can't push first-seen forward past "now" — otherwise
  // a spammer stamping created_at in the future would read as perpetually new.
  const clamped = Math.min(createdAtSeconds, nowSeconds);
  if (clamped <= 0) return;

  const existing = firstSeenLedger.get(pubkey);
  const value = existing === undefined ? clamped : Math.min(existing, clamped);
  // delete+set refreshes the key's LRU position even when the value is unchanged.
  firstSeenLedger.delete(pubkey);
  firstSeenLedger.set(pubkey, value);
  pruneLedger();
  schedulePersist();
}

/** Batch helper for the feed-flush chokepoint. */
export function recordEventsFirstSeen(
  events: Array<{ pubkey: string; created_at: number }>,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): void {
  for (const e of events) {
    if (!e) continue;
    recordFirstSeen(e.pubkey, e.created_at, nowSeconds);
  }
}

/**
 * Earliest evidence (unix seconds) that this pubkey existed, or null when the
 * ledger has never seen it. null means UNKNOWN — callers must fail open.
 */
export function getFirstSeen(pubkey: string): number | null {
  const ts = firstSeenLedger.get(pubkey);
  return ts === undefined ? null : ts;
}

/** Test-only: wipe the in-memory ledger and any pending persist. */
export function __resetFirstSeenForTests(): void {
  firstSeenLedger = new Map();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/** Test-only: current ledger size (for LRU-cap assertions). */
export function __firstSeenSizeForTests(): number {
  return firstSeenLedger.size;
}
