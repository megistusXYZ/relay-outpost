import { describe, it, expect } from "vitest";
import { formatCompactTime } from "./time";

const NOW = 1_700_000_000_000; // fixed nowMs
const sec = (agoSeconds: number) => NOW / 1000 - agoSeconds;

describe("formatCompactTime", () => {
  it("shows 'now' for very recent", () => {
    expect(formatCompactTime(sec(0), NOW)).toBe("now");
    expect(formatCompactTime(sec(44), NOW)).toBe("now");
  });
  it("minutes / hours / days / weeks", () => {
    expect(formatCompactTime(sec(60), NOW)).toBe("1m");
    expect(formatCompactTime(sec(59 * 60), NOW)).toBe("59m");
    expect(formatCompactTime(sec(3 * 3600), NOW)).toBe("3h");
    expect(formatCompactTime(sec(2 * 86400), NOW)).toBe("2d");
    expect(formatCompactTime(sec(3 * 604800), NOW)).toBe("3w");
  });
  it("falls back to a short date for older than ~a month", () => {
    const out = formatCompactTime(sec(90 * 86400), NOW);
    expect(out).not.toMatch(/[mhdw]$/); // not a relative unit
    expect(out.length).toBeGreaterThan(2);
  });
  it("never shows a future negative", () => {
    expect(formatCompactTime(sec(-100), NOW)).toBe("now");
  });
});
