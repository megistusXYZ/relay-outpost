// @vitest-environment jsdom
/**
 * The first time an account opens the wider network (owner, 2026-10-10):
 * Trust & safety goes to Careful, sensitive posts stay hidden, and media
 * from outside your space stays blurred — once. They chose the network,
 * not the worst of it; loosening later is theirs to do and is never undone.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyFirstOptIn, hasFirstOptIn } from "./first-opt-in";
import { readTrustChoice, applyTrustChoice } from "./trust-choice";
import { getSensitiveContentSetting } from "./sensitive-content";
import { blurOutsideEnabled, BLUR_OUTSIDE_KEY } from "./outside-space-blur";

class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(i: number) { return [...this.items.keys()][i] ?? null; }
  getItem(k: string) { return this.items.get(String(k)) ?? null; }
  setItem(k: string, v: string) { this.items.set(String(k), String(v)); }
  removeItem(k: string) { this.items.delete(String(k)); }
  clear() { this.items.clear(); }
}
vi.stubGlobal("localStorage", new MemoryStorage());
const PK = "ab".repeat(32);
beforeEach(() => localStorage.clear());

describe("applyFirstOptIn", () => {
  it("the first time: Careful, sensitive hidden, outside media blurred", () => {
    localStorage.setItem("sensitiveContent", "show");
    expect(hasFirstOptIn(PK)).toBe(false);
    expect(applyFirstOptIn(PK)).toBe(true);
    expect(readTrustChoice()).toBe("careful");
    expect(getSensitiveContentSetting()).toBe(true);
    expect(blurOutsideEnabled(localStorage.getItem(BLUR_OUTSIDE_KEY))).toBe(true);
    expect(hasFirstOptIn(PK)).toBe(true);
  });

  it("never again: loosening afterwards is respected", () => {
    applyFirstOptIn(PK);
    applyTrustChoice("everything");
    localStorage.setItem("sensitiveContent", "show");
    expect(applyFirstOptIn(PK)).toBe(false);
    expect(readTrustChoice()).toBe("everything");
    expect(getSensitiveContentSetting()).toBe(false);
  });

  it("is per account", () => {
    applyFirstOptIn(PK);
    expect(hasFirstOptIn("cd".repeat(32))).toBe(false);
  });
});
