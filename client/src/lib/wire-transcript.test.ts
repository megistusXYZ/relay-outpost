import { describe, it, expect } from "vitest";
import { transcript, relayOutcomes, compareRelays, type WireFrame } from "@/lib/wire-transcript";

const R = "wss://harbour.example";
const ev = (id: string) => ({ id, kind: 1, pubkey: "a".repeat(64), created_at: 1, tags: [], content: "", sig: "" });
const lines = (frames: WireFrame[]) => transcript(frames).map((l) => [l.what, l.text, l.tone]);

describe("what the relay said, in order", () => {
  it("connect, ask, events, end of stored events — with timings", () => {
    expect(lines([
      { relay: R, at: 0, dir: "conn", state: "connecting" },
      { relay: R, at: 120, dir: "conn", state: "open" },
      { relay: R, at: 121, dir: "out", msg: ["REQ", "q1", { kinds: [1, 7], limit: 50 }] },
      { relay: R, at: 205, dir: "in", msg: ["EVENT", "q1", ev("1")] },
      { relay: R, at: 210, dir: "in", msg: ["EVENT", "q1", ev("2")] },
      { relay: R, at: 264, dir: "in", msg: ["EOSE", "q1"] },
    ])).toEqual([
      ["connected", "Connected in 120 ms", "plain"],
      ["asked", "Asked for Notes and Reactions · up to 50", "plain"],
      ["events", "2 events · first after 84 ms", "plain"],
      ["end", "End of stored events · 2 in 143 ms", "good"],
    ]);
  });

  it("a relay that can't be reached says so, and nothing more", () => {
    expect(lines([
      { relay: R, at: 0, dir: "conn", state: "connecting" },
      { relay: R, at: 150, dir: "conn", state: "error", detail: "connection refused" },
    ])).toEqual([["unreachable", "Couldn't connect — connection refused", "bad"]]);
  });

  it("a refusal gives the relay's own words, and sign-in is its own kind of refusal", () => {
    expect(lines([
      { relay: R, at: 0, dir: "out", msg: ["REQ", "q1", { kinds: [1] }] },
      { relay: R, at: 40, dir: "in", msg: ["AUTH", "challenge-1"] },
      { relay: R, at: 41, dir: "in", msg: ["CLOSED", "q1", "auth-required: you must auth"] },
      { relay: R, at: 50, dir: "in", msg: ["NOTICE", "slow down"] },
      { relay: R, at: 60, dir: "in", msg: ["CLOSED", "q2", "restricted: members only"] },
      { relay: R, at: 70, dir: "in", msg: ["CLOSED", "q3", ""] },
    ]).slice(1)).toEqual([
      ["auth-asked", "Asks you to sign in", "warn"],
      ["refused", "Wants you to sign in first — “you must auth”", "warn"],
      ["notice", "Notice — “slow down”", "warn"],
      ["refused", "Refused — “members only”", "bad"],
      ["closed", "Closed the query", "plain"],
    ]);
  });

  it("signing in: sent, then accepted or turned down", () => {
    const auth = { ...ev("auth1"), kind: 22242 };
    expect(lines([
      { relay: R, at: 0, dir: "out", msg: ["AUTH", auth] },
      { relay: R, at: 30, dir: "in", msg: ["OK", "auth1", false, "auth-required: bad challenge"] },
      { relay: R, at: 40, dir: "out", msg: ["AUTH", { ...auth, id: "auth2" }] },
      { relay: R, at: 70, dir: "in", msg: ["OK", "auth2", true, ""] },
    ])).toEqual([
      ["auth-sent", "Sent your sign-in", "plain"],
      ["sign-in-refused", "Sign-in turned down — “bad challenge”", "bad"],
      ["auth-sent", "Sent your sign-in", "plain"],
      ["signed-in", "Signed in", "good"],
    ]);
  });

  it("counts, exact or estimated", () => {
    expect(lines([
      { relay: R, at: 0, dir: "out", msg: ["COUNT", "c1", { kinds: [1] }] },
      { relay: R, at: 90, dir: "in", msg: ["COUNT", "c1", { count: 48210, approximate: true }] },
      { relay: R, at: 100, dir: "out", msg: ["COUNT", "c2", { "#t": ["bitcoin"] }] },
      { relay: R, at: 150, dir: "in", msg: ["COUNT", "c2", { count: 3 }] },
    ])).toEqual([
      ["asked", "Asked to count Notes", "plain"],
      ["count", "About 48,210 · in 90 ms", "good"],
      ["asked", "Asked to count #bitcoin", "plain"],
      ["count", "Exactly 3 · in 50 ms", "good"],
    ]);
  });

  it("describes a filter in words", () => {
    const asked = (f: object) => transcript([{ relay: R, at: 1_000_000, dir: "out", msg: ["REQ", "q", f] }])[0].text;
    expect(asked({ authors: ["a".repeat(64), "b".repeat(64)], since: 1000 - 3 * 3600 })).toBe("Asked for anything · from 2 people · since 3 h ago");
    expect(asked({ ids: ["x"] })).toBe("Asked for 1 event by id");
    expect(asked({ kinds: [1], since: 1000 - 86400 })).toBe("Asked for Notes · since 24 h ago");
    expect(asked({ kinds: [1], since: 1000 - 3 * 86400 })).toBe("Asked for Notes · since 3 d ago");
    expect(asked({ kinds: [30023], search: "harbour", "#p": ["c".repeat(64)] })).toBe("Asked for Articles · matching “harbour” · mentioning 1 person");
  });

  it("new events after the end of stored events count as live", () => {
    const t = transcript([
      { relay: R, at: 0, dir: "out", msg: ["REQ", "q1", {}] },
      { relay: R, at: 10, dir: "in", msg: ["EOSE", "q1"] },
      { relay: R, at: 5000, dir: "in", msg: ["EVENT", "q1", ev("9")] },
      { relay: R, at: 6000, dir: "in", msg: ["EVENT", "q1", ev("10")] },
      { relay: R, at: 7000, dir: "out", msg: ["CLOSE", "q1"] },
    ]);
    expect(t.slice(2).map((l) => l.text)).toEqual(["2 new as they arrived", "Stopped"]);
  });
});

