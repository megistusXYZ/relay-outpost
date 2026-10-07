import { describe, it, expect } from "vitest";
import { SECTIONS, COMMUNITY_SCREENS, ADVANCED_SCREENS, sectionOf, consoleTitle, resolveTab, listOf } from "./console-nav";

// The console, laid out like a community tool people already know (Discord's
// server settings), with plain words (owner, 2026-10-04).
describe("the operator console's sections", () => {
  it("are six, in the order an operator reaches for them", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Overview", "Posts", "People", "Inbox", "Community", "Advanced"]);
    // Ids are the hashes, kept so old links land: #events is Posts, #feedback is Inbox, #settings is Community.
    expect(SECTIONS.map((s) => s.id)).toEqual(["overview", "events", "people", "feedback", "settings", "advanced"]);
  });

  it("Community holds what a community manager sets up and looks after", () => {
    expect(COMMUNITY_SCREENS.map((s) => s.tab)).toEqual(["community", "access", "featured", "contact", "team", "badges", "log", "groups"]);
    expect(COMMUNITY_SCREENS.map((s) => s.label)).toEqual(["Community details", "Who can post", "Featured & announcements", "Member inbox", "Team", "Badges", "Moderation log", "Group chats"]);
  });

  it("Advanced holds what only some people need", () => {
    expect(ADVANCED_SCREENS.map((s) => s.tab)).toEqual(["connection", "card", "scans"]);
    expect(ADVANCED_SCREENS.map((s) => s.label)).toEqual(["Connection & sign-in", "Public card", "Activity & storage"]);
  });

  it("each screen sits in its list, and goes back to it", () => {
    for (const s of COMMUNITY_SCREENS) { expect(sectionOf(s.tab)).toBe("settings"); expect(listOf(s.tab)).toEqual({ tab: "settings", label: "Community" }); }
    for (const s of ADVANCED_SCREENS) { expect(sectionOf(s.tab)).toBe("advanced"); expect(listOf(s.tab)).toEqual({ tab: "advanced", label: "Advanced" }); }
    expect(listOf("overview")).toBeNull();
    expect(listOf("events")).toBeNull();
  });

  it("every old address still lands somewhere sensible", () => {
    const old: Record<string, string> = {
      overview: "overview", live: "live", events: "events", people: "people", feedback: "feedback",
      settings: "settings", community: "community", access: "access", contact: "contact", team: "team", log: "log",
      featured: "featured", connection: "connection",
      // Public card's announcements moved to Featured & announcements; the raw card is Advanced › Public card.
      announce: "featured",
      // Badges came back as the community's own screen (badges-plan step 4, 2026-10-06).
      badges: "badges",
    };
    for (const [hash, tab] of Object.entries(old)) expect(resolveTab(hash)).toBe(tab);
    expect(resolveTab("nonsense")).toBe("overview");
    expect(sectionOf("live")).toBe("events");
  });

  it("names the screen for the page title and the back row", () => {
    expect(consoleTitle("events")).toBe("Posts");
    expect(consoleTitle("settings")).toBe("Community");
    expect(consoleTitle("advanced")).toBe("Advanced");
    expect(consoleTitle("featured")).toBe("Featured & announcements");
    expect(consoleTitle("card")).toBe("Public card");
    expect(consoleTitle("community")).toBe("Community details");
  });
});
