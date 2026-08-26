// Per-channel unread compare logic behind the Concord channel-list dots.
import { describe, it, expect } from "vitest";
import { newestActivity, isChannelUnread, computeUnreadChannels } from "./concord-channel-unread";

describe("newestActivity", () => {
  it("takes the max of the provided clocks", () => {
    expect(newestActivity(100, 300, 200)).toBe(300);
  });

  it("ignores undefined and zero sources", () => {
    expect(newestActivity(undefined, 0, 150)).toBe(150);
    expect(newestActivity(undefined, undefined)).toBe(0);
    expect(newestActivity()).toBe(0);
  });

  it("is monotonic under merge: adding a source never lowers the result", () => {
    const base = newestActivity(500, 200);
    expect(newestActivity(500, 200, 100)).toBe(base);
    expect(newestActivity(500, 200, 900)).toBeGreaterThanOrEqual(base);
  });
});

describe("isChannelUnread", () => {
  it("unread when activity is newer than the read mark", () => {
    expect(isChannelUnread(1000, 500)).toBe(true);
  });

  it("read when the mark is at or past the newest activity", () => {
    expect(isChannelUnread(1000, 1000)).toBe(false);
    expect(isChannelUnread(1000, 2000)).toBe(false);
  });

  it("never-read (mark 0) with known activity is unread", () => {
    expect(isChannelUnread(1, 0)).toBe(true);
  });

  it("unknown channel (no known activity) is never unread", () => {
    expect(isChannelUnread(undefined, 0)).toBe(false);
    expect(isChannelUnread(0, 0)).toBe(false);
  });
});

describe("computeUnreadChannels", () => {
  const latest = new Map<string, number>([
    ["general", 1000],
    ["dev", 400],
    ["quiet", 0],
  ]);
  const reads: Record<string, number> = { general: 500, dev: 400 };
  const lastRead = (id: string) => reads[id] ?? 0;

  it("collects only channels with newer-than-read activity", () => {
    const out = computeUnreadChannels(["general", "dev", "quiet", "unknown"], latest, lastRead);
    expect(out).toEqual(new Set(["general"]));
  });

  it("excludes the active channel even when it has newer activity", () => {
    const out = computeUnreadChannels(["general", "dev"], latest, lastRead, "general");
    expect(out).toEqual(new Set());
  });

  it("never-read channel with activity gets a dot; unknown channel does not", () => {
    const l = new Map<string, number>([["fresh", 123]]);
    const out = computeUnreadChannels(["fresh", "ghost"], l, () => 0);
    expect(out).toEqual(new Set(["fresh"]));
  });
});
