// Export a NIP-52 calendar event to the DEVICE calendar. Two destinations:
//   - Apple / Outlook / everything-that-eats-.ics  → buildIcs() + downloadIcs()
//   - Google Calendar                              → buildGoogleCalendarUrl()
//
// This is a PURE module (buildIcs / buildGoogleCalendarUrl take a `now` so they
// never touch the clock). It is distinct from the in-app "pin" (which saves into
// the app's own calendar) — this hands the event off to the OS calendar.
import {
  KIND_TIME_CALENDAR_EVENT,
  getMeetingLink,
  type CalendarEventData,
} from "@/lib/calendar-events";

export interface IcsOptions {
  /** Unix SECONDS for DTSTAMP. Falls back to the event's created_at so the
   *  builder stays pure (never calls Date.now itself). */
  now?: number;
  /** naddr of the event, used to build an njump.to link back into DESCRIPTION/URL. */
  naddr?: string | null;
}

// RFC 5545 §3.3.11 TEXT escaping: backslash first, then ; , and newlines.
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

// Unix seconds → UTC "YYYYMMDDTHHMMSSZ" (RFC 5545 form for a UTC date-time).
export function formatIcsUtc(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString(); // 2026-08-01T18:30:00.000Z
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// "YYYY-MM-DD" → "YYYYMMDD" (RFC 5545 VALUE=DATE form).
export function icsDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

// "YYYY-MM-DD" + 1 calendar day, in UTC so we never cross a DST/local boundary.
// Used for the iCal exclusive-end rule on all-day events (DTEND = day AFTER the
// last day of the event).
export function addOneDayIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Stable UID from the addressable coordinate — re-exporting the same event
// updates the calendar entry rather than duplicating it.
function icsUid(ce: CalendarEventData): string {
  return `${ce.kind}:${ce.pubkey}:${ce.dTag}@relay.outpost`;
}

function njumpLink(naddr?: string | null): string | undefined {
  return naddr ? `https://njump.to/${naddr}` : undefined;
}

// Compute [DTSTART, DTEND] property lines for either event kind.
function eventDateLines(ce: CalendarEventData): string[] {
  if (ce.kind === KIND_TIME_CALENDAR_EVENT && ce.startTime) {
    const end = ce.endTime ?? ce.startTime + 3600; // default 1h if no end
    return [`DTSTART:${formatIcsUtc(ce.startTime)}`, `DTEND:${formatIcsUtc(end)}`];
  }
  if (ce.startDate) {
    const endBase = ce.endDate ?? ce.startDate;
    return [
      `DTSTART;VALUE=DATE:${icsDate(ce.startDate)}`,
      `DTEND;VALUE=DATE:${icsDate(addOneDayIso(endBase))}`,
    ];
  }
  return [];
}

// A complete VCALENDAR/VEVENT string with CRLF line endings.
export function buildIcs(ce: CalendarEventData, opts: IcsOptions = {}): string {
  const now = opts.now ?? ce.event.created_at;
  const link = njumpLink(opts.naddr);
  const meeting = getMeetingLink(ce);
  const url = meeting?.url ?? link;

  const descParts: string[] = [];
  if (ce.description) descParts.push(ce.description);
  if (link) descParts.push(link);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Relay Outpost//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsUid(ce)}`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    ...eventDateLines(ce),
    `SUMMARY:${escapeIcsText(ce.title)}`,
  ];
  if (descParts.length) lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n\n"))}`);
  if (ce.location) lines.push(`LOCATION:${escapeIcsText(ce.location)}`);
  if (url) lines.push(`URL:${escapeIcsText(url)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n") + "\r\n";
}

// A Google Calendar "add event" template URL. Timed events use the UTC
// date-time form, all-day events the exclusive-end date form — mirroring the
// .ics builder so both destinations agree on the dates.
export function buildGoogleCalendarUrl(ce: CalendarEventData, opts: { naddr?: string | null } = {}): string {
  const link = njumpLink(opts.naddr);
  const meeting = getMeetingLink(ce);

  let dates = "";
  if (ce.kind === KIND_TIME_CALENDAR_EVENT && ce.startTime) {
    const end = ce.endTime ?? ce.startTime + 3600;
    dates = `${formatIcsUtc(ce.startTime)}/${formatIcsUtc(end)}`;
  } else if (ce.startDate) {
    const endBase = ce.endDate ?? ce.startDate;
    dates = `${icsDate(ce.startDate)}/${icsDate(addOneDayIso(endBase))}`;
  }

  const details = [ce.description, meeting?.url, link].filter(Boolean).join("\n\n");

  // Build the query by hand: `dates` must keep its literal "/" separator, which
  // URLSearchParams would percent-encode. Every char in `dates` is URL-safe.
  const parts = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(ce.title)}`,
    dates ? `dates=${dates}` : "",
    details ? `details=${encodeURIComponent(details)}` : "",
    ce.location ? `location=${encodeURIComponent(ce.location)}` : "",
  ].filter(Boolean);

  return `https://calendar.google.com/calendar/render?${parts.join("&")}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Trigger a .ics download via a Blob object-URL + temporary anchor. On iOS
// Safari / PWA this hands the file to the native "Add to Calendar" sheet. We use
// a blob: URL (not data:) so large descriptions aren't capped by data-URI limits.
export function downloadIcs(ce: CalendarEventData, opts: IcsOptions = {}): void {
  const ics = buildIcs(ce, { now: Math.floor(Date.now() / 1000), ...opts });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(ce.title) || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
