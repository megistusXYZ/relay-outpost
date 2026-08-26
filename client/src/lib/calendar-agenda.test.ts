import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  AGENDA_WINDOW_DAYS,
  HOLIDAY_DOT,
  addDays,
  agendaDayLabel,
  buildAgendaDays,
  buildDayDotMap,
  dayKeyLocal,
  monthsInRange,
  parseDayKey,
  startOfDay,
} from "./calendar-agenda";
import {
  getCalendarEventDate,
  parseCalendarEvent,
  type CalendarEventData,
  type CalendarItem,
  type CalendarItemPinnedEvent,
  type CalendarItemScheduled,
} from "./calendar-events";
import type { Holiday } from "./calendar-holidays";

// ── fixtures ───────────────────────────────────────────────────────────────

function fakeEvent(kind: number, tags: string[][]): Event {
  return {
    id: "e".repeat(64),
    pubkey: "p".repeat(64),
    created_at: 1750000000,
    kind,
    tags,
    content: "",
    sig: "s".repeat(128),
  };
}

function dateOnlyCe(startDate: string, endDate?: string): CalendarEventData {
  const tags: string[][] = [["d", `d-${startDate}`], ["title", "Date event"], ["start", startDate]];
  if (endDate) tags.push(["end", endDate]);
  const ce = parseCalendarEvent(fakeEvent(31922, tags));
  if (!ce) throw new Error("fixture parse failed");
  return ce;
}

function timedCe(startUnix: number, endUnix?: number): CalendarEventData {
  const tags: string[][] = [["d", `d-${startUnix}`], ["title", "Timed event"], ["start", String(startUnix)]];
  if (endUnix) tags.push(["end", String(endUnix)]);
  const ce = parseCalendarEvent(fakeEvent(31923, tags));
  if (!ce) throw new Error("fixture parse failed");
  return ce;
}

function pinnedItem(ce: CalendarEventData): CalendarItemPinnedEvent {
  const date = getCalendarEventDate(ce);
  if (!date) throw new Error("fixture has no date");
  return { type: "pinned-event", id: ce.id + ce.dTag, date, dotColor: "bg-sky-500", calendarEvent: ce };
}

function scheduledItem(date: Date, id = "s1"): CalendarItemScheduled {
  return {
    type: "scheduled",
    id: `scheduled-${id}`,
    date,
    dotColor: "bg-brand",
    data: {} as CalendarItemScheduled["data"],
  };
}

function holiday(name: string): Holiday {
  return { id: name, name, month: 0, day: 1, isBuiltIn: true };
}

const TODAY = new Date(2026, 6, 18); // Sat Jul 18 2026, local

// ── day keys ───────────────────────────────────────────────────────────────

describe("dayKeyLocal / parseDayKey", () => {
  it("round-trips a local date", () => {
    const d = new Date(2026, 6, 5, 14, 30);
    expect(dayKeyLocal(d)).toBe("2026-07-05");
    expect(parseDayKey("2026-07-05")?.getTime()).toBe(new Date(2026, 6, 5).getTime());
  });

  it("rejects rollover dates instead of silently shifting", () => {
    expect(parseDayKey("2026-02-31")).toBeNull();
    expect(parseDayKey("2026-13-01")).toBeNull();
    expect(parseDayKey("2026-00-10")).toBeNull();
    expect(parseDayKey("garbage")).toBeNull();
  });

  it("accepts leap day only in leap years", () => {
    expect(parseDayKey("2028-02-29")).not.toBeNull();
    expect(parseDayKey("2026-02-29")).toBeNull();
  });
});

describe("monthsInRange", () => {
  it("spans a year boundary", () => {
    expect(monthsInRange(new Date(2026, 11, 20), new Date(2027, 0, 10))).toEqual([
      { year: 2026, month: 11 },
      { year: 2027, month: 0 },
    ]);
  });

  it("single month", () => {
    expect(monthsInRange(new Date(2026, 6, 1), new Date(2026, 6, 31))).toEqual([{ year: 2026, month: 6 }]);
  });
});

describe("agendaDayLabel", () => {
  it("labels today and tomorrow", () => {
    expect(agendaDayLabel(TODAY, TODAY).primary).toBe("Today");
    expect(agendaDayLabel(addDays(TODAY, 1), TODAY).primary).toBe("Tomorrow");
  });

  it("uses the weekday for later days", () => {
    const { primary } = agendaDayLabel(new Date(2026, 6, 22), TODAY); // Wednesday
    expect(primary).toBe("Wednesday");
  });
});

// ── grouping ───────────────────────────────────────────────────────────────

