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
import { isNip86Method } from "@shared/nip86-methods";

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
  // Private messages and group chats are signed by a one-time key, so to the
  // gate they always look like a stranger (newlay CORDN.md §1: "strangers
  // cannot store gift wraps here past the gate"). The choice promises only
  // that strangers' POSTS are turned away, so the gate must let the wraps
  // (1059) and invite links (33301) through — on top of whatever the host
  // already exempted, since setwotexemptkinds replaces the whole list.
  it("People your network trusts: sets you as the one whose network counts when nobody is, switches the filter on, lets messages through, gates posting", () => {
    expect(callsToChoose("network", { ...SETTINGS, observer: null, configured: false, enabled: false }, ME)).toEqual([
      { method: "setwotobserver", params: [ME] },
      { method: "setwotenabled", params: [true] },
      { method: "setwotexemptkinds", params: [[1059, 33301]] },
      { method: "setwotgatewrites", params: [true] },
    ]);
  });
  it("keeps an observer the host already chose, keeps their exemptions, and doesn't resend what's already on", () => {
    const other = "cd".repeat(32);
    expect(callsToChoose("network", { ...SETTINGS, observer: other, gate_writes_exempt_kinds: [21000] }, ME)).toEqual([
      { method: "setwotexemptkinds", params: [[1059, 21000, 33301]] },
      { method: "setwotgatewrites", params: [true] },
    ]);
    expect(callsToChoose("network", { ...SETTINGS, gate_writes_exempt_kinds: [33301, 1059] }, ME)).toEqual([
      { method: "setwotgatewrites", params: [true] },
    ]);
  });
  it("the exemptions are sent before the gate goes up, so no message is refused in between", () => {
    const calls = callsToChoose("network", { ...SETTINGS, enabled: false }, ME).map((c) => c.method);
    expect(calls.indexOf("setwotexemptkinds")).toBeLessThan(calls.indexOf("setwotgatewrites"));
  });
  it("Anyone: only lifts the gate — the filter keeps working for search", () => {
    expect(callsToChoose("anyone", { ...SETTINGS, gate_writes: true }, ME)).toEqual([
      { method: "setwotgatewrites", params: [false] },
    ]);
  });
  it("nothing to send when it's already that way", () => {
    expect(callsToChoose("anyone", SETTINGS, ME)).toEqual([]);
    expect(callsToChoose("network", { ...SETTINGS, gate_writes: true, gate_writes_exempt_kinds: [1059, 33301] }, ME)).toEqual([]);
  });
});

describe("every call the choice can send", () => {
  // The proxy refuses any method not on the shared list — a pure test can't
  // see that, so pin it here (setwotexemptkinds was missing, 2026-10-09).
  it("is a method our proxy forwards", () => {
    const sent = new Set<string>();
    for (const choice of ["network", "anyone"] as const) {
      for (const c of callsToChoose(choice, { ...SETTINGS, observer: null, enabled: false, gate_writes: choice === "anyone" }, ME)) sent.add(c.method);
    }
    expect([...sent].filter((m) => !isNip86Method(m))).toEqual([]);
    expect(sent.size).toBeGreaterThan(2);
  });
});

describe("whether to offer it", () => {
  it("only on a relay that lists every call it needs", () => {
    const all = ["supportedmethods", "getwotsettings", "setwotenabled", "setwotgatewrites", "setwotobserver", "setwotexemptkinds", "getrelaystatus"];
    expect(canDo(readSupportedMethods({ result: all }), "postingGate")).toBe(true);
    expect(canDo(readSupportedMethods({ result: all.filter((m) => m !== "setwotgatewrites") }), "postingGate")).toBe(false);
    expect(canDo(readSupportedMethods({ result: all.filter((m) => m !== "setwotexemptkinds") }), "postingGate")).toBe(false);
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "banpubkey"] }), "postingGate")).toBe(false);
  });
});
