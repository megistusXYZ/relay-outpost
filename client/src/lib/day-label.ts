/**
 * Day labels for time-grouped lists: "Today" / "Yesterday" / weekday (within
 * the last week) / "Mon D" / "Mon D, YYYY" (older, or a different year).
 * Pure and `now`-injected so the day-boundary math is node-testable and stable
 * across renders. Times are in ms. Shared by Concord chat date dividers
 * (lib/concord/concord-activity.ts, where the tests live) and the News
 * stream's time groups (lib/news-stream.ts).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Midnight (local) at the start of the day `ms` falls on. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** True when two ms timestamps fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

/** Date-divider label: "Today" / "Yesterday" / weekday (within the last week)
 *  / "Mon D" / "Mon D, YYYY" (older or a different year). */
export function chatDayLabel(t: number, now: number): string {
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(t)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(t);
  if (diffDays < 7) return WEEKDAYS[d.getDay()];
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
