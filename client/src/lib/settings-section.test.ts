/**
 * Settings shows one section at a time (owner call, 2026-09-28: the long page
 * with a pinned "jump to" bar didn't look good). The address decides which:
 * ?section=… from the section picker, or an anchor from an older link like
 * /settings#news-alerts that must still land in the right place.
 */
import { describe, it, expect } from "vitest";
import { settingsSectionFor } from "./settings-section";

const ALL = ["appearance", "feed", "network", "safety", "tools", "help", "account"];
const GUEST = ["appearance", "feed", "network", "safety", "help"];

describe("settingsSectionFor", () => {
  it("opens on the first section when the address names none", () => {
    expect(settingsSectionFor({ search: "", hash: "" }, ALL)).toBe("appearance");
  });

  it("opens the section the address names", () => {
    expect(settingsSectionFor({ search: "?section=safety", hash: "" }, ALL)).toBe("safety");
  });

  it("an older anchor link opens the section that holds it", () => {
    expect(settingsSectionFor({ search: "", hash: "#news-alerts" }, ALL)).toBe("feed");
    expect(settingsSectionFor({ search: "", hash: "#content-prefs" }, ALL)).toBe("feed");
  });

  it("an anchor that is itself a section opens it", () => {
    expect(settingsSectionFor({ search: "", hash: "#network" }, ALL)).toBe("network");
  });

  it("a section this viewer can't see falls back to the first", () => {
    expect(settingsSectionFor({ search: "?section=account", hash: "" }, GUEST)).toBe("appearance");
  });

  it("an unknown name falls back to the first", () => {
    expect(settingsSectionFor({ search: "?section=nope", hash: "#nothing" }, ALL)).toBe("appearance");
  });
});
