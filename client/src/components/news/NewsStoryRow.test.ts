/**
 * One calm row for every story on the News page (2026-09). Replaces the hero,
 * rail tiles, grid tiles, stacked cards and podcast cards the page used to mix
 * on one screen. Server-rendered (react-dom/server), so no DOM is needed.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { NewsStoryRow } from "./NewsStoryRow";

const story = {
  title: "Trump ally resigns from post leading inquiry",
  sourceName: "The Guardian World",
  timeLabel: "24 minutes ago",
  isRead: false,
  onOpen: () => {},
};

describe("NewsStoryRow — one calm row for every story", () => {
  it("shows a story without a usable picture as a text row: no image and no placeholder box", () => {
    const html = renderToString(createElement(NewsStoryRow, { ...story, variant: "row", image: null }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-news-image");
    expect(html).toContain("Trump ally resigns from post leading inquiry");
    expect(html).toContain("The Guardian World");
  });

  it("shows the lead as the same story, bigger, with its picture and no 'Top story' badge", () => {
    const html = renderToString(
      createElement(NewsStoryRow, {
        ...story,
        variant: "lead",
        image: { url: "https://i.guim.co.uk/photo.jpg?width=1200", fit: "lead", verified: true },
      }),
    );
    expect(html).toContain("data-news-image");
    expect(html).toContain("https://i.guim.co.uk/photo.jpg?width=1200");
    expect(html.toLowerCase()).not.toContain("top story");
    expect(html).toContain("24 minutes ago");
  });
});
