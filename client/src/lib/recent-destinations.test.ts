import { describe, it, expect } from "vitest";
import {
  pushRecent,
  pruneDismissals,
  addDismissal,
  filterDismissed,
  destinationSuggestionId,
  SUGGESTION_DISMISSAL_TTL_MS,
  type DismissedSuggestion,
  type RecentDestination,
} from "./recent-destinations";

const d = (type: "dm" | "community", id: string, ts = 0): RecentDestination => ({
  type,
  id,
  path: `/x/${id}`,
  ts,
});

describe("pushRecent", () => {
  it("puts the newest entry first", () => {
    const out = pushRecent([d("dm", "a")], d("community", "b"));
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("dedupes by type+id, moving a revisit to the front", () => {
    const out = pushRecent([d("dm", "a"), d("community", "b")], d("community", "b", 9));
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
    expect(out[0].ts).toBe(9);
  });

  it("keeps same id under different types distinct", () => {
    const out = pushRecent([d("dm", "a")], d("community", "a"));
    expect(out).toHaveLength(2);
  });

  it("caps the list", () => {
    let list: RecentDestination[] = [];
    for (let i = 0; i < 8; i++) list = pushRecent(list, d("dm", `p${i}`), 5);
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe("p7");
  });
});

const dis = (id: string, dismissedAt: number): DismissedSuggestion => ({ id, dismissedAt });

describe("destinationSuggestionId", () => {
  it("keeps same id under different types distinct", () => {
    expect(destinationSuggestionId(d("dm", "a"))).not.toBe(
      destinationSuggestionId(d("community", "a")),
    );
  });
});

describe("pruneDismissals", () => {
  it("drops entries older than the TTL, keeps fresh ones", () => {
    const now = SUGGESTION_DISMISSAL_TTL_MS * 2;
    const out = pruneDismissals(
      [dis("old", now - SUGGESTION_DISMISSAL_TTL_MS - 1), dis("fresh", now - 1)],
      now,
    );
    expect(out.map((x) => x.id)).toEqual(["fresh"]);
  });

  it("expires an entry exactly at the TTL boundary", () => {
    const out = pruneDismissals([dis("edge", 0)], SUGGESTION_DISMISSAL_TTL_MS);
    expect(out).toHaveLength(0);
  });
});

describe("addDismissal", () => {
  it("appends a new dismissal stamped at now", () => {
    const out = addDismissal([dis("a", 5)], "b", 9);
    expect(out).toEqual([dis("a", 5), dis("b", 9)]);
  });

  it("dedupes by id, refreshing dismissedAt", () => {
    const out = addDismissal([dis("a", 5)], "a", 9);
    expect(out).toEqual([dis("a", 9)]);
  });

  it("prunes expired entries while adding", () => {
    const now = SUGGESTION_DISMISSAL_TTL_MS * 2;
    const out = addDismissal([dis("old", 0)], "new", now);
    expect(out.map((x) => x.id)).toEqual(["new"]);
  });
});

describe("filterDismissed", () => {
  it("removes dismissed rows so the next candidates backfill the cap", () => {
    const rows = [d("dm", "a"), d("community", "b"), d("dm", "c"), d("dm", "e")];
    const kept = filterDismissed(
      rows,
      new Set([destinationSuggestionId(d("dm", "a"))]),
      destinationSuggestionId,
    ).slice(0, 3);
    expect(kept.map((x) => x.id)).toEqual(["b", "c", "e"]);
  });

  it("does not confuse a dm dismissal with a community of the same id", () => {
    const kept = filterDismissed(
      [d("community", "a")],
      new Set([destinationSuggestionId(d("dm", "a"))]),
      destinationSuggestionId,
    );
    expect(kept).toHaveLength(1);
  });

  it("passes everything through when nothing is dismissed", () => {
    const rows = [d("dm", "a")];
    expect(filterDismissed(rows, new Set(), destinationSuggestionId)).toEqual(rows);
  });
});
