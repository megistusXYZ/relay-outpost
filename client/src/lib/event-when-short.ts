/**
 * The one-line "when" on a phone's compact event row: weekday, date and start
 * time. The end time, and the year when it is this year, are on the event
 * itself, one tap away (EventCard's formatEventWhen is the full form).
 */
import { getCalendarEventDate, getCalendarEventEndDate, type CalendarEventData } from "@/lib/calendar-events";

export function formatEventWhenShort(ce: CalendarEventData, now: Date = new Date(), locale?: string): string {
  const start = getCalendarEventDate(ce);
  if (!start) return "No date";
  const loc = locale ? [locale] : [];
  const year = start.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {};
  if (!ce.startTime) {
    const end = getCalendarEventEndDate(ce);
    if (end && ce.endDate && ce.endDate !== ce.startDate) {
      const day = (d: Date) => d.toLocaleDateString(loc, { month: "short", day: "numeric", ...year });
      return `${day(start)} – ${day(end)}`;
    }
  }
  const date = start.toLocaleDateString(loc, { weekday: "short", month: "short", day: "numeric", ...year });
  if (!ce.startTime) return date;
  return `${date} · ${start.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" })}`;
}
