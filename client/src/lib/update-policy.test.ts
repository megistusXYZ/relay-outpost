/**
 * Quiet updates (owner, 2026-10-01): nothing to read, nothing to tap. Once a
 * new version is ready, the app moves onto it at the next natural boundary —
 * where a reload looks like a page opening, not an interruption — and never
 * while the person is in the middle of something.
 *
 * The decision is pure so the whole behaviour is one table. The wiring
 * (what counts as a navigation, how idle is measured, what "busy" looks at)
 * lives in app-update.ts and update-on-return.ts; the real-browser proof is
 * the stale-deploy harness.
 */
import { describe, it, expect } from "vitest";
import {
  shouldApplyUpdate,
  IDLE_APPLY_AFTER_READY_MS,
  IDLE_MS,
  type UpdateContext,
} from "./update-policy";

const calm: UpdateContext = {
  ready: true,
  readyForMs: 0,
  visible: true,
  busy: false,
  inCall: false,
  signupDraft: false,
  idleForMs: 0,
};

describe("shouldApplyUpdate — natural boundaries", () => {
  it("nothing to apply until a new version is ready", () => {
    expect(shouldApplyUpdate("navigation", { ...calm, ready: false })).toBe(false);
    expect(shouldApplyUpdate("hidden", { ...calm, ready: false })).toBe(false);
  });

  it("applies on the next in-app navigation: the new page opens on the new version", () => {
    expect(shouldApplyUpdate("navigation", calm)).toBe(true);
  });

  it("applies the moment the app goes to the background: nobody is watching", () => {
    expect(shouldApplyUpdate("hidden", { ...calm, visible: false })).toBe(true);
  });

  it("applies when someone comes back after a long time away", () => {
    expect(shouldApplyUpdate("returned", { ...calm, awayMs: 15 * 60 * 1000 })).toBe(true);
    expect(shouldApplyUpdate("returned", { ...calm, awayMs: 2 * 60 * 1000 })).toBe(false);
  });

  it("a screen nobody has touched for a minute, ten minutes after the update arrived, moves on quietly", () => {
    expect(shouldApplyUpdate("idle-tick", { ...calm, readyForMs: IDLE_APPLY_AFTER_READY_MS, idleForMs: IDLE_MS })).toBe(true);
    expect(shouldApplyUpdate("idle-tick", { ...calm, readyForMs: IDLE_APPLY_AFTER_READY_MS, idleForMs: IDLE_MS - 1 })).toBe(false);
    expect(shouldApplyUpdate("idle-tick", { ...calm, readyForMs: IDLE_APPLY_AFTER_READY_MS - 1, idleForMs: IDLE_MS })).toBe(false);
    // Idle in a background tab is not idle: that tab is handled by "hidden".
    expect(shouldApplyUpdate("idle-tick", { ...calm, visible: false, readyForMs: IDLE_APPLY_AFTER_READY_MS, idleForMs: IDLE_MS })).toBe(false);
  });

  it("the numbers are the ones the owner agreed to", () => {
    expect(IDLE_APPLY_AFTER_READY_MS).toBe(10 * 60 * 1000);
    expect(IDLE_MS).toBe(60 * 1000);
  });
});

describe("shouldApplyUpdate — never in the middle of something", () => {
  const moments = ["navigation", "hidden", "returned", "idle-tick"] as const;
  const ripe: UpdateContext = { ...calm, readyForMs: IDLE_APPLY_AFTER_READY_MS, idleForMs: IDLE_MS, awayMs: 15 * 60 * 1000 };

  it("text in a field (a half-written post) blocks every moment, even backgrounding", () => {
    for (const m of moments) expect(shouldApplyUpdate(m, { ...ripe, busy: true, visible: m !== "hidden" })).toBe(false);
  });

  it("a call in progress blocks every moment", () => {
    for (const m of moments) expect(shouldApplyUpdate(m, { ...ripe, inCall: true, visible: m !== "hidden" })).toBe(false);
  });

  it("the signup flow blocks every moment: a new member must not lose their keys mid-way", () => {
    for (const m of moments) expect(shouldApplyUpdate(m, { ...ripe, signupDraft: true, visible: m !== "hidden" })).toBe(false);
  });
});
