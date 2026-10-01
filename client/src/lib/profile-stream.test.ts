/**
 * Reposts were absent from the Identity profile skin's All AND Posts chips —
 * the skin filtered them out of a list that never contained them (allNotes is
 * authors-scoped; a reposted original has another author). These pin the merge
 * that fixes it.
 */
import { describe, it, expect } from "vitest";
import { mergeProfileStream, uniqueById } from "./profile-stream";

const ev = (id: string, created_at: number) => ({ id, created_at });

describe("mergeProfileStream", () => {
  it("reposted originals appear in the stream", () => {
    const out = mergeProfileStream(
      [ev("own1", 100)],
      [ev("theirs", 50)],
      new Map([["theirs", { timestamp: 90 }]]),
    );
    expect(out.map((e) => e.id)).toEqual(["own1", "theirs"]);
  });

  it("a repost is timed by WHEN IT WAS REPOSTED, not the original's age", () => {
    // Original written long ago (10), reposted just now (200) — it leads.
    const out = mergeProfileStream(
      [ev("own1", 100)],
      [ev("old-article", 10)],
      new Map([["old-article", { timestamp: 200 }]]),
    );
    expect(out[0].id).toBe("old-article");
  });

  it("self-repost does not duplicate the note", () => {
    const out = mergeProfileStream(
      [ev("mine", 100)],
      [ev("mine", 100)],
      new Map([["mine", { timestamp: 150 }]]),
    );
    expect(out).toHaveLength(1);
  });

  it("no reposts → the own list comes back untouched, same reference", () => {
    const own = [ev("a", 2), ev("b", 1)];
    expect(mergeProfileStream(own, [], new Map())).toBe(own);
  });

  it("a repost missing from the map falls back to its created_at, never the top", () => {
    // Partial map (the kind-6 resolution is a second fetch and can lag) —
    // an unmapped repost must sort by its own timestamp, not float or crash.
    const out = mergeProfileStream(
      [ev("own-new", 300), ev("own-old", 100)],
      [ev("unmapped", 200)],
      new Map(),
    );
    expect(out.map((e) => e.id)).toEqual(["own-new", "unmapped", "own-old"]);
  });
});

describe("the same note reposted more than once", () => {
  // Owner report, 2026-10-01: a profile showed "reposted" twice in a row with
  // the same note, same counts. Each repost EVENT contributed its original to
  // the list, so reposting a note twice (or a kind-6 and a kind-16 of it) put
  // the one original in the stream twice.
  it("shows the note once", () => {
    const own = [{ id: "own1", created_at: 100 }];
    const original = { id: "orig", created_at: 50 };
    const merged = mergeProfileStream(own, [original, original], new Map([["orig", { timestamp: 200 }]]));
    expect(merged.map((e) => e.id)).toEqual(["orig", "own1"]);
  });

  it("…timed by the LATEST repost of it", () => {
    // repostMap already keeps the newest repost time per original; one row,
    // at that time.
    const own = [{ id: "a", created_at: 300 }, { id: "b", created_at: 100 }];
    const original = { id: "orig", created_at: 10 };
    const merged = mergeProfileStream(own, [original, { ...original }], new Map([["orig", { timestamp: 200 }]]));
    expect(merged.map((e) => e.id)).toEqual(["a", "orig", "b"]);
  });

  it("uniqueById keeps the first of each id, in order", () => {
    expect(uniqueById([{ id: "x" }, { id: "y" }, { id: "x" }]).map((e) => e.id)).toEqual(["x", "y"]);
  });
});

describe("Profile hands the stream one entry per reposted note", () => {
  it("dedupes the originals it collected from repost events (the classic skin merges that list itself)", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(path.resolve(import.meta.dirname, "../pages/Profile.tsx"), "utf8");
    expect(src).toMatch(/setRepostedEvents\(uniqueById\(allOriginals\)\);/);
  });
});
