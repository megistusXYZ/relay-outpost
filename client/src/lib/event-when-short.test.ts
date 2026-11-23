/**
 * The one-line "when" on a phone's compact event row (owner, 2026-11-22):
 * weekday, date and start time only. The end time, and the year when it is
 * this year, are a tap away on the event itself.
 */
import { describe, it, expect } from "vitest";
import { formatEventWhenShort } from "./event-when-short";

const at = (y: number, m: number, d: number, h = 0, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const now = new Date(2026, 10, 20);
const fmt = (ce: Record<string, unknown>) => formatEventWhenShort(ce as never, now, "en-US");

describe("formatEventWhenShort", () => {
  it("a timed event: weekday, date, start time; no end time, no year this year", () => {
    expect(fmt({ startTime: at(2026, 11, 22, 8), endTime: at(2026, 11, 22, 12) })).toBe("Sun, Nov 22 · 8:00 AM");
  });
  it("another year carries the year", () => {
    expect(fmt({ startTime: at(2027, 1, 3, 19, 30) })).toBe("Sun, Jan 3, 2027 · 7:30 PM");
  });
  it("an all-day event has no time", () => {
    expect(fmt({ startDate: "2026-11-22" })).toBe("Sun, Nov 22");
  });
  it("several days: first and last day", () => {
    expect(fmt({ startDate: "2026-11-22", endDate: "2026-11-24" })).toBe("Nov 22 – Nov 24");
  });
  it("no date at all says so", () => {
    expect(fmt({})).toBe("No date");
  });
});
