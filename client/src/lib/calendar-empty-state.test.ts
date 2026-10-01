/**
 * What the calendar says when there is nothing to show — and only when that
 * is true. QA 2026-10-01: with the relays unreachable the page said "Your
 * calendar is empty", stating as fact something it never got to ask
 * (RELAY_REACHABILITY.md: data, genuinely empty, and "we never got to ask"
 * are three outcomes, not two).
 */
import { describe, it, expect } from "vitest";
import { calendarEmptyState } from "./calendar-empty-state";

describe("calendarEmptyState", () => {
  it("while the first load is still running, it is loading — not empty", () => {
    expect(calendarEmptyState({ loading: true, hasItems: false, reachedRelays: null })).toBe("loading");
  });

  it("anything to show means content, whatever the relays said", () => {
    expect(calendarEmptyState({ loading: false, hasItems: true, reachedRelays: false })).toBe("content");
    expect(calendarEmptyState({ loading: true, hasItems: true, reachedRelays: null })).toBe("content");
  });

  it("nothing to show because the relays could not be asked is 'unreachable', never 'empty'", () => {
    expect(calendarEmptyState({ loading: false, hasItems: false, reachedRelays: false })).toBe("unreachable");
  });

  it("nothing to show after the relays answered is genuinely empty", () => {
    expect(calendarEmptyState({ loading: false, hasItems: false, reachedRelays: true })).toBe("empty");
  });

  it("not yet asked (signed out, no relays configured) counts as empty, not unreachable", () => {
    expect(calendarEmptyState({ loading: false, hasItems: false, reachedRelays: null })).toBe("empty");
  });
});
