/**
 * People search moves to NosFabrica's NIP-50 relay, wss://search.brainstorm.world
 * (2026-09-28): the old Meili API on brainstorm.world now serves a web page.
 * The relay ranks kind-0 profiles through an observer's web of trust; signed
 * out, it uses its own default observer. Measured: "jack" returns the real
 * jack first in ~0.2s, where the unranked corpus leads with spam clones.
 */
import { describe, it, expect, vi } from "vitest";
import { peopleSearchFilter, searchPeopleRanked, PEOPLE_SEARCH_RELAY, DEFAULT_LENS } from "./people-search";

const VIEWER = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";

describe("peopleSearchFilter", () => {
  it("ranks through the signed-in viewer's web of trust", () => {
    expect(peopleSearchFilter("jack", VIEWER, 10)).toEqual({ kinds: [0], search: `jack observer:${VIEWER}`, limit: 10 });
  });

  // Owner call (2026-09-28): signed out, rank through npub1healthsx3… (hex
  // be7bf5de…), not whatever default the relay happens to use.
  it("signed out, ranks through the default lens", () => {
    expect(peopleSearchFilter("jack mallers", null, 10)).toEqual({ kinds: [0], search: `jack mallers observer:${DEFAULT_LENS}`, limit: 10 });
  });

  it("never sends an npub as the observer; falls back to the default lens", () => {
    expect(peopleSearchFilter("jack", "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m", 10)?.search).toBe(`jack observer:${DEFAULT_LENS}`);
  });

  it("the default lens is npub1healthsx3…", () => {
    expect(DEFAULT_LENS).toBe("be7bf5de068c1d842ed34a7c270507ec940f5ea51671cfd062a95e9d09420d0a");
  });

  it("typed search tokens can't change whose trust ranks the results", () => {
    const f = peopleSearchFilter("jack observer:" + "a".repeat(64) + " include:spam", VIEWER, 10);
    expect(f?.search).toBe(`jack observer:${VIEWER}`);
  });

  it("tidies whitespace and keeps the limit sane", () => {
    expect(peopleSearchFilter("  jack   mallers ", VIEWER, 5000)).toEqual({ kinds: [0], search: `jack mallers observer:${VIEWER}`, limit: 100 });
  });

  it("an empty query asks nothing", () => {
    expect(peopleSearchFilter("   ", VIEWER, 10)).toBeNull();
  });
});

describe("searchPeopleRanked", () => {
  const profile = (pubkey: string, name: string) => ({ id: pubkey + "0", kind: 0, pubkey, created_at: 1, content: JSON.stringify({ name }), tags: [], sig: "s" });

  it("a search relay we couldn't reach says so, and is never asked", async () => {
    const query = vi.fn();
    const r = await searchPeopleRanked("jack", 10, null, { reach: async () => false, query });
    expect(r).toEqual({ data: [], reached: false });
    expect(query).not.toHaveBeenCalled();
  });

  it("a relay that answered with nobody is a real empty result", async () => {
    const r = await searchPeopleRanked("zzqqxx", 10, null, { reach: async () => true, query: async () => [] });
    expect(r).toEqual({ data: [], reached: true });
  });

  it("keeps the relay's ranked order, one result per person", async () => {
    const r = await searchPeopleRanked("jack", 10, VIEWER, {
      reach: async () => true,
      query: async (relay, filter) => {
        expect(relay).toBe(PEOPLE_SEARCH_RELAY);
        expect(filter.search).toBe(`jack observer:${VIEWER}`);
        return [profile("a".repeat(64), "jack"), profile("b".repeat(64), "Jack"), profile("a".repeat(64), "jack (old)")];
      },
    });
    expect(r.reached).toBe(true);
    expect(r.data.map((e) => JSON.parse(e.content).name)).toEqual(["jack", "Jack"]);
  });
});
