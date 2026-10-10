/**
 * The "open my new community's invite" nudge (owner, 2026-10-10) must
 * survive the community page mounting more than once: it is read on every
 * mount and cleared only when the person closes the invite — never consumed
 * by the first render that happened to see it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setInviteNudge, hasInviteNudge, clearInviteNudge } from "./invite-nudge";

const items = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => items.get(k) ?? null,
  setItem: (k: string, v: string) => { items.set(k, String(v)); },
  removeItem: (k: string) => { items.delete(k); },
});
beforeEach(() => items.clear());

describe("the invite nudge", () => {
  it("is there on every read until it is cleared — a second mount opens the invite too", () => {
    setInviteNudge("c1");
    expect(hasInviteNudge("c1")).toBe(true);
    expect(hasInviteNudge("c1")).toBe(true);
    clearInviteNudge("c1");
    expect(hasInviteNudge("c1")).toBe(false);
  });
  it("is for one community: another community's page leaves it alone", () => {
    setInviteNudge("c1");
    expect(hasInviteNudge("c2")).toBe(false);
    clearInviteNudge("c2");
    expect(hasInviteNudge("c1")).toBe(true);
  });
  it("is absent by default", () => {
    expect(hasInviteNudge("c1")).toBe(false);
  });
});
