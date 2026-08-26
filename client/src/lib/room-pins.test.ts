/**
 * One pin press writes two stores, so one unpin press must clear two stores.
 *
 * This is a regression test for a defect that was MEASURED, not imagined. The
 * Chats-list Unpin shipped calling `unpinFeed` alone; clicking it in a browser
 * removed the row and left `comms_pinned_wss://bunk-test…` still holding
 * `["pilot-6kqfeu"]` — so the room vanished from Chats while staying pinned at
 * the top of its own room list with a filled pin icon. Half the act.
 *
 * The two stores answer different questions and both should exist; what must
 * not drift is what "unpin" means depending on which surface you pressed it on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// vitest runs in the node environment — the same Map-backed stub the other
// storage tests use, so the guarded wrappers exercise their real read/write
// paths rather than a mock of themselves.
const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});
// savePinnedFeeds dispatches on `window`, which the node environment lacks.
// Stubbed rather than silenced: the dispatch is load-bearing for this feature —
// it is how the Chats row removes itself without local state — so the stub
// RECORDS it and the test below asserts it fired.
const dispatched: string[] = [];
vi.stubGlobal("window", {
  dispatchEvent: (e: Event) => void dispatched.push(e.type),
  addEventListener: () => {},
  removeEventListener: () => {},
});
vi.stubGlobal("CustomEvent", class { type: string; constructor(t: string) { this.type = t; } } as unknown as typeof CustomEvent);
// pinFeed auto-joins the pin's relay, which reaches for the outpost store and
// the network. Stubbed to a no-op: what is under test is which STORES an unpin
// clears, and a real join would drag a relay fetch into a pure storage test.
vi.mock("@/lib/outpost-relays", () => ({
  getOutpostRelays: () => [],
  joinOutpostWithEnrichment: () => Promise.resolve(),
}));

import { getPinnedRooms, setPinnedRooms, unpinRoomEverywhere } from "./room-pins";
import { getPinnedFeeds, pinFeed } from "./pinned-feeds";

const RELAY = "wss://bunk-test.feeds.relay.tools";
const ROOM = "pilot-6kqfeu";
const PIN_ID = `${RELAY}::channels::${ROOM}`;

/** Both stores holding the same room, the state one pin press produces. */
function pinBothWays() {
  setPinnedRooms(RELAY, new Set([ROOM]));
  pinFeed({ relayUrl: RELAY, tab: "channels", label: "Pilot", channelId: ROOM, channelLabel: "Pilot" });
}

describe("unpinRoomEverywhere", () => {
  beforeEach(() => localStorage.clear());

  it("clears BOTH stores, so the room does not stay pinned in its own list", () => {
    pinBothWays();
    expect(getPinnedRooms(RELAY).has(ROOM)).toBe(true);
    expect(getPinnedFeeds().some((f) => f.id === PIN_ID)).toBe(true);

    unpinRoomEverywhere(RELAY, ROOM, PIN_ID);

    expect(getPinnedRooms(RELAY).has(ROOM)).toBe(false);
    expect(getPinnedFeeds().some((f) => f.id === PIN_ID)).toBe(false);
  });

  it("announces the change, which is how every other surface finds out", () => {
    // The Chats row, the sidebar and the hub all re-read on this event. Without
    // it the unpin would look like it worked on the surface you pressed and
    // nowhere else — a subtler version of the same half-act.
    pinBothWays();
    dispatched.length = 0;
    unpinRoomEverywhere(RELAY, ROOM, PIN_ID);
    expect(dispatched).toContain("pinned-feeds-changed");
  });

  it("leaves other pinned rooms on the same relay alone", () => {
    setPinnedRooms(RELAY, new Set([ROOM, "other-room"]));
    unpinRoomEverywhere(RELAY, ROOM, PIN_ID);
    expect([...getPinnedRooms(RELAY)]).toEqual(["other-room"]);
  });

  it("is a no-op rather than a throw when the room was never pinned", () => {
    expect(() => unpinRoomEverywhere(RELAY, "never-pinned", "no-such-id")).not.toThrow();
    expect([...getPinnedRooms(RELAY)]).toEqual([]);
  });

  it("finds the room whether or not the relay url carries a trailing slash", () => {
    // The two stores normalize differently on purpose (see keyFor), so this is
    // the seam where an unpin could silently miss its target.
    setPinnedRooms(RELAY, new Set([ROOM]));
    unpinRoomEverywhere(`${RELAY}/`, ROOM, PIN_ID);
    expect(getPinnedRooms(RELAY).has(ROOM)).toBe(false);
  });
});

describe("the per-relay store's key", () => {
  beforeEach(() => localStorage.clear());

  it("does not lowercase, because existing pins were written with the original casing", () => {
    // Tightening this to normalizeUrl would orphan every pin already made
    // rather than migrate it — a silent data loss that looks like a cleanup.
    const mixed = "wss://Bunk-Test.Feeds.Relay.Tools";
    setPinnedRooms(mixed, new Set([ROOM]));
    expect(localStorage.getItem(`comms_pinned_${mixed}`)).toBe(JSON.stringify([ROOM]));
    expect(getPinnedRooms(mixed).has(ROOM)).toBe(true);
  });

  it("survives unparseable storage instead of taking the room list down", () => {
    localStorage.setItem(`comms_pinned_${RELAY}`, "{not json");
    expect([...getPinnedRooms(RELAY)]).toEqual([]);
  });
});
