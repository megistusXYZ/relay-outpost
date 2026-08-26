/**
 * The trust-filter scroll starvation (owner repro): filter hides 29 of a
 * 30-post page → sentinel never exits the viewport → IntersectionObserver
 * never fires again → endless scroll completely dead. These pin the refill
 * rule that unsticks it.
 */
import { describe, it, expect } from "vitest";
import { shouldRetriggerLoad } from "./scroll-refill";

describe("shouldRetriggerLoad", () => {
  it("fires on the load-completion edge while still visible with more to fetch", () => {
    expect(shouldRetriggerLoad({ wasLoading: true, isLoading: false, intersecting: true, hasMore: true })).toBe(true);
  });

  it("never fires mid-load", () => {
    expect(shouldRetriggerLoad({ wasLoading: true, isLoading: true, intersecting: true, hasMore: true })).toBe(false);
  });

  it("never fires without a completed load — the observer transition covers first contact", () => {
    expect(shouldRetriggerLoad({ wasLoading: false, isLoading: false, intersecting: true, hasMore: true })).toBe(false);
  });

  it("stays quiet once content pushed the sentinel off screen — normal scrolling resumes", () => {
    expect(shouldRetriggerLoad({ wasLoading: true, isLoading: false, intersecting: false, hasMore: true })).toBe(false);
  });

  it("stays quiet at the end of history — the relay ran out, not the filter", () => {
    expect(shouldRetriggerLoad({ wasLoading: true, isLoading: false, intersecting: true, hasMore: false })).toBe(false);
  });
});
