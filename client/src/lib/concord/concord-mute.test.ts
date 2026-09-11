// Mute flags are the notification escape valve: per-community and per-channel,
// local-device, and consulted by EVERY dot/badge/count surface. These tests
// lock the round-trip, the community-OR-channel effective predicate, and the
// change event that lets live surfaces recompute.

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage/window; the flags read them synchronously.
const __store = new Map<string, string>();
const __dispatched: string[] = [];
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
  clear: () => { __store.clear(); },
});
vi.stubGlobal("window", {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (e: { type: string }) => { __dispatched.push(e.type); return true; },
});
vi.stubGlobal("Event", class { type: string; constructor(type: string) { this.type = type; } });

import {
  isCommunityMuted, isChannelMuted, isMuted,
  setCommunityMuted, setChannelMuted,
  channelMuteKey, MUTE_CHANGED_EVENT,
  muteEntries, applyMuteEntries,
} from "./concord-mute";

beforeEach(() => { __store.clear(); __dispatched.length = 0; });

describe("each change records when it was made, so the latest wins on every device", () => {
  it("lists mutes and unmutes with their time, and asks the read-state sync to publish", () => {
    setCommunityMuted("c1", true);
    setChannelMuted("c1", "ch1", true);
    setChannelMuted("c1", "ch1", false);
    const e = muteEntries();
    expect(e["c:c1"]).toMatchObject({ muted: true });
    expect(e["c:c1"].at).toBeGreaterThan(0);
    expect(e["ch:c1|ch1"]).toMatchObject({ muted: false });
    expect(__dispatched).toContain("readstate-changed");
  });

  it("a mute from before times were kept still travels", () => {
    __store.set("ro_concord_mute_v1", JSON.stringify({ communities: ["old"], channels: [] }));
    expect(muteEntries()["c:old"]).toEqual({ muted: true, at: 0 });
  });

  it("applying another device's changes takes only the newer ones, without asking to publish again", () => {
    setCommunityMuted("c1", true);
    const at = muteEntries()["c:c1"].at;
    __dispatched.length = 0;
    expect(applyMuteEntries({ "c:c1": { muted: false, at: at - 1 } })).toBe(false);
    expect(applyMuteEntries({ "c:c1": { muted: false, at: at + 1 }, "c:c2": { muted: true, at: 5 } })).toBe(true);
    expect(isCommunityMuted("c1")).toBe(false);
    expect(isCommunityMuted("c2")).toBe(true);
    expect(__dispatched).toContain(MUTE_CHANGED_EVENT);
    expect(__dispatched).not.toContain("readstate-changed");
  });
});

describe("mute flag round-trip", () => {
  it("defaults to unmuted everywhere", () => {
    expect(isCommunityMuted("c1")).toBe(false);
    expect(isChannelMuted("c1", "ch1")).toBe(false);
    expect(isMuted("c1", "ch1")).toBe(false);
  });

  it("community mute round-trips", () => {
    setCommunityMuted("c1", true);
    expect(isCommunityMuted("c1")).toBe(true);
    expect(isCommunityMuted("c2")).toBe(false);
    setCommunityMuted("c1", false);
    expect(isCommunityMuted("c1")).toBe(false);
  });

  it("channel mute round-trips and is scoped to its community", () => {
    setChannelMuted("c1", "ch1", true);
    expect(isChannelMuted("c1", "ch1")).toBe(true);
    expect(isChannelMuted("c1", "ch2")).toBe(false);
    expect(isChannelMuted("c2", "ch1")).toBe(false);
    setChannelMuted("c1", "ch1", false);
    expect(isChannelMuted("c1", "ch1")).toBe(false);
  });

  it("survives a reload (state is persisted, not in-memory)", () => {
    setCommunityMuted("c1", true);
    setChannelMuted("c2", "chX", true);
    // A different import would re-read the same storage; simulate by reading raw.
    const raw = JSON.parse(__store.get("ro_concord_mute_v1")!);
    expect(raw.communities).toEqual(["c1"]);
    expect(raw.channels).toEqual([channelMuteKey("c2", "chX")]);
  });

  it("garbage in storage degrades to unmuted", () => {
    __store.set("ro_concord_mute_v1", "{not json");
    expect(isMuted("c1", "ch1")).toBe(false);
    __store.set("ro_concord_mute_v1", JSON.stringify({ communities: "nope", channels: [42] }));
    expect(isCommunityMuted("c1")).toBe(false);
    expect(isChannelMuted("c1", "ch1")).toBe(false);
  });
});

describe("effective mute (community OR channel)", () => {
  it("community mute silences every channel in it", () => {
    setCommunityMuted("c1", true);
    expect(isMuted("c1", "general")).toBe(true);
    expect(isMuted("c1", "random")).toBe(true);
    expect(isMuted("c2", "general")).toBe(false);
  });

  it("channel mute silences only that channel", () => {
    setChannelMuted("c1", "random", true);
    expect(isMuted("c1", "random")).toBe(true);
    expect(isMuted("c1", "general")).toBe(false);
  });

  it("unmuting the community keeps a per-channel mute in force", () => {
    setCommunityMuted("c1", true);
    setChannelMuted("c1", "random", true);
    setCommunityMuted("c1", false);
    expect(isMuted("c1", "random")).toBe(true);
    expect(isMuted("c1", "general")).toBe(false);
  });
});

// A change here also asks the read-state sync to publish ("readstate-changed");
// these pin the mute event itself.
const muteEvents = () => __dispatched.filter((t) => t === MUTE_CHANGED_EVENT);

describe("change event", () => {
  it("dispatches MUTE_CHANGED_EVENT on every state change", () => {
    setCommunityMuted("c1", true);
    setChannelMuted("c1", "ch1", true);
    expect(muteEvents()).toEqual([MUTE_CHANGED_EVENT, MUTE_CHANGED_EVENT]);
  });

  it("no-op writes (same value) do not dispatch", () => {
    setCommunityMuted("c1", false); // already unmuted
    setChannelMuted("c1", "ch1", false);
    expect(__dispatched).toEqual([]); // nothing at all: no publish for a no-op either
    setCommunityMuted("c1", true);
    setCommunityMuted("c1", true); // repeat
    expect(muteEvents()).toEqual([MUTE_CHANGED_EVENT]);
  });
});
