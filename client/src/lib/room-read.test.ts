/**
 * A NIP-29 group id is only unique PER RELAY — every relay's unnamed default
 * room is literally "_" — so read marks must carry the relay in their key.
 *
 * The failure this guards (found by review before it shipped): reading General
 * on relay A wrote a groupId-only mark; the Chats list then compared relay B's
 * General against it and rendered a confident "nothing new" about messages the
 * user had never seen. Monotonic writes made it permanent in one direction —
 * the busier relay's mark forever muted the quieter room's dot.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const backing = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
});

import { readChannelLastRead, writeChannelLastRead } from "./room-read";

describe("room read marks are relay-scoped", () => {
  beforeEach(() => backing.clear());

  it("the same group id on two relays keeps two independent marks", () => {
    writeChannelLastRead("wss://relay-a.example", "_", 1_700_000_000);
    expect(readChannelLastRead("wss://relay-a.example", "_")).toBe(1_700_000_000);
    // Relay B's "_" is a DIFFERENT room and has never been read.
    expect(readChannelLastRead("wss://relay-b.example", "_")).toBe(0);
  });

  it("trailing slash and case are not different relays", () => {
    writeChannelLastRead("wss://Relay.Example/", "room1", 500);
    expect(readChannelLastRead("wss://relay.example", "room1")).toBe(500);
  });

  it("falls back to a legacy unscoped mark so upgrading doesn't cry unread", () => {
    backing.set("ro_chan_read_pilot", "1234");
    expect(readChannelLastRead("wss://any.example", "pilot")).toBe(1234);
  });

  it("a scoped write retires the legacy fallback for that room only", () => {
    backing.set("ro_chan_read_pilot", "9999");
    writeChannelLastRead("wss://a.example", "pilot", 10_000);
    expect(readChannelLastRead("wss://a.example", "pilot")).toBe(10_000);
    // Another relay's same-id room still sees only the legacy floor — until
    // it is opened once, which writes its own scoped mark.
    expect(readChannelLastRead("wss://b.example", "pilot")).toBe(9999);
  });

  it("stays monotonic per room: an older timestamp never wins", () => {
    writeChannelLastRead("wss://a.example", "r", 100);
    writeChannelLastRead("wss://a.example", "r", 50);
    expect(readChannelLastRead("wss://a.example", "r")).toBe(100);
  });
});
