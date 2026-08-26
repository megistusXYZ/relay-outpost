/**
 * Owner report (2026-08-14, pilot room screenshot): tapping a reaction showed
 * "Couldn't add reaction — Try again in a moment." Chat messages worked;
 * reactions didn't. The difference was that sendGroupChat wakes the group
 * relay's idle socket and gives a just-reconnected relay one settle-then-retry
 * before giving up — the reaction handlers published straight into the dropped
 * or de-authenticated connection. publishToGroupRelay is that survival,
 * extracted so every one-shot group publish inherits it.
 */
import { describe, it, expect, vi } from "vitest";
import { publishToGroupRelay } from "./nip29";

const RELAY = "wss://bunk-test.example";
const SIGNED = { id: "e".repeat(64), kind: 7 } as any;

describe("publishToGroupRelay", () => {
  it("wakes the relay socket before the first publish attempt", async () => {
    const calls: string[] = [];
    const ok = await publishToGroupRelay(RELAY, SIGNED, {
      ensure: async () => { calls.push("ensure"); },
      publish: async () => { calls.push("publish"); return true; },
      settleMs: 0,
    });
    expect(ok).toBe(true);
    expect(calls).toEqual(["ensure", "publish"]);
  });

  it("does not retry when the first publish succeeds", async () => {
    const publish = vi.fn(async () => true);
    await publishToGroupRelay(RELAY, SIGNED, { ensure: async () => {}, publish, settleMs: 0 });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("retries once after the settle window and returns the retry's verdict", async () => {
    const publish = vi.fn(async () => publish.mock.calls.length > 1);
    const ok = await publishToGroupRelay(RELAY, SIGNED, { ensure: async () => {}, publish, settleMs: 0 });
    expect(ok).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("a relay that stays unreachable still answers false, not a throw", async () => {
    const ok = await publishToGroupRelay(RELAY, SIGNED, {
      ensure: async () => { throw new Error("connection failed"); },
      publish: async () => false,
      settleMs: 0,
    });
    expect(ok).toBe(false);
  });
});

describe("every one-shot group publish goes through the survival path", () => {
  it("CommsTab reaction handlers no longer publish raw", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../components/CommsTab.tsx"), "utf8");
    // The bug: publishEvent(signed, [relayUrl], ...) straight into an idle
    // socket. Reactions must use publishToGroupRelay instead.
    expect(src).not.toMatch(/publishEvent\(signed, \[relayUrl\]/);
    expect((src.match(/publishToGroupRelay\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
