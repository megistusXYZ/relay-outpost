import { describe, it, expect } from "vitest";
import { mergeDailySnapshots, computeNewlyFlagged, type ScoreSnapshot } from "./wot-history";

const pk = (n: number) => n.toString(16).padStart(64, "0");

describe("mergeDailySnapshots", () => {
  it("adds today's readings to empty history", () => {
    const out = mergeDailySnapshots([], [{ pubkey: pk(1), influence: 0.5 }], "2026-07-16");
    expect(out).toEqual([{ pubkey: pk(1), date: "2026-07-16", influence: 0.5 }]);
  });

  it("keeps one snapshot per pubkey per day (re-record overwrites)", () => {
    const existing: ScoreSnapshot[] = [{ pubkey: pk(1), date: "2026-07-16", influence: 0.3 }];
    const out = mergeDailySnapshots(existing, [{ pubkey: pk(1), influence: 0.9 }], "2026-07-16");
    expect(out.filter((s) => s.pubkey === pk(1) && s.date === "2026-07-16")).toHaveLength(1);
    expect(out[0].influence).toBe(0.9);
  });

  it("preserves prior days while appending today", () => {
    const existing: ScoreSnapshot[] = [{ pubkey: pk(1), date: "2026-07-15", influence: 0.3 }];
    const out = mergeDailySnapshots(existing, [{ pubkey: pk(1), influence: 0.4 }], "2026-07-16");
    expect(out).toHaveLength(2);
  });

  it("enforces the max-days window, dropping oldest dates", () => {
    let history: ScoreSnapshot[] = [];
    for (let d = 1; d <= 5; d++) {
      history = mergeDailySnapshots(
        history,
        [{ pubkey: pk(1), influence: d / 10 }],
        `2026-07-0${d}`,
        { maxDays: 3, maxEntries: 1000 },
      );
    }
    const dates = Array.from(new Set(history.map((s) => s.date))).sort();
    expect(dates).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"]);
  });

  it("enforces the hard entry cap", () => {
    const todays = Array.from({ length: 10 }, (_, i) => ({ pubkey: pk(i), influence: 0.1 }));
    const out = mergeDailySnapshots([], todays, "2026-07-16", { maxDays: 30, maxEntries: 4 });
    expect(out.length).toBeLessThanOrEqual(4);
  });

  it("ignores non-finite influence", () => {
    const out = mergeDailySnapshots([], [{ pubkey: pk(1), influence: NaN }], "2026-07-16");
    expect(out).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const existing: ScoreSnapshot[] = [{ pubkey: pk(1), date: "2026-07-15", influence: 0.3 }];
    const copy = [...existing];
    mergeDailySnapshots(existing, [{ pubkey: pk(2), influence: 0.4 }], "2026-07-16");
    expect(existing).toEqual(copy);
  });
});

describe("computeNewlyFlagged", () => {
  it("flags pubkeys that cross the threshold", () => {
    const { newlyFlagged } = computeNewlyFlagged(
      { [pk(1)]: 1 },
      new Map([[pk(1), 3], [pk(2), 2]]),
      2,
    );
    expect(newlyFlagged.sort()).toEqual([pk(1), pk(2)].sort());
  });

  it("does not re-flag one already seen at/above threshold", () => {
    const { newlyFlagged } = computeNewlyFlagged({ [pk(1)]: 3 }, new Map([[pk(1), 4]]), 2);
    expect(newlyFlagged).toEqual([]);
  });

  it("records the max count seen so a later dip cannot re-trigger", () => {
    const { nextSeen } = computeNewlyFlagged({ [pk(1)]: 5 }, new Map([[pk(1), 2]]), 2);
    expect(nextSeen[pk(1)]).toBe(5);
  });

  it("leaves below-threshold pubkeys unflagged", () => {
    const { newlyFlagged } = computeNewlyFlagged({}, new Map([[pk(1), 1]]), 2);
    expect(newlyFlagged).toEqual([]);
  });
});
