import { describe, it, expect } from "vitest";
import { computeNotificationRead } from "./notification-read";

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

describe("computeNotificationRead", () => {
  it("marks an explicitly-read id read regardless of timestamps", () => {
    const read = computeNotificationRead("abc", NOW, {
      readIds: new Set(["abc"]),
      alreadySeen: false,
      lastSeen: 0,
    });
    expect(read).toBe(true);
  });

  it("keeps a FIRST-TIME arrival unread even when its created_at predates lastSeen (the days-behind fix)", () => {
    // Authored 3 days ago, reaching us now for the first time; we've visited the
    // page since (lastSeen recent). Old code marked this read → no badge. Now unread.
    const read = computeNotificationRead("late", NOW - 3 * DAY, {
      readIds: new Set(),
      alreadySeen: false, // first-time arrival
      lastSeen: NOW,
    });
    expect(read).toBe(false);
  });

  it("treats a historical (already-seen) old event as read once the list was opened past it", () => {
    const read = computeNotificationRead("old", NOW - 3 * DAY, {
      readIds: new Set(),
      alreadySeen: true, // re-delivery / cache seed of something we saw before
      lastSeen: NOW,
    });
    expect(read).toBe(true);
  });

  it("keeps a historical event newer than lastSeen unread", () => {
    const read = computeNotificationRead("recent", NOW, {
      readIds: new Set(),
      alreadySeen: true,
      lastSeen: NOW - DAY,
    });
    expect(read).toBe(false);
  });

  it("is unread when the list has never been opened (lastSeen 0) and it's not marked read", () => {
    expect(computeNotificationRead("x", NOW, { readIds: new Set(), alreadySeen: true, lastSeen: 0 })).toBe(false);
    expect(computeNotificationRead("x", NOW, { readIds: new Set(), alreadySeen: false, lastSeen: 0 })).toBe(false);
  });
});
