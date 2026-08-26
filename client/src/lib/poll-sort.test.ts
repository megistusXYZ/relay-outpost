// Locks the Saved Polls sheet contract (SavedOptionsSheet → PollsFeed):
//  - Sort: Trending (hot score — votes weighted by recency), Latest (newest),
//    Ending soon ("expiring": soonest close first; no-end-time polls after;
//    already-closed polls last).
//  - Show: Open (default — polls whose end time has passed are hidden) / All.
// "trending"/"expiring" share the For You polls surface's value vocabulary and
// hot-score formula, so the two surfaces sort identically.

import { describe, it, expect } from "vitest";
import type { Event } from "nostr-tools";
import {
  getPollExpiration, isPollOpen, filterPollsByShow, sortPolls, pollHotScore,
} from "./poll-sort";

const NOW = 1_800_000_000; // fixed "now" (unix seconds) for determinism

function poll(id: string, opts: { createdAt?: number; expiration?: number | string } = {}): Event {
  const tags: string[][] = [["option", `${id}-a`, "Yes"], ["option", `${id}-b`, "No"]];
  if (opts.expiration !== undefined) tags.push(["expiration", String(opts.expiration)]);
  return {
    id,
    kind: 1068,
    pubkey: "p".repeat(64),
    created_at: opts.createdAt ?? NOW - 3600,
    content: `poll ${id}`,
    tags,
    sig: "s".repeat(128),
  };
}

const ids = (evts: Event[]) => evts.map((e) => e.id);

describe("getPollExpiration", () => {
  it("reads the expiration tag as unix seconds", () => {
    expect(getPollExpiration(poll("a", { expiration: NOW + 60 }))).toBe(NOW + 60);
  });

  it("null when there is no expiration tag", () => {
    expect(getPollExpiration(poll("a"))).toBeNull();
  });

  it("null when the tag value is not a number", () => {
    expect(getPollExpiration(poll("a", { expiration: "soon" }))).toBeNull();
  });
});

describe("isPollOpen", () => {
  it("no end time → open", () => {
    expect(isPollOpen(poll("a"), NOW)).toBe(true);
  });

  it("future end time → open, past end time → closed", () => {
    expect(isPollOpen(poll("a", { expiration: NOW + 1 }), NOW)).toBe(true);
    expect(isPollOpen(poll("b", { expiration: NOW - 1 }), NOW)).toBe(false);
  });

  it("end time exactly now → still open (matches the feed fetcher's boundary)", () => {
    expect(isPollOpen(poll("a", { expiration: NOW }), NOW)).toBe(true);
  });
});

describe("filterPollsByShow", () => {
  const open = poll("open", { expiration: NOW + 600 });
  const endless = poll("endless");
  const closed = poll("closed", { expiration: NOW - 600 });

  it('"open" hides polls whose end time has passed', () => {
    expect(ids(filterPollsByShow([open, closed, endless], "open", NOW))).toEqual(["open", "endless"]);
  });

  it('"all" keeps everything, order untouched', () => {
    expect(ids(filterPollsByShow([open, closed, endless], "all", NOW))).toEqual(["open", "closed", "endless"]);
  });
});

describe("sortPolls: latest", () => {
  it("newest first", () => {
    const a = poll("a", { createdAt: NOW - 30 });
    const b = poll("b", { createdAt: NOW - 10 });
    const c = poll("c", { createdAt: NOW - 20 });
    expect(ids(sortPolls([a, b, c], "latest", new Map(), NOW))).toEqual(["b", "c", "a"]);
  });
});

describe("sortPolls: trending", () => {
  it("more votes outrank fewer at equal age", () => {
    const a = poll("a", { createdAt: NOW - 7200 });
    const b = poll("b", { createdAt: NOW - 7200 });
    const counts = new Map([["a", 2], ["b", 40]]);
    expect(ids(sortPolls([a, b], "trending", counts, NOW))).toEqual(["b", "a"]);
  });

  it("recency weighs in: a fresh poll with few votes beats a stale one with a few more", () => {
    const fresh = poll("fresh", { createdAt: NOW - 1800 }); // 30 min old, 3 votes
    const stale = poll("stale", { createdAt: NOW - 6 * 86400 }); // 6 days old, 8 votes
    const counts = new Map([["fresh", 3], ["stale", 8]]);
    expect(pollHotScore(fresh, 3, NOW)).toBeGreaterThan(pollHotScore(stale, 8, NOW));
    expect(ids(sortPolls([stale, fresh], "trending", counts, NOW))).toEqual(["fresh", "stale"]);
  });

  it("unvoted polls tie-break by recency", () => {
    const older = poll("older", { createdAt: NOW - 7200 });
    const newer = poll("newer", { createdAt: NOW - 3600 });
    expect(ids(sortPolls([older, newer], "trending", new Map(), NOW))).toEqual(["newer", "older"]);
  });

  it("does not mutate the input array", () => {
    const input = [poll("a", { createdAt: NOW - 30 }), poll("b", { createdAt: NOW - 10 })];
    sortPolls(input, "trending", new Map(), NOW);
    expect(ids(input)).toEqual(["a", "b"]);
  });
});

describe("sortPolls: expiring (Ending soon)", () => {
  it("open polls order by soonest close time", () => {
    const late = poll("late", { expiration: NOW + 86400 });
    const soon = poll("soon", { expiration: NOW + 600 });
    const mid = poll("mid", { expiration: NOW + 3600 });
    expect(ids(sortPolls([late, soon, mid], "expiring", new Map(), NOW))).toEqual(["soon", "mid", "late"]);
  });

  it("polls without an end time sort after closing ones (by recency)", () => {
    const endlessOld = poll("endless-old", { createdAt: NOW - 7200 });
    const endlessNew = poll("endless-new", { createdAt: NOW - 60 });
    const closing = poll("closing", { expiration: NOW + 600 });
    expect(ids(sortPolls([endlessOld, endlessNew, closing], "expiring", new Map(), NOW)))
      .toEqual(["closing", "endless-new", "endless-old"]);
  });

  it('already-closed polls sort last (only reachable via Show "all"), most recently ended first', () => {
    const closedLongAgo = poll("closed-long", { expiration: NOW - 86400 });
    const closedJust = poll("closed-just", { expiration: NOW - 60 });
    const endless = poll("endless");
    const closing = poll("closing", { expiration: NOW + 600 });
    expect(ids(sortPolls([closedLongAgo, closing, closedJust, endless], "expiring", new Map(), NOW)))
      .toEqual(["closing", "endless", "closed-just", "closed-long"]);
  });
});
