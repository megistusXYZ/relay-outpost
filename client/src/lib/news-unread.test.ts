import { describe, it, expect } from "vitest";
import {
  countPriorityUnread,
  isFreshForUnread,
  shouldShowWorthYourTime,
  UNREAD_FRESHNESS_HOURS,
  type PriorityCountable,
} from "./news-unread";
import { tierForScore, ALERT_MIN } from "./news-scoring";

const H = 3_600_000;
const NOW = Date.parse("2026-07-17T12:00:00Z");

const item = (over: Partial<PriorityCountable> & { id: string }): PriorityCountable => ({
  tier: "alert",
  timeMs: NOW - H,
  title: `Title ${over.id}`,
  ...over,
});

describe("tier boundary (score >= 70 counts)", () => {
  it("maps the ALERT_MIN boundary onto the counting tiers", () => {
    // 70 = tier "alert" (counts); 69 = tier "feed" (never counts).
    expect(tierForScore(ALERT_MIN)).toBe("alert");
    expect(tierForScore(ALERT_MIN - 1)).toBe("feed");
    const out = countPriorityUnread(
      [
        item({ id: "a", tier: tierForScore(ALERT_MIN) }),
        item({ id: "b", tier: tierForScore(ALERT_MIN - 1) }),
        item({ id: "c", tier: "priority" }),
        item({ id: "d", tier: "low" }),
      ],
      () => false,
      NOW,
    );
    expect(out.count).toBe(2); // a (alert) + c (priority)
  });
});

describe("72h freshness window", () => {
  it("counts items exactly at the boundary, drops items past it", () => {
    const out = countPriorityUnread(
      [
        item({ id: "edge", timeMs: NOW - UNREAD_FRESHNESS_HOURS * H }),
        item({ id: "stale", timeMs: NOW - UNREAD_FRESHNESS_HOURS * H - 1 }),
        item({ id: "fresh", timeMs: NOW - H }),
      ],
      () => false,
      NOW,
    );
    expect(out.count).toBe(2); // edge (inclusive) + fresh
  });

  it("future-dated items count (clock skew must not hide a new story)", () => {
    expect(isFreshForUnread(NOW + 2 * H, NOW)).toBe(true);
    expect(countPriorityUnread([item({ id: "f", timeMs: NOW + 2 * H })], () => false, NOW).count).toBe(1);
  });

  it("unknown/unparseable dates never count", () => {
    expect(isFreshForUnread(undefined, NOW)).toBe(false);
    expect(isFreshForUnread(NaN, NOW)).toBe(false);
    const out = countPriorityUnread(
      [item({ id: "nodate", timeMs: undefined }), item({ id: "nan", timeMs: NaN })],
      () => false,
      NOW,
    );
    expect(out.count).toBe(0);
    expect(out.topTitle).toBeNull();
  });

  it("respects a custom window", () => {
    const out = countPriorityUnread([item({ id: "a", timeMs: NOW - 30 * H })], () => false, NOW, {
      windowH: 24,
    });
    expect(out.count).toBe(0);
  });
});

describe("read exclusion + hygiene", () => {
  it("excludes read items", () => {
    const read = new Set(["a"]);
    const out = countPriorityUnread(
      [item({ id: "a" }), item({ id: "b" })],
      (id) => read.has(id),
      NOW,
    );
    expect(out.count).toBe(1);
    expect(out.topId).toBe("b");
  });

  it("dedupes by id and skips unkeyed items", () => {
    const out = countPriorityUnread(
      [item({ id: "a" }), item({ id: "a" }), item({ id: "" })],
      () => false,
      NOW,
    );
    expect(out.count).toBe(1);
  });

  it("teaser is the newest counted headline", () => {
    const out = countPriorityUnread(
      [
        item({ id: "older", timeMs: NOW - 10 * H, title: "Older" }),
        item({ id: "newest", timeMs: NOW - H, title: "Newest" }),
        item({ id: "read-newer", timeMs: NOW, title: "Read newer" }),
        item({ id: "stale-newest", timeMs: NOW - 100 * H, title: "Stale" }),
      ],
      (id) => id === "read-newer",
      NOW,
    );
    expect(out.topTitle).toBe("Newest");
    expect(out.count).toBe(2);
  });

  it("is quiet on empty input", () => {
    expect(countPriorityUnread([], () => false, NOW)).toEqual({ count: 0, topTitle: null, topId: null });
  });
});

describe('"Worth your time" visibility (hide-when-zero)', () => {
  it("shows only when at least one fresh priority item is counted", () => {
    expect(shouldShowWorthYourTime(0)).toBe(false);
    expect(shouldShowWorthYourTime(1)).toBe(true);
    expect(shouldShowWorthYourTime(7)).toBe(true);
  });

  it("hides the strip when tier 1–2 items exist but are all stale (the backlog case)", () => {
    // Mirrors the exact screenshot: real priority-tier items are present, but
    // every one is past the freshness window — so the count is 0 and the strip
    // must hide entirely rather than showing a "0" zero-state.
    const staleAlerts = [
      item({ id: "a", tier: "alert", timeMs: NOW - 100 * H }),
      item({ id: "b", tier: "priority", timeMs: NOW - 200 * H }),
    ];
    const { count } = countPriorityUnread(staleAlerts, () => false, NOW);
    expect(count).toBe(0);
    expect(shouldShowWorthYourTime(count)).toBe(false);
  });

  it("shows the strip once a fresh priority item appears", () => {
    const mixed = [
      item({ id: "stale", tier: "alert", timeMs: NOW - 100 * H }),
      item({ id: "fresh", tier: "priority", timeMs: NOW - H }),
    ];
    const { count } = countPriorityUnread(mixed, () => false, NOW);
    expect(count).toBe(1);
    expect(shouldShowWorthYourTime(count)).toBe(true);
  });
});
