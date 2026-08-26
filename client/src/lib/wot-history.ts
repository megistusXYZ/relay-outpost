// Background WoT score-history recording (no UI yet).
//
// Scores from GrapeRank are current-only — there is no history anywhere. This
// module quietly accumulates a bounded, one-per-day snapshot of each follow's
// influence to localStorage so a future "trending down" surface has data to draw
// on. It also tracks the trusted-reporter count each follow was last SEEN at, so
// the health page can mark a follow "New" the first time it crosses the flagged
// threshold. Pure snapshot/trim/delta logic here is unit-tested; the localStorage
// wrappers are thin.

export interface ScoreSnapshot {
  pubkey: string;
  /** YYYY-MM-DD (local) — one snapshot per pubkey per day. */
  date: string;
  influence: number;
}

export interface SnapshotLimits {
  /** Keep at most this many distinct days of history. */
  maxDays: number;
  /** Hard cap on total stored entries so localStorage stays small. */
  maxEntries: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = { maxDays: 30, maxEntries: 8000 };

const LS_SNAPSHOTS_KEY = "ro_wot_score_history";
const LS_FLAG_SEEN_KEY = "ro_follow_flag_seen";
const LS_REVIEWED_KEY = "ro_follow_health_reviewed";

/** Local YYYY-MM-DD for a unix-seconds timestamp (or now). */
export function dayKey(unixSeconds: number = Math.floor(Date.now() / 1000)): string {
  const d = new Date(unixSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Merge today's per-pubkey influence readings into the existing history,
 * enforcing one-per-(pubkey,day), a max-days window, and a hard entry cap.
 * Pure — returns a new array, never mutates the input.
 */
export function mergeDailySnapshots(
  existing: ScoreSnapshot[],
  todays: { pubkey: string; influence: number }[],
  today: string,
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): ScoreSnapshot[] {
  // Upsert today's readings: drop any prior entry for the same pubkey+today,
  // then append the fresh one (so re-recording within a day overwrites).
  const todayPubkeys = new Set(todays.map((t) => t.pubkey));
  const kept = existing.filter(
    (s) => !(s.date === today && todayPubkeys.has(s.pubkey)),
  );
  for (const t of todays) {
    if (!Number.isFinite(t.influence)) continue;
    kept.push({ pubkey: t.pubkey, date: today, influence: t.influence });
  }

  // Enforce the max-days window: keep only the newest `maxDays` distinct dates.
  const distinctDates = Array.from(new Set(kept.map((s) => s.date))).sort();
  if (distinctDates.length > limits.maxDays) {
    const allowed = new Set(distinctDates.slice(distinctDates.length - limits.maxDays));
    for (let i = kept.length - 1; i >= 0; i--) {
      if (!allowed.has(kept[i].date)) kept.splice(i, 1);
    }
  }

  // Hard entry cap: if still over, drop oldest-date entries first.
  if (kept.length > limits.maxEntries) {
    kept.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    kept.splice(0, kept.length - limits.maxEntries);
  }

  return kept;
}

/**
 * Given the trusted-reporter counts each follow was last seen at and the current
 * counts, return the pubkeys that just crossed the flag threshold (were below,
 * now at/above) plus the updated seen-map to persist. Only surfaces each crossing
 * once — after persisting nextSeen, the same follow won't re-alert.
 */
export function computeNewlyFlagged(
  prevSeen: Record<string, number>,
  current: Map<string, number>,
  threshold = 2,
): { newlyFlagged: string[]; nextSeen: Record<string, number> } {
  const newlyFlagged: string[] = [];
  const nextSeen: Record<string, number> = { ...prevSeen };

  for (const [pk, count] of current) {
    const prev = prevSeen[pk] ?? 0;
    if (count >= threshold && prev < threshold) {
      newlyFlagged.push(pk);
    }
    // Record the highest count we've observed so a later dip can't re-trigger.
    nextSeen[pk] = Math.max(prev, count);
  }

  return { newlyFlagged, nextSeen };
}

// ── localStorage wrappers (thin; the interesting logic is pure above) ─────────

function scopedKey(base: string, observer: string): string {
  return `${base}:${observer.slice(0, 8)}`;
}

export function loadSnapshots(observer: string): ScoreSnapshot[] {
  try {
    const raw = localStorage.getItem(scopedKey(LS_SNAPSHOTS_KEY, observer));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ScoreSnapshot[];
  } catch {}
  return [];
}

function saveSnapshots(observer: string, snapshots: ScoreSnapshot[]): void {
  try {
    localStorage.setItem(scopedKey(LS_SNAPSHOTS_KEY, observer), JSON.stringify(snapshots));
  } catch {}
}

/**
 * Record today's influence snapshot for the given follows. Debounced by day: if a
 * snapshot already exists for every follow today it re-writes harmlessly, so the
 * caller can fire this whenever scores refresh. `getInfluence` returns null for
 * follows with no score (skipped).
 */
export function recordScoreSnapshot(
  observer: string,
  follows: string[],
  getInfluence: (pubkey: string) => number | null,
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): void {
  if (!observer || follows.length === 0) return;
  const today = dayKey();
  const todays: { pubkey: string; influence: number }[] = [];
  for (const pk of follows) {
    const inf = getInfluence(pk);
    if (inf === null || inf === undefined || !Number.isFinite(inf) || inf < 0) continue;
    todays.push({ pubkey: pk, influence: inf });
  }
  if (todays.length === 0) return;
  const merged = mergeDailySnapshots(loadSnapshots(observer), todays, today, limits);
  saveSnapshots(observer, merged);
}

export function loadFlagSeen(observer: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(scopedKey(LS_FLAG_SEEN_KEY, observer));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
  } catch {}
  return {};
}

export function saveFlagSeen(observer: string, seen: Record<string, number>): void {
  try {
    localStorage.setItem(scopedKey(LS_FLAG_SEEN_KEY, observer), JSON.stringify(seen));
  } catch {}
}

/** Pubkeys the user marked "Keep" — dropped from the health lists + badge. */
export function loadReviewed(observer: string): Set<string> {
  try {
    const raw = localStorage.getItem(scopedKey(LS_REVIEWED_KEY, observer));
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr as string[]);
    }
  } catch {}
  return new Set();
}

export function saveReviewed(observer: string, set: Set<string>): void {
  try {
    localStorage.setItem(scopedKey(LS_REVIEWED_KEY, observer), JSON.stringify(Array.from(set)));
  } catch {}
}
