import { describe, it, expect } from "vitest";
import {
  buildIcs,
  buildGoogleCalendarUrl,
  escapeIcsText,
  formatIcsUtc,
  addOneDayIso,
} from "./calendar-export";
import {
  KIND_DATE_CALENDAR_EVENT,
  KIND_TIME_CALENDAR_EVENT,
  type CalendarEventData,
} from "./calendar-events";
import type { Event } from "nostr-tools";

// 2026-08-01T18:30:00Z
const START = 1785609000;
// 2026-08-01T20:00:00Z
const END = 1785614400;
// DTSTAMP anchor — fixed so tests are deterministic (never Date.now()).
const NOW = 1785556800;

function rawEvent(kind: number, tags: string[][], content = ""): Event {
  return {
    id: "e".repeat(64),
    pubkey: "a".repeat(64),
    created_at: NOW,
    kind,
    tags,
    content,
    sig: "s".repeat(128),
  };
}

function timedEvent(overrides: Partial<CalendarEventData> = {}): CalendarEventData {
  return {
    id: "e".repeat(64),
    pubkey: "a".repeat(64),
    dTag: "my-event",
    title: "Nostrville Meetup",
    description: "Come hang out",
    location: "Bitcoin Park, Nashville",
    startTime: START,
    endTime: END,
    hashtags: [],
    participants: [],
    references: [],
    kind: KIND_TIME_CALENDAR_EVENT,
    event: rawEvent(KIND_TIME_CALENDAR_EVENT, [["d", "my-event"]], "Come hang out"),
    ...overrides,
  };
}

function allDayEvent(overrides: Partial<CalendarEventData> = {}): CalendarEventData {
  return {
    id: "f".repeat(64),
    pubkey: "b".repeat(64),
    dTag: "conf-2026",
    title: "Nostr Conf",
    description: "Two days",
    location: "Riga",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    hashtags: [],
    participants: [],
    references: [],
    kind: KIND_DATE_CALENDAR_EVENT,
    event: rawEvent(KIND_DATE_CALENDAR_EVENT, [["d", "conf-2026"]], "Two days"),
    ...overrides,
  };
}

describe("formatIcsUtc", () => {
  it("formats unix seconds as compact UTC", () => {
    expect(formatIcsUtc(START)).toBe("20260801T183000Z");
  });
});

describe("addOneDayIso — exclusive all-day end", () => {
  it("adds a calendar day", () => {
    expect(addOneDayIso("2026-08-03")).toBe("2026-08-04");
  });
  it("rolls over month boundaries", () => {
    expect(addOneDayIso("2026-08-31")).toBe("2026-09-01");
  });
  it("rolls over year boundaries", () => {
    expect(addOneDayIso("2026-12-31")).toBe("2027-01-01");
  });
});

describe("escapeIcsText — RFC 5545", () => {
  it("escapes backslash, comma, semicolon and newlines", () => {
    expect(escapeIcsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });
});

describe("buildIcs — timed (31923)", () => {
  const ics = buildIcs(timedEvent(), { now: NOW });

  it("uses CRLF line endings", () => {
    expect(ics.includes("\r\n")).toBe(true);
    expect(ics.includes("\n\r")).toBe(false);
  });
  it("has a VCALENDAR/VEVENT envelope", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });
  it("emits UTC DTSTART/DTEND from start/end times", () => {
    expect(ics).toContain("DTSTART:20260801T183000Z");
    expect(ics).toContain("DTEND:20260801T200000Z");
  });
  it("carries a deterministic DTSTAMP from the injected now", () => {
    expect(ics).toContain(`DTSTAMP:${formatIcsUtc(NOW)}`);
  });
  it("includes SUMMARY and LOCATION", () => {
    expect(ics).toContain("SUMMARY:Nostrville Meetup");
    expect(ics).toContain("LOCATION:Bitcoin Park\\, Nashville");
  });
  it("uses a stable UID from the coordinate", () => {
    expect(ics).toContain(`UID:${KIND_TIME_CALENDAR_EVENT}:${"a".repeat(64)}:my-event@relay.outpost`);
  });
  it("defaults DTEND to +1h when no end time", () => {
    const noEnd = buildIcs(timedEvent({ endTime: undefined }), { now: NOW });
    expect(noEnd).toContain("DTEND:20260801T193000Z");
  });
  it("puts the njump link in DESCRIPTION and URL when naddr given", () => {
    const withLink = buildIcs(timedEvent({ description: "" }), { now: NOW, naddr: "naddr1abc" });
    expect(withLink).toContain("DESCRIPTION:https://njump.to/naddr1abc");
    expect(withLink).toContain("URL:https://njump.to/naddr1abc");
  });
  it("prefers a meeting link for URL", () => {
    const withMeeting = buildIcs(
      timedEvent({ references: ["https://meet.google.com/xyz"] }),
      { now: NOW, naddr: "naddr1abc" }
    );
    expect(withMeeting).toContain("URL:https://meet.google.com/xyz");
  });
});

describe("buildIcs — all-day (31922)", () => {
  const ics = buildIcs(allDayEvent(), { now: NOW });

  it("uses VALUE=DATE with exclusive end (day after end date)", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20260801");
    expect(ics).toContain("DTEND;VALUE=DATE:20260804");
  });
  it("single-day event ends the following day", () => {
    const single = buildIcs(allDayEvent({ endDate: undefined }), { now: NOW });
    expect(single).toContain("DTSTART;VALUE=DATE:20260801");
    expect(single).toContain("DTEND;VALUE=DATE:20260802");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("timed → UTC start/end with a literal slash", () => {
    const url = buildGoogleCalendarUrl(timedEvent());
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260801T183000Z/20260801T200000Z");
    expect(url).toContain("text=Nostrville%20Meetup");
    expect(url).toContain("location=Bitcoin%20Park%2C%20Nashville");
  });
  it("all-day → date range with exclusive end", () => {
    const url = buildGoogleCalendarUrl(allDayEvent());
    expect(url).toContain("dates=20260801/20260804");
  });
  it("timed with no end time defaults to +1h", () => {
    const url = buildGoogleCalendarUrl(timedEvent({ endTime: undefined }));
    expect(url).toContain("dates=20260801T183000Z/20260801T193000Z");
  });
});
