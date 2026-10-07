/**
 * Call limits (owner, 2026-10-06): our call service answers any app, so
 * anyone who makes a key can ask for a seat. These limits keep one person, or
 * one room, from using up the media server for everyone.
 */
import { describe, it, expect } from "vitest";
import { createCallCapacity } from "./call-capacity";

const room = (n: number) => n.toString(16).padStart(64, "0");
const T = 1_789_240_000_000; // ms

describe("call limits", () => {
  it("lets a call fill up, then turns away a burst of joins to that one room", () => {
    const caps = createCallCapacity({ maxCalls: 50, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set() });
    for (let i = 0; i < 30; i++) expect(caps.admit(room(1), T + i)).toEqual({ ok: true });
    expect(caps.admit(room(1), T + 31)).toEqual({ ok: false, reason: "room" });
    // Another room is unaffected, and a minute later this one opens again.
    expect(caps.admit(room(2), T + 32)).toEqual({ ok: true });
    expect(caps.admit(room(1), T + 60_001)).toEqual({ ok: true });
  });

  it("refuses a new call once as many calls as allowed are running, counting calls started since the last look", async () => {
    const live = new Set([room(1), room(2)]);
    const caps = createCallCapacity({ maxCalls: 3, seatsPerRoomPerMinute: 30, liveRooms: async () => live });
    await caps.refresh(T);
    expect(caps.admit(room(3), T + 1)).toEqual({ ok: true }); // 3rd call starts
    expect(caps.admit(room(4), T + 2)).toEqual({ ok: false, reason: "busy" });
    expect(caps.usage(T + 3)).toEqual({ calls: 3, max: 3 });
  });

  it("never locks anyone out of a call already running, even when full", async () => {
    const caps = createCallCapacity({ maxCalls: 2, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set([room(1), room(2)]) });
    await caps.refresh(T);
    expect(caps.admit(room(1), T + 1)).toEqual({ ok: true });
    expect(caps.admit(room(9), T + 2)).toEqual({ ok: false, reason: "busy" });
  });

  it("a call that ended stops counting once the media server says so", async () => {
    let live = new Set([room(1), room(2)]);
    const caps = createCallCapacity({ maxCalls: 2, seatsPerRoomPerMinute: 30, liveRooms: async () => live });
    await caps.refresh(T);
    expect(caps.admit(room(3), T + 1).ok).toBe(false);
    live = new Set([room(1)]);
    await caps.refresh(T + 120_000);
    expect(caps.admit(room(3), T + 120_001)).toEqual({ ok: true });
  });

  it("when the media server can't be asked, calls still go ahead (the per-room and per-address limits stay)", async () => {
    const caps = createCallCapacity({ maxCalls: 1, seatsPerRoomPerMinute: 30, liveRooms: async () => { throw new Error("down"); } });
    await caps.refresh(T);
    expect(caps.admit(room(1), T + 1)).toEqual({ ok: true });
    expect(caps.usage(T + 2)).toEqual({ calls: 1, max: 1 });
  });
});
