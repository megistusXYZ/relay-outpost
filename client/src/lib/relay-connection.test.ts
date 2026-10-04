import { describe, it, expect } from "vitest";
import { probeOutcome, connectionState, speedLine, type ProbeResult } from "./relay-connection";

const R = "wss://harbour.example";
const t0 = 1_000_000;

describe("one probe, read from what the relay did", () => {
  it("opened, answered — with both timings and any notices", () => {
    expect(probeOutcome([
      { relay: R, at: t0, dir: "conn", state: "connecting" },
      { relay: R, at: t0 + 90, dir: "conn", state: "open" },
      { relay: R, at: t0 + 91, dir: "out", msg: ["REQ", "p", { limit: 1 }] },
      { relay: R, at: t0 + 95, dir: "in", msg: ["NOTICE", "maintenance at 02:00 UTC"] },
      { relay: R, at: t0 + 140, dir: "in", msg: ["EOSE", "p"] },
    ], t0)).toEqual({ at: t0, opened: true, openMs: 90, answered: true, answerMs: 49, signIn: "not-asked", notices: ["maintenance at 02:00 UTC"] });
  });

  it("couldn't connect", () => {
    expect(probeOutcome([
      { relay: R, at: t0, dir: "conn", state: "connecting" },
      { relay: R, at: t0 + 150, dir: "conn", state: "error", detail: "connection failed" },
    ], t0)).toEqual({ at: t0, opened: false, answered: false, signIn: "not-asked", error: "connection failed", notices: [] });
  });

  it("wants sign-in, and we didn't (ask / never)", () => {
    const r = probeOutcome([
      { relay: R, at: t0 + 80, dir: "conn", state: "open" },
      { relay: R, at: t0 + 81, dir: "in", msg: ["AUTH", "c"] },
      { relay: R, at: t0 + 82, dir: "out", msg: ["REQ", "p", { limit: 1 }] },
      { relay: R, at: t0 + 120, dir: "in", msg: ["CLOSED", "p", "auth-required: members only"] },
    ], t0);
    expect(r).toMatchObject({ opened: true, answered: true, signIn: "needed" });
  });

  it("signed in, or was turned down", () => {
    const base = [
      { relay: R, at: t0 + 80, dir: "conn" as const, state: "open" as const },
      { relay: R, at: t0 + 81, dir: "in" as const, msg: ["AUTH", "c"] },
      { relay: R, at: t0 + 90, dir: "out" as const, msg: ["AUTH", { id: "a1", kind: 22242 }] },
    ];
    expect(probeOutcome([...base, { relay: R, at: t0 + 100, dir: "in", msg: ["OK", "a1", true, ""] }, { relay: R, at: t0 + 101, dir: "out", msg: ["REQ", "p", {}] }, { relay: R, at: t0 + 130, dir: "in", msg: ["EOSE", "p"] }], t0))
      .toMatchObject({ signIn: "signed-in", answered: true, answerMs: 29 });
    expect(probeOutcome([...base, { relay: R, at: t0 + 100, dir: "in", msg: ["OK", "a1", false, "restricted: not a member"] }], t0))
      .toMatchObject({ signIn: "refused", error: "not a member" });
  });
});

const ok = (answerMs: number, extra: Partial<ProbeResult> = {}): ProbeResult => ({ at: t0, opened: true, openMs: 50, answered: true, answerMs, signIn: "not-asked", notices: [], ...extra });
const down: ProbeResult = { at: t0, opened: false, answered: false, signIn: "not-asked", error: "connection failed", notices: [] };

describe("the four states", () => {
  it("connected, with how fast it answers and how sign-in stands", () => {
    expect(connectionState([ok(84)], true)).toEqual({ state: "connected", word: "Connected", detail: "Answers in 84 ms" });
    expect(connectionState([ok(84, { signIn: "signed-in" })], true)).toEqual({ state: "connected", word: "Connected", detail: "Answers in 84 ms · signed in" });
    expect(connectionState([ok(84, { signIn: "needed" })], true)).toEqual({ state: "connected", word: "Connected", detail: "Answers in 84 ms · wants you to sign in" });
  });

  it("retrying after a miss or two, then an error", () => {
    expect(connectionState([ok(80), down], true)).toEqual({ state: "retrying", word: "Retrying", detail: "Couldn't connect — connection failed · try 2 of 3" });
    expect(connectionState([ok(80), down, down], true)).toEqual({ state: "retrying", word: "Retrying", detail: "Couldn't connect — connection failed · try 3 of 3" });
    expect(connectionState([down, down, down], true)).toEqual({ state: "error", word: "Can't connect", detail: "3 tries in a row — connection failed" });
  });

  it("errors that aren't about connecting", () => {
    expect(connectionState([ok(0, { signIn: "refused", error: "not a member" })], true)).toEqual({ state: "error", word: "Won't let you in", detail: "Sign-in turned down — “not a member”" });
    expect(connectionState([{ ...ok(0), answered: false, answerMs: undefined }], true)).toEqual({ state: "error", word: "Not answering", detail: "It connects, but didn't answer a simple question" });
  });

  it("offline is about this device, not the relay", () => {
    expect(connectionState([ok(84)], false)).toEqual({ state: "offline", word: "Offline", detail: "This device isn't connected — the relay may be fine" });
    expect(connectionState([], true)).toEqual({ state: "checking", word: "Checking…" });
  });
});

describe("speed over time", () => {
  it("the usual answer time and the slowest, from answered probes only", () => {
    expect(speedLine([ok(100), ok(80), down, ok(340), ok(120)])).toBe("Usually answers in 110 ms · slowest 340 ms");
    expect(speedLine([down])).toBeNull();
  });
});
