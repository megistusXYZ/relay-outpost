/**
 * Flipping the wider-network switch (owner, 2026-10-10): the local switch
 * flips first so the app answers at once, then the account's relay list is
 * republished for the new mode. If the relays can't be reached — the list
 * couldn't be read, or the publish failed — the switch flips back and the
 * person is told; a switch that says "on" while the network still thinks
 * "off" would be a lie on both sides.
 */
import { describe, it, expect } from "vitest";
import { flipWiderNetwork } from "./wider-network-switch";

function harness(publishResult: "published" | "unanswered" | "failed") {
  const states: boolean[] = [];
  const published: boolean[] = [];
  const deps = {
    set: (on: boolean) => { states.push(on); },
    publish: async (on: boolean) => { published.push(on); return publishResult; },
  };
  return { deps, states, published };
}

describe("flipWiderNetwork", () => {
  it("on: flips the switch, publishes the expanded list, stays on", async () => {
    const { deps, states, published } = harness("published");
    expect(await flipWiderNetwork(true, deps)).toEqual({ ok: true });
    expect(states).toEqual([true]);
    expect(published).toEqual([true]);
  });

  it("off: flips the switch, publishes the floor, stays off", async () => {
    const { deps, states, published } = harness("published");
    expect(await flipWiderNetwork(false, deps)).toEqual({ ok: true });
    expect(states).toEqual([false]);
    expect(published).toEqual([false]);
  });

  it("the relays didn't answer: flips back and says so", async () => {
    const { deps, states } = harness("unanswered");
    expect(await flipWiderNetwork(true, deps)).toEqual({ ok: false, reason: "unanswered" });
    expect(states).toEqual([true, false]);
  });

  it("the publish failed: flips back and says so", async () => {
    const { deps, states } = harness("failed");
    expect(await flipWiderNetwork(false, deps)).toEqual({ ok: false, reason: "failed" });
    expect(states).toEqual([false, true]);
  });

  it("the publish threw: flips back, never leaves the switch lying", async () => {
    const { deps, states } = harness("published");
    deps.publish = async () => { throw new Error("socket closed"); };
    expect(await flipWiderNetwork(true, deps)).toEqual({ ok: false, reason: "failed" });
    expect(states).toEqual([true, false]);
  });
});
