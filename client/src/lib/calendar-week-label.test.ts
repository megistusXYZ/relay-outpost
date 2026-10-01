/**
 * The week ribbon names the days it shows. QA 2026-10-01: it said "OCTOBER"
 * over Sep 27 – Oct 3, a month that applied to three of the seven days.
 */
import { describe, it, expect } from "vitest";
import { weekRangeLabel } from "./calendar-week-label";

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("weekRangeLabel", () => {
  it("a week inside one month: the month once, then the day range", () => {
    expect(weekRangeLabel(local(2026, 10, 4))).toBe("Oct 4 – 10");
  });

  it("a week across two months names both", () => {
    expect(weekRangeLabel(local(2026, 9, 27))).toBe("Sep 27 – Oct 3");
  });

  it("a week across the year boundary names the year it ends in", () => {
    expect(weekRangeLabel(local(2026, 12, 27))).toBe("Dec 27 – Jan 2, 2027");
  });
});
