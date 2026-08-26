import { describe, it, expect } from "vitest";
import { isAdultBirthDate } from "./age-gate";

// Fixed "today" so boundaries are exact: 2026-08-18.
const NOW = new Date(2026, 7, 18, 12, 0, 0);

describe("isAdultBirthDate", () => {
  it("18th birthday today is adult", () => {
    expect(isAdultBirthDate("2008-08-18", NOW)).toBe(true);
  });

  it("18th birthday tomorrow is not adult yet", () => {
    expect(isAdultBirthDate("2008-08-19", NOW)).toBe(false);
  });

  it("clearly adult and clearly minor dates", () => {
    expect(isAdultBirthDate("1990-01-01", NOW)).toBe(true);
    expect(isAdultBirthDate("2015-06-01", NOW)).toBe(false);
  });

  it("fails closed on garbage, impossible, and future dates", () => {
    expect(isAdultBirthDate("", NOW)).toBe(false);
    expect(isAdultBirthDate("not-a-date", NOW)).toBe(false);
    expect(isAdultBirthDate("2008-02-30", NOW)).toBe(false); // Date would roll this over
    expect(isAdultBirthDate("2030-01-01", NOW)).toBe(false);
  });
});
