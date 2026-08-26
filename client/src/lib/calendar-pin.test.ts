import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage; the pin store reads/writes it synchronously.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
});

import {
  pinEvent,
  unpinEvent,
  isEventPinned,
  pinEventExplicit,
  unpinEventExplicit,
  isEventPinnedExplicit,
  unpinEventFromRsvpClear,
  addPinnedEntry,
  removePinnedEntry,
  hasPinnedEntry,
  KIND_TIME_CALENDAR_EVENT,
  type CalendarEventData,
  type PinnedEntry,
} from "./calendar-events";

const USER = "u".repeat(64);
const HOST = "a".repeat(64);

function ce(overrides: Partial<CalendarEventData> = {}): CalendarEventData {
  const id = overrides.id ?? "e".repeat(64);
  return {
    id,
    pubkey: HOST,
    dTag: "my-event",
    title: "Meetup",
    description: "",
    hashtags: [],
    participants: [],
    references: [],
    kind: KIND_TIME_CALENDAR_EVENT,
    event: {
      id, pubkey: HOST, created_at: 1785556800, kind: KIND_TIME_CALENDAR_EVENT,
      tags: [["d", overrides.dTag ?? "my-event"]], content: "", sig: "s".repeat(128),
    },
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
});

describe("pure entry transitions", () => {
  it("addPinnedEntry is idempotent (returns the SAME array when already present)", () => {
    const one = addPinnedEntry([], ce().id, ce());
    expect(one).toHaveLength(1);
    expect(addPinnedEntry(one, ce().id, ce())).toBe(one);
  });

  it("matches by addressable coordinate across replaceable versions (different id, same coord)", () => {
    const v1 = ce({ id: "1".repeat(64) });
    const v2 = ce({ id: "2".repeat(64) });
    const entries = addPinnedEntry([], v1.id, v1);
    expect(hasPinnedEntry(entries, v2.id, v2)).toBe(true);
    expect(addPinnedEntry(entries, v2.id, v2)).toBe(entries);
    expect(removePinnedEntry(entries, v2.id, v2)).toHaveLength(0);
  });

  it("falls back to bare-id entries without event data (legacy shape)", () => {
    const entries = addPinnedEntry([], "abc123");
    expect(entries).toEqual(["abc123"]);
    expect(hasPinnedEntry(entries, "abc123")).toBe(true);
    expect(removePinnedEntry(entries, "abc123")).toHaveLength(0);
  });

  it("removePinnedEntry leaves unrelated entries alone", () => {
    const other = ce({ dTag: "other-event", id: "f".repeat(64) });
    let entries: PinnedEntry[] = addPinnedEntry([], ce().id, ce());
    entries = addPinnedEntry(entries, other.id, other);
    expect(removePinnedEntry(entries, ce().id, ce())).toEqual(
      addPinnedEntry([], other.id, other),
    );
  });
});

describe("pin store (localStorage)", () => {
  it("pinEvent / unpinEvent round-trip", () => {
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
    pinEvent(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(true);
    unpinEvent(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
  });

  it("pinEvent is idempotent (single stored entry)", () => {
    pinEvent(USER, ce().id, ce());
    pinEvent(USER, ce().id, ce());
    const raw = JSON.parse(store.get(`relay-outpost-pinned-calendar-events:${USER}`)!);
    expect(raw).toHaveLength(1);
  });

  it("stores are per-user", () => {
    pinEvent(USER, ce().id, ce());
    expect(isEventPinned("v".repeat(64), ce().id, ce())).toBe(false);
  });
});

describe("pin provenance — explicit quiet pin vs Going side-effect pin", () => {
  it("an explicit quiet pin SURVIVES an RSVP clear", () => {
    pinEventExplicit(USER, ce().id, ce());
    // user taps Going (idempotent re-pin), then clears Going
    pinEvent(USER, ce().id, ce());
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(true);
    expect(isEventPinnedExplicit(USER, ce().id, ce())).toBe(true);
  });

  it("a Going-provenance pin is removed by an RSVP clear (documented behavior)", () => {
    pinEvent(USER, ce().id, ce());
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
  });

  it("explicitly pinning AFTER Going upgrades provenance — clear no longer unpins", () => {
    pinEvent(USER, ce().id, ce());          // Going pinned it
    pinEventExplicit(USER, ce().id, ce());  // user also quiet-pins in the popover
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(true);
  });

  it("legacy pins (written before provenance existed) still unpin on RSVP clear", () => {
    // Simulate a pre-provenance store: pin entry present, no marker set.
    store.set(`relay-outpost-pinned-calendar-events:${USER}`, JSON.stringify([ce().id]));
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
  });

  it("explicit removal always unpins and clears the marker", () => {
    pinEventExplicit(USER, ce().id, ce());
    unpinEventExplicit(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
    expect(isEventPinnedExplicit(USER, ce().id, ce())).toBe(false);
    // A later Going→clear cycle behaves like a fresh rsvp-provenance pin.
    pinEvent(USER, ce().id, ce());
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(false);
  });

  it("pinEventExplicit is idempotent (single pin entry, single marker)", () => {
    pinEventExplicit(USER, ce().id, ce());
    pinEventExplicit(USER, ce().id, ce());
    expect(JSON.parse(store.get(`relay-outpost-pinned-calendar-events:${USER}`)!)).toHaveLength(1);
    expect(JSON.parse(store.get(`relay-outpost-explicit-pinned-events:${USER}`)!)).toHaveLength(1);
  });

  it("provenance matches by coordinate, so a replaceable-event republish (new id) keeps the marker", () => {
    const v1 = ce({ id: "1".repeat(64) });
    const v2 = ce({ id: "2".repeat(64) });
    pinEventExplicit(USER, v1.id, v1);
    unpinEventFromRsvpClear(USER, v2.id, v2);
    expect(isEventPinned(USER, v2.id, v2)).toBe(true);
  });

  it("failed-Going rollback (an RSVP-driven unpin) preserves a prior explicit pin", () => {
    pinEventExplicit(USER, ce().id, ce());
    // Going tap: applyPin("pin") …publish fails… rollback applies the reverse
    pinEvent(USER, ce().id, ce());
    unpinEventFromRsvpClear(USER, ce().id, ce());
    expect(isEventPinned(USER, ce().id, ce())).toBe(true);
  });
});
