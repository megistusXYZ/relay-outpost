import { describe, it, expect } from "vitest";
import { SECTIONS, SETTINGS_SCREENS, sectionOf, consoleTitle } from "./console-nav";

describe("the operator console's sections", () => {
  it("are five, in the order an operator reaches for them", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "events", "people", "feedback", "settings"]);
    expect(SECTIONS.map((s) => s.label)).toEqual(["Overview", "Content", "People", "Inbox", "Settings"]);
  });

  it("the relay's rules, team and public face live under Settings", () => {
    expect(SETTINGS_SCREENS.map((s) => s.tab)).toEqual(["community", "access", "team", "log", "announce", "featured"]);
    expect(SETTINGS_SCREENS.map((s) => s.label)).toEqual(["Relay settings", "Who can post", "Team", "Moderation log", "Public card", "Featured feeds"]);
  });

  it("every old tab still has a section, so old links land", () => {
    expect(sectionOf("overview")).toBe("overview");
    expect(sectionOf("live")).toBe("events");
    expect(sectionOf("events")).toBe("events");
    // The allow and ban lists became Settings › Who can post; People is new.
    expect(sectionOf("access")).toBe("settings");
    expect(sectionOf("people")).toBe("people");
    expect(sectionOf("feedback")).toBe("feedback");
    for (const tab of ["community", "access", "team", "log", "announce", "featured"] as const) expect(sectionOf(tab)).toBe("settings");
  });

  it("names the screen for the page title and the back row", () => {
    expect(consoleTitle("overview")).toBe("Overview");
    expect(consoleTitle("live")).toBe("Content");
    expect(consoleTitle("featured")).toBe("Featured feeds");
    expect(consoleTitle("access")).toBe("Who can post");
    expect(consoleTitle("people")).toBe("People");
    expect(consoleTitle("settings")).toBe("Settings");
  });
});
