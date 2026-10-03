import { describe, it, expect, vi } from "vitest";
import {
  readSupportedMethods, canDo, canManage, methodsToTry, callFirstSupported, managedAt,
  UNKNOWN_CAPABILITIES,
} from "./relay-capabilities";

// What relay.tools' legacy endpoint (in front of *.nostr1.com) answers to
// `supportedmethods` for the relay's owner and for anyone else (relaycreator
// pages/api/86/[id].ts, read 2026-10-03).
const NOSTR1_OWNER = [
  "supportedmethods", "deletedmsuntil", "deletedmsid",
  "banpubkey", "listbannedpubkeys", "deletebannedpubkey", "allowpubkey", "deleteallowedpubkey",
  "listallowedpubkeys", "banevent", "changerelaydescription", "changerelayicon", "changerelayname",
  "allowkind", "disallowkind", "listallowedkinds",
];
const NOSTR1_STRANGER = ["supportedmethods", "deletedmsuntil", "deletedmsid"];
// pyramid (fiatjaf): bans and allows, no way to lift either.
const PYRAMID = ["supportedmethods", "banpubkey", "allowpubkey", "listallowedpubkeys", "listbannedpubkeys", "banevent", "changerelayname", "changerelaydescription", "changerelayicon"];

describe("reading what a relay says it supports", () => {
  it("takes the relay's list when it gives one", () => {
    const caps = readSupportedMethods({ result: NOSTR1_OWNER });
    expect(caps.listed?.has("deletebannedpubkey")).toBe(true);
  });

  it("knows nothing when the relay answered with an error or no list", () => {
    expect(readSupportedMethods({ error: "Method 'supportedmethods' not supported" }).listed).toBeNull();
    expect(readSupportedMethods({ result: true }).listed).toBeNull();
    expect(readSupportedMethods({}).listed).toBeNull();
  });
});

describe("what the console offers on a nostr1.com relay", () => {
  const owner = readSupportedMethods({ result: NOSTR1_OWNER });

  it("lifts a ban with the host's own method name", () => {
    expect(canDo(owner, "unban")).toBe(true);
    expect(methodsToTry(owner, "unban")).toEqual(["deletebannedpubkey"]);
    expect(methodsToTry(owner, "unallow")).toEqual(["deleteallowedpubkey"]);
  });

  it("doesn't offer a banner or moderators, which the relay can't store", () => {
    expect(canDo(owner, "banner")).toBe(false);
    expect(canDo(owner, "moderators")).toBe(false);
  });

  it("still offers name, description, icon, bans and removing posts", () => {
    for (const a of ["name", "description", "icon", "ban", "allow", "removeEvent"] as const) {
      expect(canDo(owner, a)).toBe(true);
    }
  });

  it("tells the owner apart from someone the relay won't let manage it", () => {
    expect(canManage(owner)).toBe(true);
    expect(canManage(readSupportedMethods({ result: NOSTR1_STRANGER }))).toBe(false);
  });
});

describe("a relay with no way to lift a ban", () => {
  it("offers no unban at all", () => {
    const caps = readSupportedMethods({ result: PYRAMID });
    expect(canDo(caps, "unban")).toBe(false);
    expect(methodsToTry(caps, "unban")).toEqual([]);
  });
});

describe("a relay that didn't say what it supports", () => {
  it("tries the standard name first and the known alternative after", () => {
    expect(methodsToTry(UNKNOWN_CAPABILITIES, "unban")).toEqual(["unbanpubkey", "deletebannedpubkey"]);
  });

  it("offers the controls nearly every relay has", () => {
    expect(canDo(UNKNOWN_CAPABILITIES, "name")).toBe(true);
    expect(canDo(UNKNOWN_CAPABILITIES, "ban")).toBe(true);
  });

  it("doesn't offer a banner or moderators, which almost no relay has", () => {
    expect(canDo(UNKNOWN_CAPABILITIES, "banner")).toBe(false);
    expect(canDo(UNKNOWN_CAPABILITIES, "moderators")).toBe(false);
  });

  it("can't claim the viewer manages it", () => {
    expect(canManage(UNKNOWN_CAPABILITIES)).toBe(false);
  });
});

describe("a relay whose management address is just a web page", () => {
  it("offers nothing — the API isn't there", () => {
    const caps = readSupportedMethods({ error: "Relay returned an HTML page instead of JSON-RPC", isHtml: true });
    expect(caps.noApi).toBe(true);
    expect(canDo(caps, "ban")).toBe(false);
    expect(canDo(caps, "removeEvent")).toBe(false);
  });
});

describe("calling the first method a relay understands", () => {
  it("moves on to the alternative when the relay doesn't know the standard name", async () => {
    const call = vi.fn(async (method: string) =>
      method === "unbanpubkey" ? { error: "Method 'unbanpubkey' not supported" } : { result: true });
    const res = await callFirstSupported(call, ["unbanpubkey", "deletebannedpubkey"], ["ab".repeat(32)]);
    expect(res).toEqual({ result: true });
    expect(call.mock.calls.map((c) => c[0])).toEqual(["unbanpubkey", "deletebannedpubkey"]);
  });

  it("stops at a real refusal instead of trying another name", async () => {
    const call = vi.fn(async () => ({ error: "Not authorized to manage this relay" }));
    const res = await callFirstSupported(call, ["unbanpubkey", "deletebannedpubkey"], []);
    expect(res.error).toBe("Not authorized to manage this relay");
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the relay has no way to do it", async () => {
    const call = vi.fn();
    const res = await callFirstSupported(call, [], []);
    expect(res.error).toMatch(/can't do this/i);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("where a setting is managed when we can't change it", () => {
  it("names relay.tools for its relays and nostr1.com relays", () => {
    expect(managedAt("wss://relay-op.nostr1.com")).toEqual({ name: "relay.tools", url: "https://relay.tools" });
    expect(managedAt("wss://bunk-test.feeds.relay.tools")).toEqual({ name: "relay.tools", url: "https://feeds.relay.tools" });
  });

  it("points anyone else at their relay's own settings", () => {
    expect(managedAt("wss://relay.example.com")).toEqual({ name: "your relay's own settings" });
  });
});
