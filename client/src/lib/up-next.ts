/**
 * "Up next" — the Stories menu's single contextual row. Picks AT MOST ONE
 * timely, locally-derived item, in strict priority order:
 *
 *   1. a pinned calendar event happening TODAY (local day),
 *   2. else a locally-scheduled post publishing within 24h,
 *   3. else a DM thread unanswered for >24h whose LAST message is inbound.
 *
 * Pure and framework-free (unit-tested in up-next.test.ts): the menu gathers
 * candidates from the on-device stores (pinned-event cache, local scheduler,
 * DM cache) and this module owns the "is it timely?" rules. No relay work.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A scheduled post is "up next" when it publishes within this window. */
export const SCHEDULED_WINDOW_MS = DAY_MS;
/** A DM nudge needs the inbound message to be at least this old ("unanswered"). */
export const DM_REPLY_MIN_AGE_MS = DAY_MS;
/** …but not older than this — a week-dead thread is no longer "timely". */
export const DM_REPLY_MAX_AGE_MS = 7 * DAY_MS;
/** A timed event with no end stays relevant this long after it starts. */
export const EVENT_NO_END_GRACE_MS = HOUR_MS;

export interface UpNextEventCandidate {
  id: string;
  title: string;
  /** Event start in ms. For all-day events: LOCAL midnight of the start day. */
  startMs: number;
  endMs?: number;
  allDay?: boolean;
}

export interface UpNextScheduledCandidate {
  id: string | number;
  snippet: string;
  publishAtMs: number;
  pending: boolean;
}

export interface UpNextDmCandidate {
  peerPubkey: string;
  /** Timestamp of the thread's LAST message, in ms. */
  lastMessageMs: number;
  /** True when that last message was sent by the peer (inbound). */
  lastIsInbound: boolean;
}

export type UpNextPick =
  | { kind: "event"; id: string; title: string; startMs: number; allDay: boolean }
  | { kind: "scheduled"; id: string | number; snippet: string; publishAtMs: number }
  | { kind: "dm"; peerPubkey: string; lastMessageMs: number };

/** Local-midnight start of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Normalize a pinned CalendarEventData-ish record into a candidate.
 * Timed events (31923) carry unix-seconds startTime; all-day events (31922)
 * carry YYYY-MM-DD startDate, interpreted as LOCAL days. Returns null when no
 * usable start exists.
 */
export function eventCandidateFromPinned(ev: {
  id: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  startDate?: string;
  endDate?: string;
}): UpNextEventCandidate | null {
  const title = (ev.title || "").trim() || "Event";
  if (typeof ev.startTime === "number" && ev.startTime > 0) {
    return {
      id: ev.id,
      title,
      startMs: ev.startTime * 1000,
      endMs: typeof ev.endTime === "number" && ev.endTime > 0 ? ev.endTime * 1000 : undefined,
      allDay: false,
    };
  }
  const parseLocalDay = (s: string | undefined): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s || "").trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  };
  const start = parseLocalDay(ev.startDate);
  if (start === null) return null;
  const end = parseLocalDay(ev.endDate);
  return {
    id: ev.id,
    title,
    startMs: start,
    // An all-day event runs through the END of its (last) day.
    endMs: (end ?? start) + DAY_MS,
    allDay: true,
  };
}

function pickEvent(now: number, events: readonly UpNextEventCandidate[]): UpNextPick | null {
  const dayStart = startOfLocalDay(now);
  const dayEnd = dayStart + DAY_MS;
  let best: UpNextEventCandidate | null = null;
  for (const ev of events) {
    if (!Number.isFinite(ev.startMs)) continue;
    // Happening TODAY: starts this local day…
    if (ev.startMs < dayStart || ev.startMs >= dayEnd) continue;
    // …and isn't already over.
    const effectiveEnd = ev.endMs ?? ev.startMs + (ev.allDay ? DAY_MS : EVENT_NO_END_GRACE_MS);
    if (effectiveEnd <= now) continue;
    if (!best || ev.startMs < best.startMs) best = ev;
  }
  return best
    ? { kind: "event", id: best.id, title: best.title, startMs: best.startMs, allDay: !!best.allDay }
    : null;
}

function pickScheduled(now: number, posts: readonly UpNextScheduledCandidate[]): UpNextPick | null {
  let best: UpNextScheduledCandidate | null = null;
  for (const p of posts) {
    if (!p.pending || !Number.isFinite(p.publishAtMs)) continue;
    if (p.publishAtMs <= now || p.publishAtMs > now + SCHEDULED_WINDOW_MS) continue;
    if (!best || p.publishAtMs < best.publishAtMs) best = p;
  }
  return best ? { kind: "scheduled", id: best.id, snippet: best.snippet, publishAtMs: best.publishAtMs } : null;
}

function pickDm(now: number, dms: readonly UpNextDmCandidate[]): UpNextPick | null {
  let best: UpNextDmCandidate | null = null;
  for (const d of dms) {
    if (!d.lastIsInbound || !Number.isFinite(d.lastMessageMs)) continue;
    const age = now - d.lastMessageMs;
    if (age < DM_REPLY_MIN_AGE_MS || age > DM_REPLY_MAX_AGE_MS) continue;
    if (!best || d.lastMessageMs > best.lastMessageMs) best = d;
  }
  return best ? { kind: "dm", peerPubkey: best.peerPubkey, lastMessageMs: best.lastMessageMs } : null;
}

/** The one row (or nothing). Priority: today's event > imminent schedule > stale reply. */
export function selectUpNext(
  now: number,
  input: {
    events?: readonly UpNextEventCandidate[];
    scheduled?: readonly UpNextScheduledCandidate[];
    dms?: readonly UpNextDmCandidate[];
  },
): UpNextPick | null {
  return (
    pickEvent(now, input.events ?? []) ??
    pickScheduled(now, input.scheduled ?? []) ??
    pickDm(now, input.dms ?? [])
  );
}
