/**
 * Call limits (owner, 2026-10-06): our call service answers any app, so
 * anyone who makes a key can ask for a seat. These limits keep one person, or
 * one room, from using up the media server for everyone.
 */
import { describe, it, expect } from "vitest";
import { createCallCapacity, JOIN_WINDOW_MS, MAX_WAITING_PER_ADDRESS } from "./call-capacity";

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

/**
 * A token counted its room as running for a minute even if no one joined, so
 * one person asking for tokens to throwaway rooms (a key is a room) from two
 * addresses kept every slot taken: everyone else's new call was "busy".
 */
describe("rooms no one joins", () => {
  it("stop counting after the join window once the media server says they aren't running", async () => {
    const caps = createCallCapacity({ maxCalls: 3, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set() });
    await caps.refresh(T);
    for (let i = 1; i <= 3; i++) expect(caps.admit(room(i), T + i, `a${i}`)).toEqual({ ok: true });
    expect(caps.admit(room(9), T + 10, "z").ok).toBe(false);
    // The media server is asked again after the join window: none of them started.
    await caps.refresh(T + JOIN_WINDOW_MS + 100);
    expect(caps.admit(room(9), T + JOIN_WINDOW_MS + 200, "z")).toEqual({ ok: true });
  });

  it("a room someone did join keeps counting", async () => {
    let live = new Set<string>();
    const caps = createCallCapacity({ maxCalls: 1, seatsPerRoomPerMinute: 30, liveRooms: async () => live });
    await caps.refresh(T);
    expect(caps.admit(room(1), T + 1, "a")).toEqual({ ok: true });
    live = new Set([room(1)]);
    await caps.refresh(T + JOIN_WINDOW_MS + 100);
    expect(caps.admit(room(2), T + JOIN_WINDOW_MS + 200, "b").ok).toBe(false);
  });
});

describe("one address", () => {
  it("can have at most MAX_WAITING_PER_ADDRESS rooms waiting for someone to join", async () => {
    const caps = createCallCapacity({ maxCalls: 50, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set() });
    await caps.refresh(T);
    for (let i = 0; i < MAX_WAITING_PER_ADDRESS; i++) expect(caps.admit(room(i + 1), T + i, "1.2.3.4")).toEqual({ ok: true });
    expect(caps.admit(room(99), T + 10, "1.2.3.4")).toEqual({ ok: false, reason: "busy" });
    // Someone else is unaffected, and a room already started takes more seats.
    expect(caps.admit(room(98), T + 11, "5.6.7.8")).toEqual({ ok: true });
    expect(caps.admit(room(1), T + 12, "1.2.3.4")).toEqual({ ok: true });
  });

  it("frees a waiting slot once that room is running", async () => {
    let live = new Set<string>();
    const caps = createCallCapacity({ maxCalls: 50, seatsPerRoomPerMinute: 30, liveRooms: async () => live });
    await caps.refresh(T);
    for (let i = 0; i < MAX_WAITING_PER_ADDRESS; i++) caps.admit(room(i + 1), T + i, "1.2.3.4");
    live = new Set([room(1)]);
    await caps.refresh(T + 16_000);
    expect(caps.admit(room(99), T + 16_100, "1.2.3.4")).toEqual({ ok: true });
  });
});
