/**
 * Turning the wider network on is a decision for adults (owner, 2026-10-13):
 * anyone can post anything there and nobody checks it all first. The switch
 * asks once per account, in plain words, for a confirmation that the person
 * is 18 or older and understands that — and remembers the answer with the
 * moment it was given, so it is never asked twice and turning the network
 * off never asks at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  needsAdultConfirm,
  recordAdultConsent,
  hasAdultConsent,
  adultConsentAt,
  CONSENT_PREFIX,
} from "./wider-network-consent";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const PK = "a".repeat(64);
const OTHER = "b".repeat(64);

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe("the adult confirmation before the wider network", () => {
  it("is asked the first time an account turns the network on", () => {
    expect(needsAdultConfirm(PK, true)).toBe(true);
  });

  it("is never asked when turning the network off", () => {
    expect(needsAdultConfirm(PK, false)).toBe(false);
  });

  it("is asked once: a recorded answer is remembered with its moment", () => {
    const at = new Date("2026-10-13T20:15:00.000Z");
    recordAdultConsent(PK, at);
    expect(hasAdultConsent(PK)).toBe(true);
    expect(adultConsentAt(PK)).toBe("2026-10-13T20:15:00.000Z");
    expect(needsAdultConfirm(PK, true)).toBe(false);
  });

  it("is per account", () => {
    recordAdultConsent(PK, new Date("2026-10-13T20:15:00.000Z"));
    expect(needsAdultConfirm(OTHER, true)).toBe(true);
    expect(adultConsentAt(OTHER)).toBeNull();
  });

  it("ignores a damaged record rather than treating it as consent", () => {
    localStorage.setItem(`${CONSENT_PREFIX}${PK}`, "yes");
    expect(hasAdultConsent(PK)).toBe(false);
    expect(adultConsentAt(PK)).toBeNull();
    expect(needsAdultConfirm(PK, true)).toBe(true);
  });

  it("asks nobody when there is no account", () => {
    expect(needsAdultConfirm(null, true)).toBe(false);
  });
});
