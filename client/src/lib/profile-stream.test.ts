/**
 * Reposts were absent from the Identity profile skin's All AND Posts chips —
 * the skin filtered them out of a list that never contained them (allNotes is
 * authors-scoped; a reposted original has another author). These pin the merge
 * that fixes it.
 */
import { describe, it, expect } from "vitest";
import { mergeProfileStream } from "./profile-stream";

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