describe("how each relay did", () => {
  it("answered, refused, unreached or still waiting", () => {
    const B = "wss://b.example", C = "wss://c.example", D = "wss://d.example";
    const o = relayOutcomes([
      { relay: R, at: 0, dir: "out", msg: ["REQ", "q", {}] },
      { relay: R, at: 5, dir: "in", msg: ["EVENT", "q", ev("1")] },
      { relay: R, at: 80, dir: "in", msg: ["EOSE", "q"] },
      { relay: B, at: 0, dir: "out", msg: ["REQ", "q", {}] },
      { relay: B, at: 30, dir: "in", msg: ["CLOSED", "q", "auth-required: sign in"] },
      { relay: C, at: 0, dir: "conn", state: "error" },
      { relay: D, at: 0, dir: "out", msg: ["REQ", "q", {}] },
    ]);
    expect(o.get(R)).toEqual({ status: "answered", events: 1, endMs: 80 });
    expect(o.get(B)).toEqual({ status: "refused", events: 0, reason: "auth-required: sign in" });
    expect(o.get(C)).toEqual({ status: "unreached", events: 0 });
    expect(o.get(D)).toEqual({ status: "waiting", events: 0 });
  });
});

describe("comparing relays", () => {
  it("what each has that the others don't, and what it's missing", () => {
    expect(compareRelays({ a: ["1", "2", "3"], b: ["2", "3", "4"], c: ["3"] })).toEqual([
      { relay: "a", total: 3, onlyHere: 1, missing: 1 },
      { relay: "b", total: 3, onlyHere: 1, missing: 1 },
      { relay: "c", total: 1, onlyHere: 0, missing: 3 },
    ]);
  });
});
