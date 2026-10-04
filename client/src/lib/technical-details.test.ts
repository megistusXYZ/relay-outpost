// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// A real Storage for this test (the runtime's own global can shadow jsdom's).
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
});
import { isTechnicalDetails, setTechnicalDetails, TECHNICAL_DETAILS_EVENT } from "./technical-details";

// "Show technical details" (owner, 2026-10-04): off by default, remembered on
// this device; on, the console shows kind numbers, keys and method names.
describe("technical details", () => {
  beforeEach(() => { mem.clear(); });
  it("is off until you turn it on", () => {
    expect(isTechnicalDetails()).toBe(false);
  });
  it("is remembered once turned on, and tells the page", () => {
    let told = 0;
    const on = () => { told++; };
    window.addEventListener(TECHNICAL_DETAILS_EVENT, on);
    setTechnicalDetails(true);
    expect(isTechnicalDetails()).toBe(true);
    setTechnicalDetails(false);
    expect(isTechnicalDetails()).toBe(false);
    window.removeEventListener(TECHNICAL_DETAILS_EVENT, on);
    expect(told).toBe(2);
  });
});
