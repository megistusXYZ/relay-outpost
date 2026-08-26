/**
 * The Discover "since you left" store — the honest rubber band. The counting
 * core is id-gated, NOT wall-clock-gated: notification-read.ts documents the
 * shipped bug where `created_at <= lastSeen` silently pre-read late-arriving
 * old items, because lastSeen advances just by opening the page. Here an item
 * is "new" only when its id is absent from the seen set AND it is inside the
 * shared 72h freshness window — and a tile with NO baseline claims nothing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import {
  freshCount,
  mergeSeenIds,
  stampTiles,
  loadSeen,
  SEEN_IDS_CAP,
} from "./discover-freshness";

const NOW = 1_700_000_000_000; // ms
const HOUR = 3_600_000;

const item = (id: string, ageHours: number) => ({ id, timeMs: NOW - ageHours * HOUR });

describe("freshCount", () => {
  it("counts ids the viewer has not seen, inside the 72h window", () => {
    const seen = { at: NOW - 24 * HOUR, seenIds: ["a"] };
    expect(freshCount([item("a", 1), item("b", 2), item("c", 3)], seen, NOW)).toBe(2);
  });

  it("no baseline, no claim — a first visit shows zero, not everything-is-new", () => {
    expect(freshCount([item("a", 1), item("b", 1)], undefined, NOW)).toBe(0);
  });

  it("a late-arriving OLD item never counts (the notification-read lesson)", () => {
    const seen = { at: NOW - 1 * HOUR, seenIds: ["a"] };
    // "b" is unseen but 80h old — it drifted in from a slow relay, it is not news.
    expect(freshCount([item("a", 1), item("b", 80)], seen, NOW)).toBe(0);
  });

  it("an item without a timestamp counts on the id gate alone", () => {
    const seen = { at: NOW - HOUR, seenIds: [] };
    expect(freshCount([{ id: "x" }], seen, NOW)).toBe(1);
  });
});

describe("mergeSeenIds", () => {
  it("keeps newest-first and caps the ledger", () => {
    const existing = Array.from({ length: SEEN_IDS_CAP }, (_, i) => `old${i}`);
    const merged = mergeSeenIds(["fresh1", "fresh2"], existing);
    expect(merged.length).toBe(SEEN_IDS_CAP);
    expect(merged[0]).toBe("fresh1");
    expect(merged).not.toContain(`old${SEEN_IDS_CAP - 1}`);
  });

  it("never duplicates an id", () => {
    expect(mergeSeenIds(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("stampTiles (storage round-trip)", () => {
  beforeEach(() => localStorage.clear());

  it("stamps are monotonic — an older clock never overwrites a newer one", () => {
    stampTiles([{ tile: "videos", ids: ["v1"] }], NOW);
    stampTiles([{ tile: "videos", ids: ["v2"] }], NOW - HOUR);
    const seen = loadSeen().videos!;
    expect(seen.at).toBe(NOW);
    // The older stamp still contributes its ids — seen is seen.
    expect(seen.seenIds).toContain("v1");
    expect(seen.seenIds).toContain("v2");
  });
});
