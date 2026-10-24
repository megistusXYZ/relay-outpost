/**
 * Searching an exact npub or name@domain shows that person on top
 * (Search.tsx handleDirectMatchResolved). The lookup used Brainstorm's search
 * API, dead since 2026-09-28, so the person never showed. It now asks the
 * profile directories (lib/profile-direct.ts) and scores the person with the
 * same trust batch the rest of the app uses.
 */
import { describe, it, expect } from "vitest";
import { lookupProfileDirectWith } from "./profile-direct";

const PK = "a".repeat(64);
const kind0 = (created_at: number, name: string) => ({ id: String(created_at).padStart(64, "0"), pubkey: PK, kind: 0, created_at, content: JSON.stringify({ name }), tags: [], sig: "" });

describe("lookupProfileDirectWith", () => {
  it("the newest profile the directories hold, with its score", async () => {
    const r = await lookupProfileDirectWith(PK, {
      query: async () => [kind0(10, "old"), kind0(20, "new")],
      score: async () => new Map([[PK, 0.8]]),
      remember: () => {},
    });
    expect(JSON.parse(r.event!.content).name).toBe("new");
    expect(r.wotScore).toBe(0.8);
  });

  it("no profile anywhere: nothing, never a made-up one", async () => {
    const r = await lookupProfileDirectWith(PK, { query: async () => [], score: async () => new Map(), remember: () => {} });
    expect(r).toEqual({ event: null, wotScore: null });
  });

  it("a score that can't be had leaves the profile, unscored", async () => {
    const r = await lookupProfileDirectWith(PK, {
      query: async () => [kind0(5, "x")],
      score: async () => { throw new Error("down"); },
      remember: () => {},
    });
    expect(r.event?.pubkey).toBe(PK);
    expect(r.wotScore).toBeNull();
  });

  it("only that person's profile counts", async () => {
    const other = { ...kind0(99, "someone else"), pubkey: "b".repeat(64) };
    const r = await lookupProfileDirectWith(PK, { query: async () => [other], score: async () => new Map(), remember: () => {} });
    expect(r.event).toBeNull();
  });
});
