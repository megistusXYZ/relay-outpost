/**
 * A second tap on the Activity tab, already at the top, takes you to your
 * first unread item (owner, 2026-09-30). Activity is a stack of sections
 * (mentions, replies, reactions…) that can be collapsed or filtered to one
 * kind, so "first unread" means: the first section, top to bottom, that
 * holds something unread, opened if it was closed.
 */
import { describe, it, expect } from "vitest";
import { firstUnreadSection } from "./activity-first-unread";

const section = (type: string, ...read: boolean[]) => ({ type, items: read.map((r) => ({ read: r })) });

describe("firstUnreadSection", () => {
  it("is the first section from the top holding something unread", () => {
    const grouped = [section("mention", true, true), section("reply", true, false), section("reaction", false)];
    expect(firstUnreadSection(grouped, "all")).toEqual({ type: "reply", showAll: false });
  });

  it("under a filter, stays in the section you're looking at when it has unread", () => {
    const grouped = [section("mention", false), section("reaction", false)];
    expect(firstUnreadSection(grouped, "reaction")).toEqual({ type: "reaction", showAll: false });
  });

  it("under a filter with nothing unread in it, goes back to All to reach the unread", () => {
    const grouped = [section("mention", true), section("reaction", false)];
    expect(firstUnreadSection(grouped, "mention")).toEqual({ type: "reaction", showAll: true });
  });

  it("nothing unread anywhere: nowhere to go", () => {
    expect(firstUnreadSection([section("mention", true), section("reply")], "all")).toBeNull();
    expect(firstUnreadSection([], "all")).toBeNull();
  });
});
