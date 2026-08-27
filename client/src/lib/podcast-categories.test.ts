import { describe, it, expect } from "vitest";
import { podcastCategoryNames } from "./podcast-categories";

describe("podcastCategoryNames (crash class: server ships an id→name MAP, old clients expected an array)", () => {
  it("converts the Podcast Index map shape to names", () => {
    expect(podcastCategoryNames({ "55": "News", "59": "Politics" })).toEqual(["News", "Politics"]);
  });

  it("passes a legacy string array through", () => {
    expect(podcastCategoryNames(["News", "Politics"])).toEqual(["News", "Politics"]);
  });

  it("never throws on null/undefined/garbage — returns []", () => {
    expect(podcastCategoryNames(null)).toEqual([]);
    expect(podcastCategoryNames(undefined)).toEqual([]);
    expect(podcastCategoryNames("News")).toEqual([]);
    expect(podcastCategoryNames(42)).toEqual([]);
  });

  it("drops non-string values inside either shape", () => {
    expect(podcastCategoryNames(["News", 7, null])).toEqual(["News"]);
    expect(podcastCategoryNames({ "1": "Arts", "2": 9 })).toEqual(["Arts"]);
  });
});
