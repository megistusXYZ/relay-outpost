/**
 * Searching a group chat: every room's messages this device has opened,
 * matched on the words you type. Results say which room and show the words
 * around the match; tapping one jumps to the message.
 */
import { describe, it, expect } from "vitest";
import { searchGroup } from "./concord-search";

const m = (id: string, content: string, t: number, over: Record<string, unknown> = {}) =>
  ({ id, pubkey: "a".repeat(64), content, t, ...over });
const rooms = [
  { id: "r1", name: "general", messages: [m("1", "Meet at the Café tomorrow", 1000), m("2", "bring snacks", 2000), m("3", "café closed", 3000, { deleted: true })] },
  { id: "r2", name: "planning", messages: [m("4", "The cafe on 5th street", 4000), m("5", "", 5000)] },
];

describe("searching a group", () => {
  it("finds messages in every room, newest first, whatever the case or accents", () => {
    expect(searchGroup(rooms, "CAFE").map((h) => h.msg.id)).toEqual(["4", "1"]);
  });

  it("needs every word, in any order", () => {
    expect(searchGroup(rooms, "tomorrow meet").map((h) => h.msg.id)).toEqual(["1"]);
    expect(searchGroup(rooms, "cafe snacks")).toEqual([]);
  });

  it("leaves out deleted, expired and empty messages", () => {
    const expiring = [{ id: "r3", name: "x", messages: [m("6", "cafe", 6000, { expiresAt: 100 })] }];
    expect(searchGroup([...rooms, ...expiring], "cafe", { now: 200_000 }).map((h) => h.msg.id)).toEqual(["4", "1"]);
    const removed = [{ id: "r4", name: "y", messages: [m("7", "cafe", 7000, { deletedBy: "b".repeat(64) })] }];
    expect(searchGroup(removed, "cafe")).toEqual([]);
  });

  it("says which room each result is in, and shows the words around the match", () => {
    const [hit] = searchGroup(rooms, "5th");
    expect(hit).toMatchObject({ roomId: "r2", roomName: "planning" });
    expect(hit.snippet).toEqual({ before: "The cafe on ", match: "5th", after: " street" });
    // The match is shown as written, accents and all.
    expect(searchGroup(rooms, "cafe tomorrow")[0].snippet.match).toBe("Café");
  });

  it("trims a long message to the part around the match", () => {
    const long = [{ id: "r", name: "r", messages: [m("8", "x".repeat(200) + " needle " + "y".repeat(200), 1)] }];
    const [hit] = searchGroup(long, "needle");
    expect(hit.snippet.before.startsWith("…")).toBe(true);
    expect(hit.snippet.after.endsWith("…")).toBe(true);
    expect(hit.snippet.before.length + hit.snippet.after.length).toBeLessThanOrEqual(90);
  });

  it("finds nothing for a blank search, and stops at the limit", () => {
    expect(searchGroup(rooms, "   ")).toEqual([]);
    const many = [{ id: "r", name: "r", messages: Array.from({ length: 80 }, (_, i) => m(String(i), "cafe", i)) }];
    expect(searchGroup(many, "cafe")).toHaveLength(50);
  });
});
