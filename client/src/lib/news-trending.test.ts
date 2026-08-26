import { describe, it, expect } from "vitest";
import { annotateReadState, countNewSince, type TrendingStory } from "./news-trending";

const story = (o: Partial<TrendingStory> & { title: string }): TrendingStory => ({
  link: `https://x.test/${o.title}`,
  source: "BBC",
  sources: ["BBC"],
  outletCount: 1,
  thumbnail: "",
  description: "",
  pubDate: new Date(1_800_000_000_000).toISOString(),
  memberLinks: [],
  ...o,
});

describe("annotateReadState", () => {
  it("dims read stories but NEVER reorders — rank leads, read is a visual", () => {
    const stories = [story({ title: "a" }), story({ title: "b" }), story({ title: "c" })];
    const readSet = new Set([stories[1].link]); // 'b' is read
    const out = annotateReadState(stories, readSet);
    expect(out.map((s) => s.title)).toEqual(["a", "b", "c"]); // order untouched
    expect(out.map((s) => s.read)).toEqual([false, true, false]);
  });

  it("marks the whole cluster read when ANY member outlet's copy was read", () => {
    const s = story({ title: "big", link: "https://bbc.test/x", memberLinks: ["https://reuters.test/x"] });
    // The user read Reuters' copy, not BBC's lead link.
    const out = annotateReadState([s], new Set(["https://reuters.test/x"]));
    expect(out[0].read).toBe(true);
  });

  it("leaves everything unread against an empty ledger", () => {
    const out = annotateReadState([story({ title: "a" })], new Set());
    expect(out[0].read).toBe(false);
  });
});

describe("countNewSince", () => {
  it("counts stories newer than the last look", () => {
    const base = 1_800_000_000_000;
    const stories = [
      story({ title: "old", pubDate: new Date(base - 10_000).toISOString() }),
      story({ title: "new1", pubDate: new Date(base + 10_000).toISOString() }),
      story({ title: "new2", pubDate: new Date(base + 20_000).toISOString() }),
    ];
    expect(countNewSince(stories, base)).toBe(2);
  });

  it("returns 0 when there is no reference time (first visit)", () => {
    expect(countNewSince([story({ title: "a" })], 0)).toBe(0);
  });
});
