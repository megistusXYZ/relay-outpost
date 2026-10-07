/**
 * Ringing (owner, 2026-10-06): today nothing tells you a call started unless
 * you're looking at that room. Owner's choices: a calm banner and a soft
 * chime; only on devices with Encrypted calls on; never for muted rooms or a
 * call you're already in; once per call — not again for each person joining.
 */
import { describe, it, expect } from "vitest";
import { createRingDecider } from "./call-ring";

const S = 1000;
const seen = (over: Partial<{ room: string; caller: string; at: number; muted: boolean; inCall: boolean }>) =>
  ({ room: "bali:general", caller: "ana", at: 0, muted: false, inCall: false, ...over });

describe("when a call rings", () => {
  it("the first person calling in a quiet room rings", () => {
    const d = createRingDecider({ me: "me" });
    expect(d.see(seen({}))).toEqual({ room: "bali:general", caller: "ana" });
  });

  it("people joining the same call don't ring again, nor the same caller's heartbeats", () => {
    const d = createRingDecider({ me: "me" });
    d.see(seen({ at: 0 }));
    expect(d.see(seen({ caller: "bob", at: 20 * S }))).toBeNull();
    expect(d.see(seen({ at: 30 * S }))).toBeNull();
  });

  it("your own presence never rings you (another device of yours, say)", () => {
    expect(createRingDecider({ me: "me" }).see(seen({ caller: "me" }))).toBeNull();
  });

  it("a muted room, or a call you're in, doesn't ring", () => {
    expect(createRingDecider({ me: "me" }).see(seen({ muted: true }))).toBeNull();
    expect(createRingDecider({ me: "me" }).see(seen({ inCall: true }))).toBeNull();
  });

  it("…and a call that started while muted doesn't ring later in that same call", () => {
    const d = createRingDecider({ me: "me" });
    d.see(seen({ muted: true, at: 0 }));
    expect(d.see(seen({ caller: "bob", at: 30 * S }))).toBeNull();
  });

  it("once a call has been quiet 90 s, the next one rings again", () => {
    const d = createRingDecider({ me: "me" });
    d.see(seen({ at: 0 }));
    expect(d.see(seen({ caller: "bob", at: 200 * S }))).toEqual({ room: "bali:general", caller: "bob" });
  });

  it("each room rings for its own call", () => {
    const d = createRingDecider({ me: "me" });
    d.see(seen({ at: 0 }));
    expect(d.see(seen({ room: "bali:music", at: 5 * S }))).toEqual({ room: "bali:music", caller: "ana" });
  });
});

describe("what isn't a call starting", () => {
  it("someone leaving never rings", () => {
    expect(createRingDecider({ me: "me" }).see({ ...seen({}), state: "left" })).toBeNull();
  });
  it("an old 'joined' that arrives late (sent over 90 s ago) doesn't ring", () => {
    expect(createRingDecider({ me: "me" }).see({ ...seen({ at: 200 * S }), sentAt: 50 * S })).toBeNull();
  });
});
