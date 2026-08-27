/**
 * Video seen-ledger (lib/video-seen.ts) — "an endless feed of videos they've
 * never seen" (owner request, 2026-08-26) needs a memory of what this device
 * has already shown. Per-device, capped, and consulted as a SNAPSHOT at feed
 * build time — marks made while scrolling must never reorder the grid under
 * the reader (the feed-stability rule VideoFeed already documents).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

const __local = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__local.has(k) ? __local.get(k)! : null),
  setItem: (k: string, v: string) => { __local.set(k, String(v)); },
  removeItem: (k: string) => { __local.delete(k); },
});

import { markVideosSeen, readSeenVideos, orderUnseenFirst } from "./video-seen";

beforeEach(() => { __local.clear(); });

describe("seen ledger", () => {
  it("remembers marked ids across reads", () => {
    markVideosSeen(["a", "b"]);
    markVideosSeen(["b", "c"]);
    const seen = readSeenVideos();
    expect(seen.has("a")).toBe(true);
    expect(seen.has("c")).toBe(true);
    expect(seen.size).toBe(3);
  });

  it("caps the ledger, keeping the newest marks", () => {
    markVideosSeen(Array.from({ length: 3500 }, (_, i) => `v${i}`));
    const seen = readSeenVideos();
    expect(seen.size).toBeLessThanOrEqual(3000);
    expect(seen.has("v3499")).toBe(true);
  });

  it("answers empty on corrupted storage, never throws", () => {
    __local.set("ro_video_seen_v1", "{nope");
    expect(readSeenVideos().size).toBe(0);
    markVideosSeen(["a"]);
    expect(readSeenVideos().has("a")).toBe(true);
  });
});

describe("orderUnseenFirst", () => {
  const entry = (id: string) => ({ event: { id } });

  it("puts never-seen videos ahead while preserving each group's own order", () => {
    const out = orderUnseenFirst(
      [entry("seen1"), entry("new1"), entry("seen2"), entry("new2")],
      new Set(["seen1", "seen2"]),
    );
    expect(out.map((e) => e.event.id)).toEqual(["new1", "new2", "seen1", "seen2"]);
  });

  it("is a no-op when nothing was seen", () => {
    const list = [entry("a"), entry("b")];
    expect(orderUnseenFirst(list, new Set())).toEqual(list);
  });
});
