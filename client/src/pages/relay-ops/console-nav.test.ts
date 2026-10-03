import { describe, it, expect } from "vitest";
import { SECTIONS, SETTINGS_SCREENS, sectionOf, consoleTitle } from "./console-nav";

describe("the operator console's sections", () => {
  it("are six, in the order an operator reaches for them", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "live", "events", "access", "feedback", "settings"]);
    expect(SECTIONS.map((s) => s.label)).toEqual(["Overview", "Live", "Events", "Access", "Feedback", "Settings"]);
  });

  it("the relay's public face lives under Settings, as three screens", () => {
    expect(SETTINGS_SCREENS.map((s) => s.tab)).toEqual(["community", "announce", "featured"]);
    expect(SETTINGS_SCREENS.map((s) => s.label)).toEqual(["Relay settings", "Public card", "Featured feeds"]);
  });

  it("every old tab still has a section, so old links land", () => {
    expect(sectionOf("overview")).toBe("overview");
    expect(sectionOf("live")).toBe("live");
    expect(sectionOf("events")).toBe("events");
    expect(sectionOf("access")).toBe("access");
    expect(sectionOf("feedback")).toBe("feedback");
    for (const tab of ["community", "announce", "featured"] as const) expect(sectionOf(tab)).toBe("settings");
  });

  it("names the screen for the page title and the back row", () => {
    expect(consoleTitle("overview")).toBe("Overview");
    expect(consoleTitle("featured")).toBe("Featured feeds");
    expect(consoleTitle("settings")).toBe("Settings");
  });
});
