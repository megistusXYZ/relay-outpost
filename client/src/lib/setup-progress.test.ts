/**
 * Set up your community — the owner's own progress (owner, 2026-10-09): the
 * steps ticked or skipped by hand, and whether the list is hidden, kept as
 * one small record with the community so every device agrees. Last writer
 * wins; the browser keeps a copy for the next opening and for offline.
 */
import { describe, it, expect } from "vitest";
import { emptyProgress, readProgress, markDone, unmark, skipStep, setHidden, newer, PROGRESS_D_TAG } from "./setup-progress";

describe("the progress record", () => {
  it("starts empty", () => {
    expect(emptyProgress()).toEqual({ done: [], skipped: [], hidden: false, at: 0 });
  });
  it("is read from a record's content, dropping anything that isn't a step", () => {
    expect(readProgress(JSON.stringify({ done: ["share", "nope"], skipped: ["team"], hidden: true, at: 1700000000 })))
      .toEqual({ done: ["share"], skipped: ["team"], hidden: true, at: 1700000000 });
    expect(readProgress("not json")).toBeNull();
    expect(readProgress(JSON.stringify({ done: "share" }))).toBeNull();
  });
  it("marking done, undoing, skipping and hiding each stamp the time", () => {
    let p = emptyProgress();
    p = markDone(p, "share", 10);
    expect(p).toEqual({ done: ["share"], skipped: [], hidden: false, at: 10 });
    p = skipStep(p, "team", 11);
    expect(p.skipped).toEqual(["team"]);
    p = markDone(p, "team", 12);
    expect(p).toEqual({ done: ["share", "team"], skipped: [], hidden: false, at: 12 });
    p = unmark(p, "share", 13);
    expect(p.done).toEqual(["team"]);
    p = setHidden(p, true, 14);
    expect(p.hidden).toBe(true);
    expect(p.at).toBe(14);
  });
  it("the newer record wins whole — an undo on the phone isn't resurrected by the laptop", () => {
    const laptop = { done: ["share", "team"], skipped: [], hidden: false, at: 10 };
    const phone = { done: ["team"], skipped: [], hidden: true, at: 20 };
    expect(newer(laptop, phone)).toBe(phone);
    expect(newer(phone, laptop)).toBe(phone);
    expect(newer(null, laptop)).toBe(laptop);
  });
  it("is kept under one address per community", () => {
    expect(PROGRESS_D_TAG("wss://community.qa.invalid")).toBe("relay-outpost/setup/wss://community.qa.invalid");
  });
});
