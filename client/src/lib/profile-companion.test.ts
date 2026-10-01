import { describe, it, expect } from "vitest";
import { timeChapter, streamChapters, currentChapter, mediaForChapter, type CompanionMedia } from "./profile-companion";

// Wednesday 2026-09-30, noon local.
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 10) => Math.floor(new Date(y, m - 1, d, h).getTime() / 1000);

describe("timeChapter", () => {
  it("names the stretch a post belongs to, nearest first", () => {
    expect(timeChapter(at(2026, 9, 30), NOW)).toBe("Today");
    expect(timeChapter(at(2026, 9, 29), NOW)).toBe("Yesterday");
    expect(timeChapter(at(2026, 9, 26), NOW)).toBe("This week");
    expect(timeChapter(at(2026, 9, 10), NOW)).toBe("This month");
    expect(timeChapter(at(2026, 7, 4), NOW)).toMatch(/2026/);
    expect(timeChapter(at(2026, 7, 4), NOW)).not.toBe(timeChapter(at(2026, 6, 4), NOW));
  });
});

describe("streamChapters — the spine's rows", () => {
  it("lists each chapter once, in the order the stream shows them", () => {
    const items = [at(2026, 9, 30), at(2026, 9, 30, 8), at(2026, 9, 29), at(2026, 9, 27), at(2026, 9, 26), at(2026, 9, 5)].map((ts) => ({ ts }));
    expect(streamChapters(items, NOW)).toEqual(["Today", "Yesterday", "This week", "This month"]);
  });

  it("an empty stream has no spine", () => {
    expect(streamChapters([], NOW)).toEqual([]);
  });

  it("carries labels only: nothing about how many posts a stretch holds", () => {
    const busy = Array.from({ length: 50 }, () => ({ ts: at(2026, 9, 30) }));
    const quiet = [{ ts: at(2026, 9, 30) }];
    expect(streamChapters(busy, NOW)).toEqual(streamChapters(quiet, NOW));
  });
});

describe("currentChapter — where the reader is", () => {
  const headings = [
    { label: "Today", top: -900 },
    { label: "This week", top: -200 },
    { label: "This month", top: 480 },
  ];

  it("is the last heading that has passed the reading line", () => {
    expect(currentChapter(headings, 120)).toBe("This week");
    expect(currentChapter(headings, 500)).toBe("This month");
  });

  it("is the first chapter at the top of the page, before any heading has passed", () => {
    expect(currentChapter([{ label: "Today", top: 300 }, { label: "This week", top: 900 }], 120)).toBe("Today");
  });

  it("is nothing when there are no headings", () => {
    expect(currentChapter([], 120)).toBeNull();
  });
});

describe("mediaForChapter — 'From this time'", () => {
  const m = (eventId: string, chapter: string): CompanionMedia => ({ eventId, url: `https://img.test/${eventId}.jpg`, isVideo: false, chapter });
  const media = [m("a", "Today"), m("b", "Today"), m("c", "This week"), m("d", "July 2026"), m("e", "July 2026"), m("f", "July 2026")];

  it("shows the pictures from the stretch being read, capped", () => {
    expect(mediaForChapter(media, "July 2026", 2)).toEqual({ label: "July 2026", items: [media[3], media[4]], fallback: false });
  });

  it("a stretch with no pictures falls back to the most recent ones, labelled Recent", () => {
    const r = mediaForChapter(media, "This month", 3);
    expect(r.fallback).toBe(true);
    expect(r.label).toBe("Recent");
    expect(r.items.map((x) => x.eventId)).toEqual(["a", "b", "c"]);
  });

  it("someone who posts no pictures gets no panel", () => {
    expect(mediaForChapter([], "Today").items).toEqual([]);
  });
});
