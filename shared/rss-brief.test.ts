import { describe, expect, it } from "vitest";
import { briefFeed, feedFreshFor, isBriefFeed, FEED_FRESH_MS } from "./rss-brief";

const full = () => ({
  title: "Harbour Gazette",
  link: "https://gazette.example/",
  image: "https://gazette.example/mast.png",
  isPodcast: false,
  items: [
    { title: "Lanterns go up on Thursday", link: "https://gazette.example/1", description: "Bring a torch.", fullContent: "<p>" + "Long article text. ".repeat(400) + "</p>", pubDate: "Sat, 21 Nov 2026 10:00:00 GMT", thumbnail: "https://gazette.example/1.jpg", thumbnailWidth: 1200 },
    { title: "Ferry timetable changes", link: "https://gazette.example/2", description: "From Monday.", fullContent: "<p>Short.</p>", pubDate: "Sat, 21 Nov 2026 08:00:00 GMT", thumbnail: "" },
  ],
});

describe("briefFeed: a feed's headlines without every article's full text", () => {
  it("drops the article text from every item and says it did", () => {
    const b = briefFeed(full());
    expect(b.brief).toBe(true);
    expect(b.items.map((i) => i.fullContent)).toEqual(["", ""]);
  });

  it("keeps everything a headline needs: title, link, summary, date, picture", () => {
    const b = briefFeed(full());
    expect(b.title).toBe("Harbour Gazette");
    expect(b.image).toBe("https://gazette.example/mast.png");
    expect(b.items[0]).toMatchObject({
      title: "Lanterns go up on Thursday",
      link: "https://gazette.example/1",
      description: "Bring a torch.",
      pubDate: "Sat, 21 Nov 2026 10:00:00 GMT",
      thumbnail: "https://gazette.example/1.jpg",
      thumbnailWidth: 1200,
    });
  });

  it("is a fraction of the size", () => {
    const whole = JSON.stringify(full()).length;
    const lean = JSON.stringify(briefFeed(full())).length;
    expect(whole).toBeGreaterThan(7000);
    expect(lean).toBeLessThan(800);
  });

  it("leaves the feed it was given whole: the server keeps serving full articles from its cache", () => {
    const kept = full();
    briefFeed(kept);
    expect(kept.items[0].fullContent.length).toBeGreaterThan(7000);
    expect("brief" in kept).toBe(false);
  });

  it("copes with a feed that has no items", () => {
    expect(briefFeed({ title: "Empty" } as { title: string; items?: { fullContent?: string }[] }).items).toEqual([]);
  });
});

describe("feedFreshFor: how long a cached feed can stand in for a new request", () => {
  it("a full feed is good for ten minutes", () => {
    expect(FEED_FRESH_MS).toBe(600_000);
    expect(feedFreshFor(full())).toBe(600_000);
  });

  it("a brief feed is never fresh for a reader that needs the articles: ask again", () => {
    expect(feedFreshFor(briefFeed(full()))).toBe(0);
  });

  it("nothing cached yet counts as a full feed's window", () => {
    expect(feedFreshFor(undefined)).toBe(600_000);
  });

  it("isBriefFeed only trusts the mark, not an article that happens to be empty", () => {
    expect(isBriefFeed(briefFeed(full()))).toBe(true);
    expect(isBriefFeed({ items: [{ fullContent: "" }] })).toBe(false);
    expect(isBriefFeed(null)).toBe(false);
  });
});
