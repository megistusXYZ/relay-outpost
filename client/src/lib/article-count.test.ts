/**
 * The profile's "N articles" (owner, 2026-10-12: it said 2 while the list
 * showed 1). The index counts every version of an edited article; our own
 * list is one per article. Once our list has answered, it is the count; the
 * index's number only stands in before that.
 */
import { describe, it, expect } from "vitest";
import { articleCountToShow } from "./article-count";

describe("articleCountToShow", () => {
  it("uses our own answered list, one per article, over the index's count", () => {
    expect(articleCountToShow({ loaded: true, ours: 1, index: 2 })).toBe(1);
  });
  it("shows the index's number only before our list has answered", () => {
    expect(articleCountToShow({ loaded: false, ours: 0, index: 2 })).toBe(2);
    expect(articleCountToShow({ loaded: false, ours: 0, index: undefined })).toBeUndefined();
  });
  it("an answered empty list is zero, not the index's stale number", () => {
    expect(articleCountToShow({ loaded: true, ours: 0, index: 2 })).toBe(0);
  });
});
