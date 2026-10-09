/**
 * "How your relay is doing" — newlay's getrelaystatus (MANAGEMENT_API.md §6)
 * in words an operator who has never heard of NIP-86 can read. The status
 * objects below are shaped from the doc's own example, not from our code.
 */
import { describe, it, expect } from "vitest";
import { describeRelayStatus } from "./relay-status";
import { canDo, readSupportedMethods, UNKNOWN_CAPABILITIES } from "./relay-capabilities";

const HOUR = 3600, DAY = 86400;
const STATUS = {
  relay: { software: "newlay", version: "0.3.18", self: "ab".repeat(32) },
  uptime_seconds: 12 * DAY + 5 * HOUR,
  subsystems: { nip29: true, nip43: false, nip86: true, wot: true, blossom: true, spider: false, search: true },
  store: {
    lifetime_writes: 91234,
    events_by_kind: { "0": 812, "1": 48210, "3": 640, "4": 0, "6": 1200, "7": 22000, "1063": 0, "1984": 3, "9735": 410, "10002": 500, "30023": 37, "9000": 12, "39000": 4 },
    blobs: 286,
  },
  spider: null,
  wot: { observer: "7cc3a1b2", computed: true, last_computed_seconds_ago: 2 * HOUR, rounds: 6, scored_users: 5400, trusted_users: 1203, cutoff: 0.05 },
};

describe("how your relay is doing", () => {
  it("says how long it has been up, in days once it's past a day", () => {
    expect(describeRelayStatus(STATUS)!.uptime).toBe("Up for 12 days");
    expect(describeRelayStatus({ ...STATUS, uptime_seconds: 3 * HOUR + 40 })!.uptime).toBe("Up for 3 hours");
    expect(describeRelayStatus({ ...STATUS, uptime_seconds: 90 })!.uptime).toBe("Just restarted");
  });

  it("counts what people keep there, in their words — biggest first, empty ones left out", () => {
    expect(describeRelayStatus(STATUS)!.counts).toEqual([
      { label: "Posts", value: "48,210" },
      { label: "Reactions", value: "22,000" },
      { label: "Reposts", value: "1,200" },
      { label: "Profiles", value: "812" },
      { label: "Zaps", value: "410" },
      { label: "Media files", value: "286" },
      { label: "Articles", value: "37" },
    ]);
  });

  it("says where its trust scores stand", () => {
    expect(describeRelayStatus(STATUS)!.trust).toBe("Trust scores updated 2 hours ago · 1,203 trusted people");
    expect(describeRelayStatus({ ...STATUS, wot: { ...STATUS.wot, computed: false, last_computed_seconds_ago: null } })!.trust)
      .toBe("Trust scores are being worked out");
    expect(describeRelayStatus({ ...STATUS, wot: null })!.trust).toBeNull();
  });

  it("names what's switched on, not the subsystem codes", () => {
    expect(describeRelayStatus(STATUS)!.features).toEqual(["Groups", "Search", "Media storage", "Trust filter"]);
  });

  it("keeps the engine and version as a small print line", () => {
    expect(describeRelayStatus(STATUS)!.software).toBe("newlay 0.3.18");
  });

  it("is nothing to show when the relay didn't send a report", () => {
    expect(describeRelayStatus(undefined)).toBeNull();
    expect(describeRelayStatus({ error: "status reporting is disabled" })).toBeNull();
    expect(describeRelayStatus("ok")).toBeNull();
  });
});

describe("whether to ask for it", () => {
  it("only when the relay lists getrelaystatus — never guessed for an unlisted relay", () => {
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "getrelaystatus", "banpubkey"] }), "status")).toBe(true);
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "banpubkey", "deletebannedpubkey"] }), "status")).toBe(false);
    expect(canDo(UNKNOWN_CAPABILITIES, "status")).toBe(false);
  });
});
