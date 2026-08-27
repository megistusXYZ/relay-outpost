// Pure helpers for the agenda-first Calendar page: local-day keying, grouping
// calendar items into day sections over a rolling window, and the per-day dot
// summaries the week ribbon renders. PURE by design (no clock, no storage) so
// day-boundary behavior is unit-testable — every date is interpreted in LOCAL
// time, matching getCalendarEventDate's local-midnight semantics for date-only
// (kind 31922) events.
import type { CalendarItem } from "@/lib/calendar-events";
import { getCalendarEventEndDate } from "@/lib/calendar-events";
import type { Holiday } from "@/lib/calendar-holidays";

/** Agenda window: today + the next 30 days. */
export const AGENDA_WINDOW_DAYS = 31;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local-time "YYYY-MM-DD" key for a date. */
export function dayKeyLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse a "YYYY-MM-DD" key back to LOCAL midnight. Returns null for
 *  malformed keys or values that don't round-trip (e.g. 2026-02-31, which
 *  Date would silently roll into March). */
export function parseDayKey(key: string): Date | null {
  const parts = key.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [y, m, d] = parts;
  if (y < 1970 || y > 3000) return null;
  const date = new Date(y, m - 1, d);
  // Round-trip check rejects rollover (month 13, day 32, Feb 31, …).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** Every {year, month} touched by [start, end] inclusive, in order. */
export function monthsInRange(start: Date, end: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 48) {
    out.push({ year: y, month: m });
    m++;
    if (m > 11) { m = 0; y++; }
    guard++;
  }
  return out;
}

/** Section header parts: "Today"/"Tomorrow"/weekday + a short date. */
export function agendaDayLabel(date: Date, today: Date): { primary: string; secondary: string } {
  const d0 = startOfDay(today);
  const diffDays = Math.round((startOfDay(date).getTime() - d0.getTime()) / 86400000);
  const secondary = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
  if (diffDays === 0) return { primary: "Today", secondary };
  if (diffDays === 1) return { primary: "Tomorrow", secondary };
  return { primary: date.toLocaleDateString([], { weekday: "long" }), secondary };
}

/** A dated holiday instance (Holiday itself only stores month/day). */
export interface HolidayOccurrence {
  date: Date;
  holiday: Holiday;
}

export interface AgendaDay {
  key: string;
  date: Date;
  items: CalendarItem[];
  holidays: Holiday[];
}

/** Same amber the filter row uses for the Holidays category. */
export const HOLIDAY_DOT = "bg-amber-500 dark:bg-amber-400";

// The [startDay, endDay] LOCAL-day span of one item. Multi-day pinned calendar
// events span every day through their (inclusive, as we publish it) end date;
// every other item type is single-day.
function itemDaySpan(item: CalendarItem): { start: Date; end: Date } {
  const start = startOfDay(item.date);
  let end = start;
  if (item.type === "pinned-event") {
    const e = getCalendarEventEndDate(item.calendarEvent);
    if (e) {
      const endDay = startOfDay(e);
      if (endDay.getTime() > end.getTime()) end = endDay;
    }
  }
  return { start, end };
}

/**
 * Group items + holiday occurrences into ordered day sections over
 * [windowStart, windowStart + windowDays). Only days that have content are
 * returned, except keys listed in `alwaysIncludeKeys` (the selected day renders
 * an explicit empty section so a ribbon tap always lands somewhere). Items
 * within a day sort by start time; multi-day events appear on every day they
 * span (clamped to the window).
 */
export function buildAgendaDays(
  items: CalendarItem[],
  occurrences: HolidayOccurrence[],
  windowStart: Date,
  windowDays: number = AGENDA_WINDOW_DAYS,
  alwaysIncludeKeys: string[] = [],
): AgendaDay[] {
  const winStart = startOfDay(windowStart);
  const winEndIncl = addDays(winStart, windowDays - 1);
  const byKey = new Map<string, AgendaDay>();

  const ensure = (d: Date): AgendaDay => {
    const key = dayKeyLocal(d);
    let day = byKey.get(key);
    if (!day) {
      day = { key, date: d, items: [], holidays: [] };
      byKey.set(key, day);
    }
    return day;
  };

  for (const item of items) {
    const { start, end } = itemDaySpan(item);
    if (end.getTime() < winStart.getTime() || start.getTime() > winEndIncl.getTime()) continue;
    let cur = start.getTime() < winStart.getTime() ? winStart : start;
    const last = end.getTime() > winEndIncl.getTime() ? winEndIncl : end;
    let guard = 0;
    while (cur.getTime() <= last.getTime() && guard < 400) {
      ensure(cur).items.push(item);
      cur = addDays(cur, 1);
      guard++;
    }
  }

  for (const key of alwaysIncludeKeys) {
    const d = parseDayKey(key);
    if (!d) continue;
    if (d.getTime() < winStart.getTime() || d.getTime() > winEndIncl.getTime()) continue;
    ensure(d);
  }

  // Holidays never create sections of their own — an upcoming holiday is a
  // mark on the calendar date (grid cell, ribbon dot), not an agenda banner.
  // They attach only to days that exist anyway: days with items, or the
  // explicitly selected day (so tapping the date still shows the holiday).
  for (const occ of occurrences) {
    const d = startOfDay(occ.date);
    if (d.getTime() < winStart.getTime() || d.getTime() > winEndIncl.getTime()) continue;
    const day = byKey.get(dayKeyLocal(d));
    if (day) day.holidays.push(occ.holiday);
  }

  const days = [...byKey.values()];
  days.sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const day of days) {
    day.items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  return days;
}

/**
 * Per-day dot colors for the week ribbon: unique dotColor classes in first-seen
 * order (holidays contribute HOLIDAY_DOT), spanning multi-day events like
 * buildAgendaDays. Keyed by local "YYYY-MM-DD".
 */
export function buildDayDotMap(
  items: CalendarItem[],
  occurrences: HolidayOccurrence[],
  rangeStart: Date,
  rangeEnd: Date,
): Map<string, string[]> {
  const start = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);
  if (end.getTime() < start.getTime()) return new Map();
  const windowDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const days = buildAgendaDays(items, occurrences, start, windowDays);
  const map = new Map<string, string[]>();
  for (const day of days) {
    const dots: string[] = [];
    for (const item of day.items) {
      if (!dots.includes(item.dotColor)) dots.push(item.dotColor);
    }
    if (day.holidays.length > 0 && !dots.includes(HOLIDAY_DOT)) dots.push(HOLIDAY_DOT);
    if (dots.length > 0) map.set(day.key, dots);
  }
  return map;
}
