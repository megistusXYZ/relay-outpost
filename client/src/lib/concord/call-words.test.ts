/**
 * The words a call says about itself (owner, 2026-10-10). On the reviewed
 * call neither person could tell from the screen who could hear them or
 * whether the call was over; one sat alone in "In the call · 1".
 */
import { describe, it, expect } from "vitest";
import { callScopeLine, aloneState, nextAloneSince, callLogDiff, stageLayout, ALONE_LEAVE_MS } from "./call-words";

describe("who a call reaches", () => {
  it("names the group and says nothing leaves the room", () => {
    expect(callScopeLine("3d tt")).toBe("Only members of 3d tt can join. Nothing leaves this room.");
    expect(callScopeLine("  ")).toBe("Only members of this group can join. Nothing leaves this room.");
  });
});

describe("the last one left", () => {
  const T = 1_790_000_000_000;
  it("is nobody while others are here, and nobody while nobody has come yet", () => {
    expect(nextAloneSince({ othersNow: 2, hadOthers: true, aloneSince: null, now: T })).toBeNull();
    // A call you started and are waiting in: not "left behind".
    expect(nextAloneSince({ othersNow: 0, hadOthers: false, aloneSince: null, now: T })).toBeNull();
  });
  it("starts the clock the moment the others have all gone, and keeps it", () => {
    expect(nextAloneSince({ othersNow: 0, hadOthers: true, aloneSince: null, now: T })).toBe(T);
    expect(nextAloneSince({ othersNow: 0, hadOthers: true, aloneSince: T, now: T + 5000 })).toBe(T);
    // Someone comes back: the clock is off.
    expect(nextAloneSince({ othersNow: 1, hadOthers: true, aloneSince: T, now: T + 5000 })).toBeNull();
  });
  it("counts down a minute, then lets them go", () => {
    expect(aloneState({ aloneSince: null, now: T })).toEqual({ alone: false, secondsLeft: 0, leaveNow: false });
    expect(aloneState({ aloneSince: T, now: T + 1000 })).toEqual({ alone: true, secondsLeft: 59, leaveNow: false });
    expect(aloneState({ aloneSince: T, now: T + ALONE_LEAVE_MS })).toEqual({ alone: true, secondsLeft: 0, leaveNow: true });
  });
});

describe("who came and went", () => {
  const name = (id: string) => ({ a: "Ben", b: "Derek" }[id] ?? id);
  it("says who joined and who left, by name", () => {
    expect(callLogDiff([], ["a"], name, 1).map((e) => e.text)).toEqual(["Ben joined the call"]);
    expect(callLogDiff(["a", "b"], ["b"], name, 2).map((e) => e.text)).toEqual(["Ben left the call"]);
    expect(callLogDiff(["a"], ["a"], name, 3)).toEqual([]);
  });
});

describe("a shared screen takes the stage", () => {
  it("is a grid of faces until someone shares, then the screens lead and the faces become a strip", () => {
    const a = { id: "a", sharing: false }, b = { id: "b", sharing: false };
    expect(stageLayout([a, b]).mode).toBe("grid");
    const sharing = stageLayout([a, { ...b, sharing: true }]);
    expect(sharing.mode).toBe("stage");
    expect(sharing.screens.map((p) => p.id)).toEqual(["b"]);
    expect(sharing.faces.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
