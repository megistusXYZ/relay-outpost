/**
 * The News unread-count policy, shared by every surface that shows a News
 * badge (the News page header/picker and the Stories menu's News ring/card).
 *
 * Two principles (approved design):
 *  1. Only PRIORITY items count — tier 1–2 from news-scoring (score >= 70).
 *     The raw everything-unread diff produced numbers like "566 unread"; that
 *     aggregate total is no longer surfaced anywhere — News is an infinite
 *     firehose, and an ever-climbing "unread" total reads as a guilt meter.
 *  2. 72-hour freshness window — an item older than 72h never counts as
 *     unread anywhere. It stays readable in the feed; it just stops nagging.
 *
 * Pure and framework-free (unit-tested in news-unread.test.ts). Callers build
 * the item list (scored via news-scoring) and pass their own read-predicate.
 */

import { ALERTING_TIERS, type AlertTier } from "@/lib/news-scoring";

/** Items older than this never count as unread (they remain readable). */
export const UNREAD_FRESHNESS_HOURS = 72;

/** The slice of a scored item the counting policy needs. */
export interface PriorityCountable {
  /** Stable article id (guid → id → link — the read-ledger key). */
  id: string;
  /** Alert tier from news-scoring; only ALERTING_TIERS (priority/alert) count. */
  tier: AlertTier;
  /**
   * Publish time in ms since epoch. undefined/NaN (unparseable date) never
   * counts — an item of unknowable age must not nag forever.
   */
  timeMs?: number;
  /** Headline, for the "newest priority unread" teaser. */
  title?: string;
}

export interface PriorityUnreadSummary {
  count: number;
  /** Newest counted headline (by timeMs), or null when nothing counts. */
  topTitle: string | null;
  /** Id of that newest counted item, or null. */
  topId: string | null;
}

/**
 * Freshness gate: true when the item's publish time is known and within the
 * window (boundary inclusive). Future-dated items count — clock skew between
 * feeds and devices is common and must not hide a just-published story.
 */
export function isFreshForUnread(
  timeMs: number | undefined,
  now: number,
  windowH: number = UNREAD_FRESHNESS_HOURS,
): boolean {
  if (timeMs === undefined || Number.isNaN(timeMs)) return false;
  return now - timeMs <= windowH * 3_600_000;
}

/**
 * Count the unread items that deserve a badge: tier 1–2, unread, and inside
 * the freshness window. Deduped by id (clustered feeds can repeat articles);
 * unkeyed items are skipped — they can never be marked read, so counting them
 * would wedge the badge permanently "new".
 */
export function countPriorityUnread(
  items: readonly PriorityCountable[],
  isRead: (id: string) => boolean,
  now: number,
  opts?: { windowH?: number },
): PriorityUnreadSummary {
  const windowH = opts?.windowH ?? UNREAD_FRESHNESS_HOURS;
  const seen = new Set<string>();
  let count = 0;
  let top: PriorityCountable | null = null;
  let topTime = -Infinity;
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    if (!ALERTING_TIERS.includes(item.tier)) continue;
    if (isRead(item.id)) continue;
    if (!isFreshForUnread(item.timeMs, now, windowH)) continue;
    count++;
    const t = item.timeMs as number; // freshness gate guarantees a real number
    if (t > topTime || top === null) {
      top = item;
      topTime = t;
    }
  }
  return { count, topTitle: top?.title?.trim() || null, topId: top?.id ?? null };
}

/**
 * Whether the calm "Worth your time" cluster should render at the top of the
 * News page. It appears ONLY when the priority scorer flagged at least one
 * fresh, unread, tier 1–2 item (a non-zero countPriorityUnread). When nothing
 * fresh is flagged the strip hides ENTIRELY — no "0" zero-state. News is a
 * firehose, not an inbox, so an empty priority cluster must never nag.
 */
export function shouldShowWorthYourTime(priorityCount: number): boolean {
  return priorityCount > 0;
}
