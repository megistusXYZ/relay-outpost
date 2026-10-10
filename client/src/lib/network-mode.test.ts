// @vitest-environment jsdom
/**
 * "Your space" / "The wider network" (owner, 2026-10-10). A brand-new account
 * starts with the wider network OFF: its own communities and the people it
 * follows, nothing from public relays, until it flips one switch. The switch
 * is the per-account `ro_public_nostr:<pk>` flag that signup already writes.
 *
 * Absence means ON. That is what protects everyone who already has an
 * account: no stored value → nothing changes for them. Only "0" is off.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isWiderNetworkOn,
  setWiderNetwork,
  setNetworkModeViewer,
  isWiderNetworkOnForViewer,
  WIDER_NETWORK_CHANGED,
} from "./network-mode";

const PK = "a".repeat(64);
const OTHER = "b".repeat(64);

// jsdom here has no storage of its own; an in-memory one stands in.
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

beforeEach(() => {
  localStorage.clear();
  setNetworkModeViewer(null);
});

describe("isWiderNetworkOn — one account's switch", () => {
  it("is ON when nothing is stored: an account from before the switch sees no change", () => {
    expect(isWiderNetworkOn(PK)).toBe(true);
  });
  it("is OFF only for the stored opt-out a signup writes", () => {
    localStorage.setItem(`ro_public_nostr:${PK}`, "0");
    expect(isWiderNetworkOn(PK)).toBe(false);
    expect(isWiderNetworkOn(OTHER)).toBe(true); // per account, never device-wide
  });
  it("fails open on garbage and when signed out", () => {
    localStorage.setItem(`ro_public_nostr:${PK}`, "off");
    expect(isWiderNetworkOn(PK)).toBe(true);
    expect(isWiderNetworkOn(null)).toBe(true);
    expect(isWiderNetworkOn(undefined)).toBe(true);
  });
});

describe("setWiderNetwork — the switch", () => {
  it("turns off and back on, and tells the app each time", () => {
    const heard: string[] = [];
    window.addEventListener(WIDER_NETWORK_CHANGED, () => heard.push("changed"));
    setWiderNetwork(PK, false);
    expect(isWiderNetworkOn(PK)).toBe(false);
    setWiderNetwork(PK, true);
    expect(isWiderNetworkOn(PK)).toBe(true);
    expect(heard).toEqual(["changed", "changed"]);
  });
});

describe("the viewer — what relay selection reads without a pubkey in hand", () => {
  it("is open when nobody is signed in", () => {
    expect(isWiderNetworkOnForViewer()).toBe(true);
  });
  it("follows the signed-in account's switch", () => {
    setWiderNetwork(PK, false);
    setNetworkModeViewer(PK);
    expect(isWiderNetworkOnForViewer()).toBe(false);
    setNetworkModeViewer(OTHER); // an account with no stored value
    expect(isWiderNetworkOnForViewer()).toBe(true);
    setNetworkModeViewer(null);
    expect(isWiderNetworkOnForViewer()).toBe(true);
  });
});
