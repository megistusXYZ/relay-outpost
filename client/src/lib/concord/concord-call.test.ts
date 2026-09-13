/**
 * The call itself (Concord CORD-07), the parts that aren't a screen: who gets
 * a real frame key and who gets one that opens nothing, re-decided every time
 * someone joins or presence changes, exactly as Armada decides it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { planCallerKeys, startPresenceHeartbeat, callKeysChange, callerLabel, type KeyState } from "./concord-call";
import { voiceKeys } from "./concord-voice";
import type { CallPresence } from "./concord-presence";
import type { CallSeat } from "./concord-presence";

const seat = (identity: string): CallSeat => ({ identity, broker: "https://relayop.xyz", at: 1_000_000 });
const alice = "a1".repeat(32), bob = "b0".repeat(32), mallory = "e5".repeat(32);

describe("who gets a real frame key", () => {
  it("keys our own seat and every seat exactly one member claims; blocks contested and unclaimed seats", () => {
    const roster = new Map([[alice, seat("seat-a")], [bob, seat("seat-x")], [mallory, seat("seat-x")]]);
    const plan = planCallerKeys({ own: "seat-me", present: ["seat-me", "seat-a", "seat-x", "seat-z"], roster, applied: new Map() });
    expect(plan).toEqual([
      { identity: "seat-me", want: "sender" },
      { identity: "seat-a", want: "sender" },
      { identity: "seat-x", want: "blocked" },   // Mallory copied Bob's seat
      { identity: "seat-z", want: "blocked" },   // nobody claims it
    ]);
  });

  it("changes only what changed: nothing again for the same call, and a seat flips to real once its claim is clear", () => {
    const contested = new Map([[bob, seat("seat-x")], [mallory, seat("seat-x")]]);
    const applied = new Map<string, KeyState>();
    for (const step of planCallerKeys({ own: "seat-me", present: ["seat-me", "seat-x"], roster: contested, applied })) applied.set(step.identity, step.want);
    expect(planCallerKeys({ own: "seat-me", present: ["seat-me", "seat-x"], roster: contested, applied })).toEqual([]);
    // Mallory's copied claim goes stale: Bob alone claims seat-x now.
    const clear = new Map([[bob, seat("seat-x")]]);
    expect(planCallerKeys({ own: "seat-me", present: ["seat-me", "seat-x"], roster: clear, applied })).toEqual([{ identity: "seat-x", want: "sender" }]);
  });
});

describe("staying visible in a call", () => {
  afterEach(() => vi.useRealTimers());

  it("says it joined at once and every 30 seconds, then says it left once and goes quiet", async () => {
    vi.useFakeTimers();
    const said: CallPresence[] = [];
    const beat = startPresenceHeartbeat({ announce: async (p) => { said.push(p); }, identity: "seat-me", broker: "https://relayop.xyz" });
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual([{ state: "joined", identity: "seat-me", broker: "https://relayop.xyz" }]);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(said.filter((p) => p.state === "joined")).toHaveLength(3);
    await beat.stop();
    expect(said.at(-1)).toEqual({ state: "left" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(said).toHaveLength(4);
  });
});

describe("when the room's keys change during a call", () => {
  const secret = new Uint8Array(32).fill(0x11);
  const room = new Uint8Array(32).fill(0x22);

  it("stays put while the keys are the same, rejoins the new room after a rekey, and leaves once the room's key is gone", () => {
    const now = voiceKeys(secret, room, 0n);
    expect(callKeysChange(now, voiceKeys(secret, room, 0n))).toBe("stay");
    // A rekey (someone removed) rolls the room's epoch: the call moves with it.
    expect(callKeysChange(now, voiceKeys(secret, room, 1n))).toBe("rejoin");
    // We no longer hold the room's key (removed, or a private room's key is gone).
    expect(callKeysChange(now, null)).toBe("leave");
  });
});

describe("how a caller is named on screen", () => {
  it("shows the member once one claim backs the seat; otherwise Verifying for 15 seconds, then Unverified", () => {
    const t0 = 1_000_000;
    expect(callerLabel({ identity: "seat-a", member: alice, contested: false }, t0, t0 + 1_000)).toEqual({ kind: "member", pubkey: alice });
    // Presence usually arrives a moment after the media server shows someone.
    expect(callerLabel({ identity: "seat-z", member: null, contested: false }, t0, t0 + 5_000)).toEqual({ kind: "verifying" });
    expect(callerLabel({ identity: "seat-z", member: null, contested: false }, t0, t0 + 16_000)).toEqual({ kind: "unverified" });
    expect(callerLabel({ identity: "seat-x", member: null, contested: true }, t0, t0 + 20_000)).toEqual({ kind: "unverified" });
  });
});