describe("buildAgendaDays", () => {
  it("only returns days that have content, in order", () => {
    const items: CalendarItem[] = [
      scheduledItem(new Date(2026, 6, 20, 9, 0), "a"),
      scheduledItem(new Date(2026, 6, 18, 15, 0), "b"),
    ];
    const days = buildAgendaDays(items, [], TODAY);
    expect(days.map((d) => d.key)).toEqual(["2026-07-18", "2026-07-20"]);
  });

  it("a date-only pinned event lands on its LOCAL calendar day (not shifted by UTC parsing)", () => {
    const item = pinnedItem(dateOnlyCe("2026-07-25"));
    const days = buildAgendaDays([item], [], TODAY);
    expect(days).toHaveLength(1);
    expect(days[0].key).toBe("2026-07-25");
  });

  it("spans multi-day pinned events across every covered day", () => {
    const item = pinnedItem(dateOnlyCe("2026-07-20", "2026-07-22"));
    const days = buildAgendaDays([item], [], TODAY);
    expect(days.map((d) => d.key)).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
  });

  it("includes a multi-day event that started BEFORE the window on its remaining days", () => {
    // Started before "today", still running — must appear under Today.
    const item = pinnedItem(dateOnlyCe("2026-07-16", "2026-07-19"));
    const days = buildAgendaDays([item], [], TODAY);
    expect(days.map((d) => d.key)).toEqual(["2026-07-18", "2026-07-19"]);
  });

  it("clamps events that run past the window end", () => {
    const start = dayKeyLocal(addDays(TODAY, AGENDA_WINDOW_DAYS - 2));
    const end = dayKeyLocal(addDays(TODAY, AGENDA_WINDOW_DAYS + 5));
    const item = pinnedItem(dateOnlyCe(start, end));
    const days = buildAgendaDays([item], [], TODAY);
    expect(days.map((d) => d.key)).toEqual([
      dayKeyLocal(addDays(TODAY, AGENDA_WINDOW_DAYS - 2)),
      dayKeyLocal(addDays(TODAY, AGENDA_WINDOW_DAYS - 1)),
    ]);
  });

  it("drops items entirely outside the window", () => {
    const items: CalendarItem[] = [
      scheduledItem(new Date(2026, 6, 10), "past"),
      scheduledItem(addDays(TODAY, AGENDA_WINDOW_DAYS + 1), "far"),
    ];
    expect(buildAgendaDays(items, [], TODAY)).toHaveLength(0);
  });

  it("sorts items within a day by start time", () => {
    const items: CalendarItem[] = [
      scheduledItem(new Date(2026, 6, 20, 18, 0), "late"),
      scheduledItem(new Date(2026, 6, 20, 8, 0), "early"),
    ];
    const days = buildAgendaDays(items, [], TODAY);
    expect(days[0].items.map((i) => i.id)).toEqual(["scheduled-early", "scheduled-late"]);
  });

  it("attaches holiday occurrences to their day", () => {
    const days = buildAgendaDays([], [{ date: new Date(2026, 6, 24), holiday: holiday("Test Day") }], TODAY);
    expect(days).toHaveLength(1);
    expect(days[0].key).toBe("2026-07-24");
    expect(days[0].holidays[0].name).toBe("Test Day");
  });

  it("alwaysIncludeKeys forces an empty section inside the window only", () => {
    const days = buildAgendaDays([], [], TODAY, AGENDA_WINDOW_DAYS, ["2026-07-21", "2026-06-01", "2026-02-31"]);
    expect(days.map((d) => d.key)).toEqual(["2026-07-21"]);
    expect(days[0].items).toHaveLength(0);
  });

  it("a timed multi-day event (overnight) appears on both days", () => {
    const start = Math.floor(new Date(2026, 6, 20, 22, 0).getTime() / 1000);
    const end = Math.floor(new Date(2026, 6, 21, 2, 0).getTime() / 1000);
    const item = pinnedItem(timedCe(start, end));
    const days = buildAgendaDays([item], [], TODAY);
    expect(days.map((d) => d.key)).toEqual(["2026-07-20", "2026-07-21"]);
  });
});

// ── dots ───────────────────────────────────────────────────────────────────

describe("buildDayDotMap", () => {
  it("dedupes colors and appends the holiday dot", () => {
    const items: CalendarItem[] = [
      scheduledItem(new Date(2026, 6, 20, 8, 0), "a"),
      scheduledItem(new Date(2026, 6, 20, 9, 0), "b"),
      pinnedItem(dateOnlyCe("2026-07-20")),
    ];
    const occ = [{ date: new Date(2026, 6, 20), holiday: holiday("H") }];
    const map = buildDayDotMap(items, occ, startOfDay(TODAY), addDays(TODAY, 30));
    // Ordered by first item start time: the date-only pin sits at local
    // midnight, ahead of the 8am/9am scheduled posts.
    expect(map.get("2026-07-20")).toEqual(["bg-sky-500", "bg-brand", HOLIDAY_DOT]);
    expect(map.has("2026-07-19")).toBe(false);
  });

  it("returns empty map for inverted ranges", () => {
    expect(buildDayDotMap([], [], addDays(TODAY, 5), TODAY).size).toBe(0);
  });
});
