import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { parseEventQuery, sinceFor, queryFilter, queryFromSavedToolbar, TIME_RANGES } from "./event-query";

const HEX = "a".repeat(64);
const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m"; // jack
const NOTE = nip19.noteEncode("b".repeat(64));

describe("one search field for events", () => {
  it("plain words search content", () => {
    expect(parseEventQuery("gm nostr")).toEqual({ text: "gm nostr" });
  });
  it("an event id, in any of its spellings, looks that event up", () => {
    expect(parseEventQuery(HEX)).toEqual({ id: HEX });
    expect(parseEventQuery(NOTE)).toEqual({ id: "b".repeat(64) });
    expect(parseEventQuery(" " + HEX.toUpperCase() + " ")).toEqual({ id: HEX });
  });
  it("an npub narrows to that author, and words beside it still search", () => {
    const q = parseEventQuery(`${NPUB} coffee`);
    expect(q.author).toHaveLength(64);
    expect(q.text).toBe("coffee");
  });
  it("kind:N narrows to that kind", () => {
    expect(parseEventQuery("kind:1")).toEqual({ kind: 1 });
    expect(parseEventQuery("kind:30023 travel")).toEqual({ kind: 30023, text: "travel" });
    expect(parseEventQuery("k:7")).toEqual({ kind: 7 });
  });
  it("an empty field is no narrowing at all", () => {
    expect(parseEventQuery("")).toEqual({});
    expect(parseEventQuery("   ")).toEqual({});
  });
  it("something that only looks like a key is searched as words", () => {
    expect(parseEventQuery("npub1notreal")).toEqual({ text: "npub1notreal" });
  });
});

describe("the time ranges", () => {
  it("are any time, then six fixed windows, then custom", () => {
    expect(TIME_RANGES.map((r) => r.id)).toEqual(["any", "1h", "6h", "24h", "7d", "30d"]);
  });
  it("turn into a since", () => {
    expect(sinceFor("any", 1_000_000)).toBeUndefined();
    expect(sinceFor("1h", 1_000_000)).toBe(996_400);
    expect(sinceFor("7d", 1_000_000)).toBe(1_000_000 - 7 * 86400);
  });
});

describe("the relay filter", () => {
  it("asks for the latest events when nothing is narrowed", () => {
    expect(queryFilter({}, { range: "any" }, 1_000_000)).toEqual({ limit: 100 });
  });
  it("asks for one id without a limit", () => {
    expect(queryFilter({ id: HEX }, { range: "24h" }, 1_000_000)).toEqual({ ids: [HEX] });
  });
  it("carries author, kind and the window", () => {
    expect(queryFilter({ author: HEX, kind: 1, text: "x" }, { range: "1h" }, 1_000_000)).toEqual({ limit: 100, authors: [HEX], kinds: [1], since: 996_400 });
  });
  it("a custom window uses its own bounds", () => {
    expect(queryFilter({}, { range: "custom", since: 10, until: 20 }, 1_000_000)).toEqual({ limit: 100, since: 10, until: 20 });
  });
});

describe("a view saved before the one field", () => {
  it("folds its separate boxes into one query", () => {
    expect(queryFromSavedToolbar({ searchKind: "1", searchAuthor: NPUB, searchContent: "hello" })).toBe(`kind:1 ${NPUB} hello`);
    expect(queryFromSavedToolbar({ searchEventId: HEX })).toBe(HEX);
    expect(queryFromSavedToolbar({ kindFilter: "all", authorFilter: "" })).toBe("");
  });
});
