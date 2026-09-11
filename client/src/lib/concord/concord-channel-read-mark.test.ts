// A room's read mark only ever moves forward, and says so: its group's dot
// clears, and the read-state sync carries it to the user's other devices.
import { describe, it, expect, beforeEach, vi } from "vitest";

const __store = new Map<string, string>();
const __events: { type: string; detail?: unknown }[] = [];
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
});
vi.stubGlobal("window", {
  dispatchEvent: (e: { type: string; detail?: unknown }) => { __events.push({ type: e.type, detail: e.detail }); return true; },
});

import { writeChannelLastRead, readChannelLastRead } from "./concord-channel-unread";

beforeEach(() => { __store.clear(); __events.length = 0; });

describe("a room's read mark", () => {
  it("moves forward, and tells its group's dot and the read-state sync", () => {
    expect(writeChannelLastRead("c1", "r1", 1000)).toBe(true);
    expect(readChannelLastRead("c1", "r1")).toBe(1000);
    expect(__events.map((e) => e.type)).toEqual(["concord-read", "readstate-changed"]);
    expect(__events[0].detail).toBe("c1");
  });

  it("never moves back", () => {
    writeChannelLastRead("c1", "r1", 5000);
    __events.length = 0;
    expect(writeChannelLastRead("c1", "r1", 1000)).toBe(false);
    expect(readChannelLastRead("c1", "r1")).toBe(5000);
    expect(__events).toEqual([]);
  });
});
