/**
 * Who's in a call (Concord CORD-07 §4). Presence rides the room itself, sealed
 * like any room message, so relays and the media server stay blind to who is
 * calling. A caller announces "joined" with the identity the media server gave
 * them and which media server they're on, every 30 seconds while in the call.
 */
import { describe, it, expect } from "vitest";
import { buildPresenceRumor, callRoster, matchCallers, KIND_CALL_PRESENCE } from "./concord-presence";

const ME = "aa".repeat(32);
const ROOM = "22".repeat(32);
const IDENTITY = "0123456789abcdef0123456789abcdef";

describe("call presence", () => {
  it("announces joining a call with the caller's media-server identity and which server they're on", () => {
    const rumor = buildPresenceRumor(ME, ROOM, 3n, { state: "joined", identity: IDENTITY, broker: "https://relayop.xyz" }, 417, 1_789_240_000);
    expect(rumor.kind).toBe(KIND_CALL_PRESENCE);
    expect(KIND_CALL_PRESENCE).toBe(23313);
    expect(rumor.pubkey).toBe(ME);
    expect(rumor.content).toBe("joined");
    expect(rumor.tags).toEqual([
      ["channel", ROOM], ["epoch", "3"], ["identity", IDENTITY], ["broker", "https://relayop.xyz"], ["ms", "417"],
    ]);
  });

  it("announces leaving with nothing about the caller's media-server seat", () => {
    const rumor = buildPresenceRumor(ME, ROOM, 3n, { state: "left" }, 5, 1_789_240_000);
    expect(rumor.content).toBe("left");
    expect(rumor.tags).toEqual([["channel", ROOM], ["epoch", "3"], ["ms", "5"]]);
  });

  it("knows who's in the call: each member's latest word wins, and a member silent for 90 seconds is gone", () => {
    const joined = (who: string, id: string, at: number) =>
      buildPresenceRumor(who, ROOM, 3n, { state: "joined", identity: id, broker: "https://relayop.xyz" }, 0, at);
    const left = (who: string, at: number) => buildPresenceRumor(who, ROOM, 3n, { state: "left" }, 0, at);
    const alice = "a1".repeat(32), bob = "b0".repeat(32), carol = "c4".repeat(32);
    const roster = callRoster([
      joined(alice, "old-seat", 950),
      joined(alice, "seat-a", 1000),   // Alice's latest heartbeat wins
      joined(bob, "seat-b", 1000),
      left(bob, 1010),                 // Bob hung up
      joined(carol, "seat-c", 900),    // Carol's last word is 105s old: stale
    ], 1_005_000);
    expect([...roster.keys()]).toEqual([alice]);
    expect(roster.get(alice)).toMatchObject({ identity: "seat-a", broker: "https://relayop.xyz" });
  });

  it("shows a caller as a member only when exactly one member claims their seat", () => {
    const alice = "a1".repeat(32), bob = "b0".repeat(32), mallory = "e5".repeat(32);
    const seat = (identity: string) => ({ identity, broker: "https://relayop.xyz", at: 1_000_000 });
    const roster = new Map([[alice, seat("seat-a")], [bob, seat("seat-x")], [mallory, seat("seat-x")]]);
    // What the media server says is in the room.
    const callers = matchCallers(roster, ["seat-a", "seat-x", "seat-z"]);
    expect(callers).toEqual([
      { identity: "seat-a", member: alice, contested: false },
      // Mallory copied Bob's seat: a contested claim proves nothing about either.
      { identity: "seat-x", member: null, contested: true },
      // Nobody claims this one.
      { identity: "seat-z", member: null, contested: false },
    ]);
  });
});
