/**
 * Which relays a brand-new account is given (owner, 2026-10-10). A new
 * account's first kind-10002 used to name ten relays — our six defaults plus
 * four from the discovery pool, one of them a test relay — and its first
 * feed was strangers from all of them. Now, with the wider network off, the
 * account carries a two-relay FLOOR: just enough that friends on other apps
 * can find its profile and message it. Opening the wider network expands the
 * list to the defaults, junk-filtered, with the pay-to-post relay kept for
 * reading only.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_RELAYS } from "./relay-constants";
import {
  FLOOR_RELAYS,
  floorRelayList,
  floorDmRelayList,
  expandedRelayTags,
  relayTagsForMode,
  readRelaysForMode,
} from "./signup-relays";

describe("the floor — reachable, nothing more", () => {
  it("is exactly damus and nos.lol, for the profile and the inbox", () => {
    expect(floorRelayList()).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
    expect(floorDmRelayList()).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
    expect(FLOOR_RELAYS).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });
});

describe("the expanded list — when the wider network is opened", () => {
  it("is the app's defaults, and never a test, staging or local relay", () => {
    const tags = expandedRelayTags({ junkCandidates: ["wss://top.testrelay.top", "wss://relay.staging.example"] });
    const urls = tags.map((t) => t[1]);
    for (const d of DEFAULT_RELAYS) expect(urls).toContain(d);
    expect(urls).not.toContain("wss://top.testrelay.top");
    expect(urls).not.toContain("wss://relay.staging.example");
    expect(urls.length).toBe(DEFAULT_RELAYS.length);
  });
  it("marks the pay-to-post relay read-only: other apps must not send a new account's posts somewhere that refuses them", () => {
    const tags = expandedRelayTags();
    const land = tags.find((t) => t[1] === "wss://nostr.land");
    expect(land).toEqual(["r", "wss://nostr.land", "read"]);
    const damus = tags.find((t) => t[1] === "wss://relay.damus.io");
    expect(damus).toEqual(["r", "wss://relay.damus.io"]); // read + write
  });
});

describe("relayTagsForMode — what the switch publishes", () => {
  const joined = ["wss://my-community.example"];
  it("off: the floor plus the communities this account joined (a flip must not drop them)", () => {
    const current = [["r", "wss://relay.damus.io"], ["r", "wss://nos.lol"], ["r", "wss://relay.primal.net"], ["r", "wss://my-community.example"]];
    expect(relayTagsForMode(false, current, joined)).toEqual([
      ["r", "wss://relay.damus.io"],
      ["r", "wss://nos.lol"],
      ["r", "wss://my-community.example"],
    ]);
  });
  it("on: everything already there, plus the expanded defaults, no duplicates", () => {
    const current = [["r", "wss://relay.damus.io"], ["r", "wss://my-community.example"]];
    const tags = relayTagsForMode(true, current, joined);
    const urls = tags.map((t) => t[1]);
    expect(urls[0]).toBe("wss://relay.damus.io");
    expect(urls).toContain("wss://my-community.example");
    for (const d of DEFAULT_RELAYS) expect(urls).toContain(d);
    expect(new Set(urls).size).toBe(urls.length);
  });
  it("on: a relay the account already had keeps its own marker", () => {
    const current = [["r", "wss://relay.damus.io", "write"]];
    const tags = relayTagsForMode(true, current, []);
    expect(tags.find((t) => t[1] === "wss://relay.damus.io")).toEqual(["r", "wss://relay.damus.io", "write"]);
  });
});

describe("readRelaysForMode — where feeds are read from", () => {
  const fast = ["wss://relay.damus.io", "wss://relay.snort.social", "wss://nostr.land", "wss://relay.primal.net"];
  it("on, or no switch at all: exactly today's list — an existing account sees no change", () => {
    expect(readRelaysForMode(true, fast)).toEqual(fast);
  });
  it("off: the floor only", () => {
    expect(readRelaysForMode(false, fast)).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });
});
