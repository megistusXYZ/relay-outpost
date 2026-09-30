/**
 * The relay directory, as the monitors report it (NIP-66, kind 30166).
 * Several monitors report each relay every few minutes, so 2,000 reports
 * describe about 950 relays, and a report is ~2 KB of which the directory
 * uses a few tags. Measured 2026-09-30: 6.5 MB read for ~140 KB of directory.
 */
import { describe, it, expect } from "vitest";
import { directoryFromReports, isDirectoryEntry } from "./relay-directory";

const report = (d: string, created_at: number, tags: string[][] = []) =>
  ({ kind: 30166, pubkey: "a".repeat(64), created_at, content: "{\"big\":\"nip-11 copy\"}", tags: [["d", d], ...tags] });

describe("directoryFromReports", () => {
  it("keeps the url, supported NIPs, requirements, software and type", () => {
    const [r] = directoryFromReports([
      report("wss://relay.example.com/", 100, [["N", "1"], ["N", "29"], ["N", "x"], ["R", "Auth"], ["R", "!payment"], ["s", "strfry"], ["T", "PublicInbox"], ["rtt-open", "120"]]),
    ]);
    expect(r).toEqual({
      url: "wss://relay.example.com",
      supportedNips: [1, 29],
      requirements: ["auth", "!payment"],
      software: "strfry",
      relayType: "PublicInbox",
      lastSeen: 100,
    });
  });

  it("one entry per relay, from its newest report, whatever the spelling", () => {
    const out = directoryFromReports([
      report("wss://Relay.Example.com", 100, [["s", "old"]]),
      report("wss://relay.example.com/", 300, [["s", "new"]]),
      report("relay.example.com", 200, [["s", "middle"]]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].software).toBe("new");
    expect(out[0].lastSeen).toBe(300);
  });

  it("a bare host is a wss relay", () => {
    expect(directoryFromReports([report("relay.example.com", 1)])[0].url).toBe("wss://relay.example.com");
  });

  it("skips reports that name no relay", () => {
    expect(directoryFromReports([{ kind: 30166, created_at: 1, tags: [["N", "1"]] }, null, { tags: "nope" }] as any)).toEqual([]);
  });

  it("lists relays that support the most first", () => {
    const out = directoryFromReports([
      report("wss://few.example", 1, [["N", "1"]]),
      report("wss://many.example", 1, [["N", "1"], ["N", "11"], ["N", "29"]]),
    ]);
    expect(out.map((r) => r.url)).toEqual(["wss://many.example", "wss://few.example"]);
  });
});

describe("isDirectoryEntry", () => {
  it("accepts a well-formed entry and refuses anything else", () => {
    const good = { url: "wss://relay.example.com", supportedNips: [1], requirements: [], software: "", relayType: "", lastSeen: 1 };
    expect(isDirectoryEntry(good)).toBe(true);
    expect(isDirectoryEntry({ ...good, url: "https://relay.example.com" })).toBe(false);
    expect(isDirectoryEntry({ ...good, url: "javascript:alert(1)" })).toBe(false);
    expect(isDirectoryEntry({ ...good, supportedNips: "1" })).toBe(false);
    expect(isDirectoryEntry({ ...good, lastSeen: "now" })).toBe(false);
    expect(isDirectoryEntry(null)).toBe(false);
  });
});
