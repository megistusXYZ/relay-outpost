/**
 * EventDetails — everything about a calendar event, readable in full.
 *
 * Reported 2026-09-10 (phone screenshot, Search → Events): users couldn't tap
 * an event card to read the whole event. The card clamps the description to
 * two lines and cuts it at 180 characters, and there was no detail view.
 * Presentational — no store, no hooks, the "when" line comes in formatted —
 * so it is tested with a server render.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { EventDetails } from "./EventDetails";
import type { CalendarEventData } from "@/lib/calendar-events";

const LONG_DESCRIPTION = [
  "A public birding event hosted by Travis Audubon in the Austin area. ".repeat(3).trim(),
  "Details and registration: https://travisaudubon.org/events/karst-canyon",
  "",
  "Bring water and binoculars.",
].join("\n");

const baseEvent: CalendarEventData = {
  id: "e".repeat(64),
  pubkey: "a".repeat(64),
  dTag: "bird-walk",
  title: "Bird Walk at Karst Canyon Preserve in Hays County",
  description: LONG_DESCRIPTION,
  image: "https://img.example.com/bird.jpg",
  location: "Austin, TX",
  hashtags: ["birding"],
  participants: [],
  references: [],
  kind: 31923,
  event: { id: "e".repeat(64), pubkey: "a".repeat(64), kind: 31923, created_at: 0, tags: [], content: "", sig: "" },
};

const render = (over: Partial<CalendarEventData> = {}) =>
  renderToString(createElement(EventDetails, {
    ce: { ...baseEvent, ...over },
    when: "Sep 4, 2026 · 7:30 AM – 10:00 AM",
    host: { name: "Travis Audubon" },
  }));

describe("EventDetails — the whole event, not the card's excerpt", () => {
  it("shows the full description past the card's 180-character cut, line breaks kept", () => {
    expect(LONG_DESCRIPTION.length).toBeGreaterThan(180);
    const html = render();
    expect(html).toContain("Bring water and binoculars.");
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("makes links in the description and the location tappable", () => {
    const html = render({ location: "https://meet.example.com/room" });
    expect(html).toContain('href="https://travisaudubon.org/events/karst-canyon"');
    expect(html).toContain('href="https://meet.example.com/room"');
  });

  it("shows the title, when, where and who is hosting", () => {
    const html = render();
    expect(html).toContain("Bird Walk at Karst Canyon Preserve in Hays County");
    expect(html).toContain("Sep 4, 2026 · 7:30 AM – 10:00 AM");
    expect(html).toContain("Austin, TX");
    expect(html).toContain("Travis Audubon");
  });

  it("shows the event image when there is one, and no image otherwise", () => {
    expect(render()).toContain('src="https://img.example.com/bird.jpg"');
    expect(render({ image: undefined })).not.toContain("<img");
  });

  it("shows the hashtags", () => {
    expect(render()).toContain("#birding");
  });

  it("leaves out the description section when there is none", () => {
    expect(render({ description: "" })).not.toContain('data-testid="event-details-description"');
  });
});
