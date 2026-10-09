/**
 * "Who can post" on a newlay relay (relay.tools Feeds): the relay's own trust
 * gate (MANAGEMENT_API.md §3.9) as two plain choices — Anyone, or People your
 * network trusts. The gate lets through members, people the operator follows
 * and anyone the operator's network trusts enough (the cutoff), so approved
 * people can always post.
 *
 * The settings objects are shaped from the doc's getwotsettings example.
 */
import { describe, it, expect } from "vitest";
import { readPostingGate, callsToChoose } from "./posting-gate";
import { canDo, readSupportedMethods } from "./relay-capabilities";

const ME = "ab".repeat(32);
const SETTINGS = { enabled: true, computing: true, configured: true, cutoff: 0.05, gate_writes: false, gate_writes_exempt_kinds: [], observer: ME };

describe("reading the relay's gate", () => {
  it("is Anyone while writes aren't gated", () => {
    expect(readPostingGate(SETTINGS, { wired: true })).toEqual({ choice: "anyone" });
  });
  it("is People your network trusts when the gate is on and the filter is live", () => {
    expect(readPostingGate({ ...SETTINGS, gate_writes: true }, { wired: true })).toEqual({ choice: "network" });
  });
  it("is still Anyone when the gate is set but the filter is off — that's what the relay does", () => {
    expect(readPostingGate({ ...SETTINGS, gate_writes: true, enabled: false }, { wired: true })).toEqual({ choice: "anyone" });
  });
  it("can't be offered on a relay whose host didn't switch trust checks on", () => {
    expect(readPostingGate(SETTINGS, { wired: false })).toEqual({ choice: null, why: "host-off" });
  });
  it("can't be read from a refusal or a malformed answer", () => {
    expect(readPostingGate(undefined, { wired: true })).toEqual({ choice: null, why: "unread" });
    expect(readPostingGate({ enabled: "yes" }, { wired: true })).toEqual({ choice: null, why: "unread" });
  });
});

describe("choosing", () => {
  it("People your network trusts: sets you as the one whose network counts when nobody is, switches the filter on, gates posting", () => {
    expect(callsToChoose("network", { ...SETTINGS, observer: null, configured: false, enabled: false }, ME)).toEqual([
      { method: "setwotobserver", params: [ME] },
      { method: "setwotenabled", params: [true] },
      { method: "setwotgatewrites", params: [true] },
    ]);
  });
  it("keeps an observer the host already chose, and doesn't resend what's already on", () => {
    const other = "cd".repeat(32);
    expect(callsToChoose("network", { ...SETTINGS, observer: other }, ME)).toEqual([
      { method: "setwotgatewrites", params: [true] },
    ]);
  });
  it("Anyone: only lifts the gate — the filter keeps working for search", () => {
    expect(callsToChoose("anyone", { ...SETTINGS, gate_writes: true }, ME)).toEqual([
      { method: "setwotgatewrites", params: [false] },
    ]);
  });
  it("nothing to send when it's already that way", () => {
    expect(callsToChoose("anyone", SETTINGS, ME)).toEqual([]);
    expect(callsToChoose("network", { ...SETTINGS, gate_writes: true }, ME)).toEqual([]);
  });
});

describe("whether to offer it", () => {
  it("only on a relay that lists every call it needs", () => {
    const all = ["supportedmethods", "getwotsettings", "setwotenabled", "setwotgatewrites", "setwotobserver", "getrelaystatus"];
    expect(canDo(readSupportedMethods({ result: all }), "postingGate")).toBe(true);
    expect(canDo(readSupportedMethods({ result: all.filter((m) => m !== "setwotgatewrites") }), "postingGate")).toBe(false);
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "banpubkey"] }), "postingGate")).toBe(false);
  });
});
