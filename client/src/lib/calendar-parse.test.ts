import { describe, it, expect } from "vitest";
import {
  parseCalendarEvent,
  safeString,
  getCalendarEventDate,
  getCalendarEventEndDate,
  KIND_TIME_CALENDAR_EVENT,
  KIND_DATE_CALENDAR_EVENT,
} from "./calendar-events";
import type { Event } from "nostr-tools";

// A well-formed nostr event carries only string tag values, but events come off
// arbitrary relays and a malformed one can smuggle an object/array/number where
// a string belongs. parseCalendarEvent must coerce every field it exposes to a
// safe string so nothing that reaches a JSX text node is ever an object — the
// class of bug that crashed the Search → Events tab with "Objects are not valid
// as a React child (object with keys {})".

// `as unknown as` lets us build the deliberately-malformed events TS would
// otherwise reject.
function malformed(kind: number, tags: unknown[][], content: unknown): Event {
  return {
    id: "e".repeat(64),
    pubkey: "a".repeat(64),
    created_at: 1785556800,
    kind,
    tags: tags as string[][],
    content: content as string,
    sig: "s".repeat(128),
  };
}

describe("safeString", () => {
  it("passes strings through", () => {
    expect(safeString("hello")).toBe("hello");
    expect(safeString("")).toBe("");
  });
  it("rejects non-strings", () => {
    expect(safeString({})).toBeUndefined();
    expect(safeString([])).toBeUndefined();
    expect(safeString(42)).toBeUndefined();
    expect(safeString(null)).toBeUndefined();
    expect(safeString(undefined)).toBeUndefined();
  });
});

describe("parseCalendarEvent — malformed fields never become objects", () => {
  it("does not throw when tag values and content are objects/arrays", () => {
    const ev = malformed(
      KIND_TIME_CALENDAR_EVENT,
      [
        ["d", "evt-1"],
        ["title", {}],          // object where a string is expected
        ["location", ["a", "b"]], // array
        ["image", { url: "x" }],
        ["start", { bad: 1 }],
        ["t", {}],              // malformed hashtag
        ["t", "bitcoin"],       // one good hashtag
      ],
      { not: "a string" },
    );
    expect(() => parseCalendarEvent(ev)).not.toThrow();
  });

  it("coerces every rendered field to a string (or leaves it undefined)", () => {
    const ce = parseCalendarEvent(
      malformed(
        KIND_TIME_CALENDAR_EVENT,
        [
          ["d", "evt-1"],
          ["title", {}],
          ["location", ["arr"]],
          ["image", {}],
        ],
        {},
      ),
    );
    expect(ce).not.toBeNull();
    // Bad title falls back to the default; bad location/image drop to undefined.
    expect(typeof ce!.title).toBe("string");
    expect(ce!.title).toBe("Untitled Event");
    expect(ce!.location).toBeUndefined();
    expect(ce!.image).toBeUndefined();
    // description comes from content — a non-string collapses to "".
    expect(ce!.description).toBe("");
    // hashtag/participant/reference arrays contain only strings.
    for (const arr of [ce!.hashtags, ce!.participants, ce!.references]) {
      expect(arr.every((x) => typeof x === "string")).toBe(true);
    }
  });

  it("keeps the good values alongside the bad ones", () => {
    const ce = parseCalendarEvent(
      malformed(
        KIND_TIME_CALENDAR_EVENT,
        [
          ["d", "evt-2"],
          ["title", {}],
          ["name", "Fallback Name"], // valid `name` used when `title` is bad
          ["t", {}],
          ["t", "nostr"],
        ],
        "real description",
      ),
    );
    expect(ce!.title).toBe("Fallback Name");
    expect(ce!.description).toBe("real description");
    expect(ce!.hashtags).toEqual(["nostr"]);
  });

  it("skips an event whose `d` tag is not a string (returns null)", () => {
    const ce = parseCalendarEvent(
      malformed(KIND_TIME_CALENDAR_EVENT, [["d", {}], ["title", "X"]], ""),
    );
    expect(ce).toBeNull();
  });

  it("ignores a non-numeric/object start time rather than producing NaN", () => {
    const ce = parseCalendarEvent(
      malformed(KIND_TIME_CALENDAR_EVENT, [["d", "evt-3"], ["start", {}]], ""),
    );
    expect(ce!.startTime).toBeUndefined();
    expect(getCalendarEventDate(ce!)).toBeNull();
  });

  it("the parsed result's render inputs are all strings (or undefined)", () => {
    const ce = parseCalendarEvent(
      malformed(
        KIND_DATE_CALENDAR_EVENT,
        [["d", "evt-4"], ["title", {}], ["location", {}], ["start", ["2026-08-01"]]],
        {},
      ),
    )!;
    for (const field of [ce.title, ce.location, ce.description, ce.image, ce.startDate, ce.endDate, ce.dTag]) {
      expect(field === undefined || typeof field === "string").toBe(true);
    }
    // The date helpers (which feed the rendered "when" string) must not throw
    // on the coerced output.
    expect(() => getCalendarEventDate(ce)).not.toThrow();
    expect(() => getCalendarEventEndDate(ce)).not.toThrow();
  });
});
