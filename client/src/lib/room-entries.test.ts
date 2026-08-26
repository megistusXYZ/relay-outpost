/**
 * The rooms nested under a community row in Chats: pinned rooms (Stage 2.8)
 * plus, now, every room the member is actually in (kind-10009) — with a clock
 * and an unread that are only ever CLAIMED when the relay answered.
 *
 * The ordering and honesty rules live here, pure, because the alternative was
 * a pile of conditionals inside ChatList's render — which is exactly where the
 * first version of every list bug in this repo hid.
 */
import { describe, it, expect } from "vitest";
import { buildRoomRows } from "./room-entries";

const pin = (channelId: string, label: string, id = `pin-${channelId}`) => ({ channelId, id, label });
const joined = (groupId: string, name?: string) => ({ groupId, name });
const neverRead = () => 0;

describe("buildRoomRows", () => {
  it("renders a member's joined rooms, not just the pinned ones", () => {
    const { rows } = buildRoomRows({
      pins: [],
      joined: [joined("a", "Pilot"), joined("b", "Design")],
      activity: {},
      lastReadOf: neverRead,
    });
    expect(rows.map((r) => r.name)).toEqual(["Pilot", "Design"]);
    expect(rows.every((r) => !r.pinned)).toBe(true);
  });

  it("keeps pins first, in pin order, ahead of busier joined rooms", () => {
    const { rows } = buildRoomRows({
      pins: [pin("p1", "Announcements"), pin("p2", "Watercooler")],
      joined: [joined("hot", "Hot Room")],
      activity: { hot: 9_999_999 },
      lastReadOf: neverRead,
    });
    expect(rows.map((r) => r.groupId)).toEqual(["p1", "p2", "hot"]);
    expect(rows[0].pinned).toBe(true);
    expect(rows[2].pinned).toBe(false);
  });

  it("orders joined rooms by newest activity, unknown clocks last in list order", () => {
    const { rows } = buildRoomRows({
      pins: [],
      joined: [joined("quiet1", "Quiet 1"), joined("busy", "Busy"), joined("quiet2", "Quiet 2"), joined("busier", "Busier")],
      activity: { busy: 100, busier: 200 },
      lastReadOf: neverRead,
    });
    expect(rows.map((r) => r.groupId)).toEqual(["busier", "busy", "quiet1", "quiet2"]);
  });

  it("a room that is both pinned and joined renders ONCE, as the pin, with the clock", () => {
    const { rows } = buildRoomRows({
      pins: [pin("a", "Pilot (pin label)")],
      joined: [joined("a", "Pilot")],
      activity: { a: 500 },
      lastReadOf: neverRead,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pinned).toBe(true);
    expect(rows[0].name).toBe("Pilot (pin label)");
    expect(rows[0].lastActivity).toBe(500);
  });

  it("unread only when the relay ANSWERED and the newest beats the read mark", () => {
    const { rows } = buildRoomRows({
      pins: [],
      joined: [joined("seen", "Seen"), joined("fresh", "Fresh")],
      activity: { seen: 100, fresh: 100 },
      lastReadOf: (gid) => (gid === "seen" ? 100 : 50),
    });
    expect(rows.find((r) => r.groupId === "seen")!.unread).toBe(false);
    expect(rows.find((r) => r.groupId === "fresh")!.unread).toBe(true);
  });

  it("an unanswered relay claims NOTHING: no unread, no timestamp", () => {
    // activity === null is "we never got to ask" — the third outcome. Reading
    // it as "quiet room" is the exact collapse RELAY_REACHABILITY.md exists to
    // prevent, so every row must render silent, not confident.
    const { rows } = buildRoomRows({
      pins: [pin("p", "Pinned")],
      joined: [joined("j", "Joined")],
      activity: null,
      lastReadOf: neverRead,
    });
    for (const r of rows) {
      expect(r.unread).toBe(false);
      expect(r.lastActivity).toBeUndefined();
    }
  });

  it("skips a room that cannot say what it is", () => {
    // Same rule the pin rows shipped with: a row titled by a fallback like
    // "Chat" sitting among real names reads as a bug; the community row above
    // is still the way in.
    const { rows } = buildRoomRows({
      pins: [],
      joined: [joined("named", "Named"), joined("anon")],
      activity: {},
      lastReadOf: neverRead,
    });
    expect(rows.map((r) => r.groupId)).toEqual(["named"]);
  });

  it("caps the list but never drops a pin, and reports the overflow", () => {
    const { rows, overflow } = buildRoomRows({
      pins: [pin("p1", "P1"), pin("p2", "P2")],
      joined: [joined("j1", "J1"), joined("j2", "J2"), joined("j3", "J3"), joined("j4", "J4")],
      activity: { j1: 4, j2: 3, j3: 2, j4: 1 },
      lastReadOf: neverRead,
      cap: 4,
    });
    expect(rows.map((r) => r.groupId)).toEqual(["p1", "p2", "j1", "j2"]);
    expect(overflow).toBe(2);
  });

  it("pins alone may exceed the cap — the user arranged them deliberately", () => {
    const { rows, overflow } = buildRoomRows({
      pins: [pin("p1", "P1"), pin("p2", "P2"), pin("p3", "P3")],
      joined: [joined("j1", "J1")],
      activity: {},
      lastReadOf: neverRead,
      cap: 2,
    });
    expect(rows.map((r) => r.groupId)).toEqual(["p1", "p2", "p3"]);
    expect(overflow).toBe(1);
  });

  it("an answered map that simply lacks a room stays silent for that room", () => {
    // Partial answers are real: the batch resolves on EOSE-or-timeout with
    // whatever arrived. A missing entry downgrades to "no claim", never to
    // "unread" and never to a zero-aged timestamp.
    const { rows } = buildRoomRows({
      pins: [],
      joined: [joined("known", "Known"), joined("missing", "Missing")],
      activity: { known: 100 },
      lastReadOf: neverRead,
    });
    const missing = rows.find((r) => r.groupId === "missing")!;
    expect(missing.lastActivity).toBeUndefined();
    expect(missing.unread).toBe(false);
    expect(rows.find((r) => r.groupId === "known")!.lastActivity).toBe(100);
  });
});
