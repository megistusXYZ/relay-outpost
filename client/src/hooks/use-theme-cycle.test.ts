// @vitest-environment jsdom
/**
 * The theme toggle's cycle order is a product decision (owner, 2026-08-18):
 * descending brightness, light → dark → black, wrapping. Every toggle surface
 * (OrbitMenu dock, Account row, stories rail) calls toggleTheme() and inherits
 * this order — pin it here so a refactor can't quietly reorder or drop the
 * black stop.
 *
 * Imported from its own module-under-test via dynamic import inside the test:
 * use-theme.ts applies the theme to document at module load, so it needs the
 * happy-dom environment this suite runs under anyway.
 */
import { describe, expect, it } from "vitest";
import { nextTheme } from "./use-theme";

describe("theme cycle", () => {
  it("cycles light → dark → black → light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("black");
    expect(nextTheme("black")).toBe("light");
  });
});
