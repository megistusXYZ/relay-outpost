/**
 * The order a community's rooms are listed in, shared by the room list and the
 * rooms side of an open room: pinned first, then rooms you've joined, then the
 * most recently active. Lifted out of CommsTab's inline sort so the two lists
 * can't disagree.
 */
import { describe, it, expect } from "vitest";
import { orderRooms, sideRooms } from "./community-room-order";

describe("the rooms beside an open room", () => {
  const by = { pinned: new Set(["starred"]), joined: new Set(["mine", "old"]), activity: { mine: 50, old: 5, starred: 10, stranger: 99 } };
  const all = [{ id: "stranger", name: "stranger" }, { id: "old", name: "old" }, { id: "mine", name: "mine" }, { id: "starred", name: "starred" }];

  it("your pinned and joined rooms, in list order, not every room on the server", () => {
    expect(sideRooms(all, by, "mine").map((r) => r.id)).toEqual(["starred", "mine", "old"]);
  });

  it("plus the room you're in, when it's neither", () => {
    expect(sideRooms(all, by, "stranger").map((r) => r.id)).toEqual(["starred", "mine", "old", "stranger"]);
  });
});

const room = (id: string) => ({ id, name: id });

describe("the order a community's rooms are listed in", () => {
  it("pinned first, then rooms you've joined, then the most recently active", () => {
    const rooms = [room("quiet"), room("busy"), room("mine"), room("starred")];
    const out = orderRooms(rooms, {
      pinned: new Set(["starred"]),
      joined: new Set(["mine"]),
      activity: { busy: 200, quiet: 100, mine: 50, starred: 10 },
    });
    expect(out.map((r) => r.id)).toEqual(["starred", "mine", "busy", "quiet"]);
  });
});
